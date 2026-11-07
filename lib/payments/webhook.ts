import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { decimalStringToCents, formatCents } from "@/lib/money";
import { PayPalError, type PayPalClient } from "@/lib/paypal";
import { markPaymentPaid } from "@/lib/payments/service";

/**
 * Receives PayPal webhook events (POST /api/webhooks/paypal).
 *
 * Why it exists: the capture route already marks a payment paid, but a slow
 * payment (PayPal reports it PENDING) only completes later, and PayPal tells us
 * by webhook. It is also the safety net if the browser closes mid-capture.
 *
 * Rules:
 * - The signature is verified with PayPal before anything else, on the exact
 *   raw body. Nothing changes for an event that fails verification.
 * - A payment is only marked paid when the order and the amount match what we
 *   created. Anything that doesn't match is logged for review, never dropped.
 * - Marking paid reuses `markPaymentPaid`, so a capture the browser already
 *   recorded is a no-op, and a repeated delivery changes nothing.
 * - Anything we handled, or chose to ignore, answers 200 so PayPal doesn't
 *   retry it forever. Only a failure that could pass later (verification
 *   unavailable) answers 503, so PayPal retries.
 */
export type WebhookDeps = {
  prisma: PrismaClient;
  /** Lazily built, because it throws when PayPal credentials are missing. */
  paypal: () => Pick<PayPalClient, "verifyWebhookSignature">;
};

export const MAX_WEBHOOK_BYTES = 256 * 1024;

export type WebhookOutcome =
  | "paid"
  | "already_paid"
  | "amount_mismatch"
  | "order_mismatch"
  | "unexpected_capture"
  | "unknown_payment"
  | "denied"
  | "ignored";

const eventSchema = z.object({ id: z.string().min(1), event_type: z.string(), resource: z.unknown() });

const captureSchema = z.object({
  id: z.string().min(1),
  status: z.string().optional(),
  amount: z.object({ currency_code: z.string(), value: z.string() }).optional(),
  custom_id: z.string().optional(),
  create_time: z.string().optional(),
  supplementary_data: z.object({ related_ids: z.object({ order_id: z.string().optional() }).optional() }).optional(),
});
type Capture = z.infer<typeof captureSchema>;

const json = (body: unknown, status = 200) => Response.json(body, { status });
const fail = (status: number, code: string, message: string) => json({ ok: false, error: { code, message } }, status);

export async function webhookHandler(request: Request, deps: WebhookDeps): Promise<Response> {
  // The exact bytes PayPal signed. Never re-serialise them.
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_WEBHOOK_BYTES) return fail(413, "too_large", "That payload is too large.");

  let verified: boolean;
  try {
    verified = await deps.paypal().verifyWebhookSignature(request.headers, raw);
  } catch (error) {
    if (error instanceof PayPalError) {
      // Our side isn't ready (no webhook id) or PayPal couldn't be reached: ask PayPal to retry.
      return fail(503, "unavailable", "Webhook verification isn't available right now.");
    }
    throw error;
  }
  if (!verified) return fail(401, "invalid_signature", "The signature could not be verified.");

  const event = eventSchema.safeParse(JSON.parse(raw)); // verified, so it is JSON
  if (!event.success) return json({ ok: true, outcome: "ignored" satisfies WebhookOutcome });

  const { id, event_type: type, resource } = event.data;
  let outcome: WebhookOutcome;
  switch (type) {
    case "PAYMENT.CAPTURE.COMPLETED":
      outcome = await onCaptureCompleted(deps.prisma, id, resource);
      break;
    case "PAYMENT.CAPTURE.DENIED":
      outcome = await onCaptureDenied(deps.prisma, id, resource);
      break;
    default:
      outcome = "ignored";
  }
  console.info(`[webhook] ${type} ${id} -> ${outcome}`);
  return json({ ok: true, outcome });
}

// ---------------------------------------------------------------------------

async function findPayment(prisma: PrismaClient, capture: Capture, orderId: string | undefined) {
  const include = { vendor: true } as const;
  // custom_id is the payment id we set when creating the order; the others are fallbacks.
  if (capture.custom_id) {
    const byId = await prisma.payment.findUnique({ where: { id: capture.custom_id }, include });
    if (byId) return byId;
  }
  if (orderId) {
    const byOrder = await prisma.payment.findFirst({ where: { paypalOrderId: orderId }, include });
    if (byOrder) return byOrder;
  }
  return prisma.payment.findFirst({ where: { captureId: capture.id }, include });
}

/** Write an activity-log entry once: a repeated delivery must not repeat it. */
async function logOnce(prisma: PrismaClient, weddingId: string, type: string, message: string) {
  const existing = await prisma.eventLog.findFirst({ where: { weddingId, type, message } });
  if (!existing) await prisma.eventLog.create({ data: { weddingId, type, message } });
}

async function onCaptureCompleted(prisma: PrismaClient, eventId: string, resource: unknown): Promise<WebhookOutcome> {
  const parsed = captureSchema.safeParse(resource);
  if (!parsed.success) return "ignored";
  const capture = parsed.data;
  if (capture.status && capture.status !== "COMPLETED") return "ignored";

  const orderId = capture.supplementary_data?.related_ids?.order_id;
  const payment = await findPayment(prisma, capture, orderId);
  if (!payment) {
    console.warn(`[webhook] capture ${capture.id} (event ${eventId}) matches no payment`);
    return "unknown_payment";
  }

  const weddingId = payment.vendor.weddingId;
  const what = `${payment.vendor.name} (${payment.label})`;
  const ref = `PayPal event ${eventId}`;

  // The order must be the one we created for this payment.
  if (orderId && payment.paypalOrderId && payment.paypalOrderId !== orderId) {
    await logOnce(prisma, weddingId, "payment_order_mismatch", `PayPal completed a capture for ${what} on an order we didn't create for it. Not marked paid. ${ref}`);
    return "order_mismatch";
  }

  // The amount must be what we asked for, in dollars.
  if (capture.amount) {
    let cents: number | null = null;
    try {
      cents = capture.amount.currency_code === "USD" ? decimalStringToCents(capture.amount.value) : null;
    } catch {
      cents = null;
    }
    if (cents !== payment.amount) {
      const got = cents === null ? `${capture.amount.value} ${capture.amount.currency_code}` : formatCents(cents);
      await logOnce(prisma, weddingId, "payment_amount_mismatch", `PayPal captured ${got} but ${formatCents(payment.amount)} was expected for ${what}. Not marked paid. ${ref}`);
      return "amount_mismatch";
    }
  }

  // Already paid: the same capture is a harmless repeat; a different one means the vendor was paid twice.
  if (payment.status === "paid") {
    if (payment.captureId && payment.captureId !== capture.id) {
      await logOnce(prisma, weddingId, "payment_duplicate_capture", `A second capture (${capture.id}) completed for ${what}, which was already paid. Check PayPal. ${ref}`);
      return "unexpected_capture";
    }
    return "already_paid";
  }

  const created = Date.parse(capture.create_time ?? "");
  const paidAt = Number.isNaN(created) ? new Date() : new Date(created);
  const changed = await markPaymentPaid(prisma, payment.id, { captureId: capture.id, orderId }, paidAt);
  if (changed) return "paid";

  // Not changed: it was paid a moment ago by another request, or the payment can't be paid any more.
  const now = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  if (now.status === "paid") return "already_paid";
  await logOnce(prisma, weddingId, "payment_unexpected_capture", `PayPal completed a capture for ${what}, but that payment is ${now.status}. Check PayPal. ${ref}`);
  return "unexpected_capture";
}

async function onCaptureDenied(prisma: PrismaClient, eventId: string, resource: unknown): Promise<WebhookOutcome> {
  const parsed = captureSchema.safeParse(resource);
  if (!parsed.success) return "ignored";
  const payment = await findPayment(prisma, parsed.data, parsed.data.supplementary_data?.related_ids?.order_id);
  if (!payment) return "unknown_payment";

  // The payment stays as it is, so the couple can try again.
  await logOnce(
    prisma,
    payment.vendor.weddingId,
    "payment_denied",
    `PayPal denied the payment of ${formatCents(payment.amount)} to ${payment.vendor.name} (${payment.label}). It is still unpaid. PayPal event ${eventId}`,
  );
  return "denied";
}
