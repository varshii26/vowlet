/**
 * Paying a vendor: create the PayPal order, then capture it after the couple
 * approves in the PayPal popup. All the money-safety rules live here so the
 * routes stay thin and the webhook (#13) can reuse `markPaymentPaid`.
 *
 * Rules:
 * - Only the order we created for this payment can be captured.
 * - A payment is never paid twice; repeating a capture is a no-op.
 * - A payment is only marked paid when PayPal says the capture COMPLETED and
 *   the amount matches what we asked for.
 * - Nothing here is reachable from the agent: it runs only from the buttons.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { formatCents } from "@/lib/money";
import { PayPalError, type PayPalClient } from "@/lib/paypal";

/** The two PayPal calls this service needs (a fake in tests). */
export type PayPalPort = Pick<PayPalClient, "createOrder" | "captureOrder">;

export type PayFailureCode =
  | "bad_request"
  | "not_found"
  | "not_payable"
  | "order_mismatch"
  | "not_approved"
  | "declined"
  | "amount_mismatch"
  | "paypal_error";

export type PayFailure = { ok: false; code: PayFailureCode; message: string; status: number };

export type OrderResult = { ok: true; orderId: string } | PayFailure;

export type CaptureResult =
  | { ok: true; state: "paid" | "already_paid" | "pending"; message: string }
  | PayFailure;

const fail = (code: PayFailureCode, status: number, message: string): PayFailure => ({
  ok: false,
  code,
  status,
  message,
});

const PAYABLE = ["scheduled", "due"] as const;
const isPayable = (status: string) => (PAYABLE as readonly string[]).includes(status);

/** A payment, only if it is in this wedding. Someone else's id looks exactly like an id that doesn't exist (404). */
async function loadPayment(prisma: PrismaClient, weddingId: string, paymentId: string) {
  return prisma.payment.findFirst({ where: { id: paymentId, vendor: { weddingId } }, include: { vendor: true } });
}

/** Create a PayPal order for a payment and remember its id. */
export async function createPaymentOrder(
  prisma: PrismaClient,
  paypal: PayPalPort,
  weddingId: string,
  paymentId: string,
): Promise<OrderResult> {
  const payment = await loadPayment(prisma, weddingId, paymentId);
  if (!payment) return fail("not_found", 404, "That payment does not exist.");
  if (payment.vendor.status !== "active") {
    return fail("not_payable", 409, `${payment.vendor.name} is cancelled, so this payment can't be made.`);
  }
  if (!isPayable(payment.status)) {
    return fail("not_payable", 409, "This payment has already been settled.");
  }

  let orderId: string;
  try {
    ({ orderId } = await paypal.createOrder(
      { id: payment.id, label: payment.label, amount: payment.amount },
      { name: payment.vendor.name, paypalEmail: payment.vendor.paypalEmail },
    ));
  } catch (error) {
    return paypalFailure(error, "PayPal couldn't start this payment. Nothing was charged. Please try again.");
  }

  await prisma.payment.update({ where: { id: payment.id }, data: { paypalOrderId: orderId } });
  return { ok: true, orderId };
}

/** Capture an order the couple approved, and mark the payment paid. Safe to call twice. */
export async function capturePaymentOrder(
  prisma: PrismaClient,
  paypal: PayPalPort,
  weddingId: string,
  paymentId: string,
  orderId: string,
  now: Date = new Date(),
): Promise<CaptureResult> {
  const payment = await loadPayment(prisma, weddingId, paymentId);
  if (!payment) return fail("not_found", 404, "That payment does not exist.");

  if (payment.status === "paid") {
    // The same order again is a harmless repeat (double click, retry). A different
    // order must never be captured: that would pay the vendor twice.
    return payment.paypalOrderId === orderId
      ? { ok: true, state: "already_paid", message: "This payment was already made." }
      : fail("not_payable", 409, "This payment has already been made.");
  }
  if (!isPayable(payment.status)) return fail("not_payable", 409, "This payment can no longer be made.");
  if (payment.paypalOrderId !== orderId) {
    return fail("order_mismatch", 409, "That PayPal order does not belong to this payment.");
  }

  let captured: Awaited<ReturnType<PayPalPort["captureOrder"]>>;
  try {
    captured = await paypal.captureOrder(orderId);
  } catch (error) {
    if (error instanceof PayPalError && error.issue === "ORDER_NOT_APPROVED") {
      return fail("not_approved", 409, "The payment wasn't approved in PayPal. Nothing was charged.");
    }
    if (error instanceof PayPalError && error.issue === "INSTRUMENT_DECLINED") {
      return fail("declined", 402, "PayPal declined that payment method. Nothing was charged. Try another one.");
    }
    return paypalFailure(
      error,
      "We couldn't confirm this payment with PayPal. Check your PayPal activity before trying again.",
    );
  }

  if (captured.amount !== null && captured.amount !== payment.amount) {
    await logEvent(
      prisma,
      payment.vendor.weddingId,
      "payment_amount_mismatch",
      `PayPal captured ${formatCents(captured.amount)} but ${formatCents(payment.amount)} was expected for ${payment.vendor.name} (${payment.label}). Not marked paid.`,
    );
    return fail("amount_mismatch", 502, "PayPal reported a different amount than expected, so the payment was not recorded.");
  }

  if (captured.captureStatus !== "COMPLETED") {
    await logEvent(
      prisma,
      payment.vendor.weddingId,
      "payment_pending",
      `PayPal is still processing ${formatCents(payment.amount)} to ${payment.vendor.name} (${payment.label}).`,
    );
    return { ok: true, state: "pending", message: "PayPal is still processing this payment. It will update once confirmed." };
  }

  const changed = await markPaymentPaid(prisma, payment.id, { captureId: captured.captureId, orderId }, now);
  return { ok: true, state: changed ? "paid" : "already_paid", message: changed ? "Payment complete." : "This payment was already made." };
}

/**
 * Mark a payment paid. Idempotent: returns true only for the call that made the
 * change, so a double click or a webhook arriving later records it once.
 */
export async function markPaymentPaid(
  prisma: PrismaClient,
  paymentId: string,
  details: { captureId: string; orderId?: string },
  now: Date = new Date(),
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.payment.updateMany({
      where: { id: paymentId, status: { in: [...PAYABLE] } },
      data: {
        status: "paid",
        captureId: details.captureId,
        paidAt: now,
        ...(details.orderId ? { paypalOrderId: details.orderId } : {}),
      },
    });
    if (count === 0) return false;

    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { vendor: true } });
    await tx.eventLog.create({
      data: {
        weddingId: payment.vendor.weddingId,
        type: "payment_paid",
        message: `Paid ${formatCents(payment.amount)} to ${payment.vendor.name} (${payment.label})`,
      },
    });
    return true;
  });
}

async function logEvent(prisma: PrismaClient, weddingId: string, type: string, message: string) {
  await prisma.eventLog.create({ data: { weddingId, type, message } });
}

function paypalFailure(error: unknown, message: string): PayFailure {
  if (error instanceof PayPalError) return fail("paypal_error", 502, message);
  throw error; // not a PayPal problem: let it surface as a server error
}
