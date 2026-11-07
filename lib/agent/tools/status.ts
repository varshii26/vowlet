import { z } from "zod";
import { loadWedding, resolveVendor } from "@/lib/agent/tools/data";
import { defineTool, type OrderLookup } from "@/lib/agent/tools/types";
import { formatCents } from "@/lib/money";

const money = (cents: number | null) => (cents === null ? null : { cents, label: formatCents(cents) });

type Live =
  | {
      checked: true;
      /** Which PayPal record answered: the capture (the payment itself) or, before capture, the checkout order. */
      source: "capture" | "order";
      orderStatus: string | null;
      capture: { status: string; amount: { cents: number; label: string } | null; capturedAt: string | null } | null;
      /** Does the captured amount equal the payment's amount? Null when nothing was captured. */
      amountMatches: boolean | null;
      payeeMatches: boolean | null;
    }
  | { checked: false; reason: string };

const REASONS = {
  not_connected: "PayPal isn't connected on this server, so only Vowlet's own record is shown.",
  not_found: "PayPal no longer has details for this order (checkout orders expire after some hours), so only Vowlet's own record is shown.",
  not_allowed: "PayPal won't show this payment's details to Vowlet's account, so only Vowlet's own record is shown.",
  unavailable: "PayPal couldn't be reached just now, so only Vowlet's own record is shown.",
  not_started: "Not started in PayPal yet.",
} as const;

const payeeCheck = (got: string | null, expected: string) => (got === null ? null : got.toLowerCase() === expected.toLowerCase());

/** Ask PayPal about one payment: by its capture when it has one, otherwise by its checkout order. */
async function lookUp(
  paypal: OrderLookup | null | undefined,
  payment: { paypalOrderId: string | null; captureId: string | null; amount: number },
  expectedPayee: string,
): Promise<Live> {
  if (!payment.paypalOrderId && !payment.captureId) return { checked: false, reason: REASONS.not_started };
  if (!paypal) return { checked: false, reason: REASONS.not_connected };

  if (payment.captureId) {
    const found = await paypal.getCapture(payment.captureId);
    if (found.ok) {
      const c = found.value;
      return {
        checked: true,
        source: "capture",
        orderStatus: null,
        capture: { status: c.status, amount: money(c.amount), capturedAt: c.createdAt },
        amountMatches: c.amount === null ? null : c.amount === payment.amount,
        payeeMatches: payeeCheck(c.payeeEmail, expectedPayee),
      };
    }
    if (!payment.paypalOrderId) return { checked: false, reason: REASONS[found.reason] };
  }

  const found = await paypal.getOrder(payment.paypalOrderId!);
  if (!found.ok) return { checked: false, reason: REASONS[found.reason] };
  const order = found.value;
  const c = order.captures[0] ?? null;
  return {
    checked: true,
    source: "order",
    orderStatus: order.status,
    capture: c ? { status: c.status, amount: money(c.amount), capturedAt: c.createdAt } : null,
    amountMatches: c?.amount == null ? null : c.amount === payment.amount,
    payeeMatches: payeeCheck(order.payeeEmail, expectedPayee),
  };
}

/** What PayPal's answer means, in words the couple can use. */
function meaning(vowletStatus: string, expectedCents: number, live: Live): string {
  if (!live.checked) return vowletStatus === "paid" ? "Paid, according to Vowlet's record." : "Not paid yet, according to Vowlet's record.";
  const captured = live.capture?.amount;
  if (live.amountMatches === false && captured) return `PayPal captured ${captured.label}, but ${formatCents(expectedCents)} was expected for this payment. Check it in PayPal.`;
  if (live.payeeMatches === false) return "PayPal shows a different recipient than this vendor's PayPal account. Check it in PayPal.";
  const status = live.capture?.status;
  switch (status) {
    case "COMPLETED":
      return "Paid: PayPal confirms the money was captured.";
    case "PENDING":
      return "Pending at PayPal: the payment was made but PayPal hasn't released it yet.";
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
      return `PayPal shows this payment as ${status === "REFUNDED" ? "refunded" : "partly refunded"}.`;
    case undefined:
      return live.orderStatus === "APPROVED" ? "Approved in PayPal but not captured yet." : `Started in PayPal (order ${String(live.orderStatus).toLowerCase()}) but not paid.`;
    default:
      return `PayPal reports the payment as ${status.toLowerCase()}.`;
  }
}

export const checkPaymentStatus = defineTool({
  name: "check_payment_status",
  description:
    "Did a payment go through? For one vendor's payments: Vowlet's status and, for any payment started in PayPal, what PayPal itself says now (capture status and amount, or the checkout order before capture). Read-only: it cannot pay, capture or refund anything. Use it for questions like 'did the photographer payment go through?'. Report the summary of each payment; if PayPal could not be checked, say so.",
  inputSchema: z.object({
    vendorId: z.string().describe("A vendor id or name."),
  }),
  run: async ({ vendorId }, { prisma, paypal }) => {
    const wedding = await loadWedding(prisma);
    const vendor = await resolveVendor(prisma, wedding.id, vendorId);
    const payments = await prisma.payment.findMany({ where: { vendorId: vendor.id }, orderBy: { label: "asc" } });

    const rows = [];
    for (const p of payments) {
      const live = await lookUp(paypal, p, vendor.paypalEmail);
      rows.push({
        paymentId: p.id,
        label: p.label,
        amount: money(p.amount),
        vowletStatus: p.status,
        paidAt: p.paidAt ? p.paidAt.toISOString().slice(0, 10) : null,
        paypal: live,
        summary: meaning(p.status, p.amount, live),
      });
    }
    return { vendorId: vendor.id, vendorName: vendor.name, payments: rows };
  },
});
