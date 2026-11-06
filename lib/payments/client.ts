import { z } from "zod";

/**
 * Browser-side calls to the pay routes. Every outcome, including network
 * failures and unexpected responses, comes back as a result with a message the
 * couple can read; nothing here throws.
 */

const failureSchema = z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) });
const orderSchema = z.object({ ok: z.literal(true), orderId: z.string().min(1) });
const captureSchema = z.object({
  ok: z.literal(true),
  state: z.enum(["paid", "already_paid", "pending"]),
  message: z.string(),
});

export type OrderOutcome = { ok: true; orderId: string } | { ok: false; message: string };
export type CaptureOutcome = { ok: true; state: "paid" | "already_paid" | "pending"; message: string } | { ok: false; message: string };

const NETWORK = "Couldn't reach Vowlet. Check your connection and try again.";
const UNEXPECTED = "Something unexpected happened. Nothing was charged. Please try again.";

async function post(path: string, body?: unknown): Promise<{ json: unknown } | { message: string }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { json: await res.json().catch(() => null) };
  } catch {
    return { message: NETWORK };
  }
}

function failureMessage(json: unknown): string {
  const parsed = failureSchema.safeParse(json);
  return parsed.success ? parsed.data.error.message : UNEXPECTED;
}

/** Ask the server to create the PayPal order for a payment. */
export async function requestOrder(paymentId: string): Promise<OrderOutcome> {
  const res = await post(`/api/payments/${encodeURIComponent(paymentId)}/order`);
  if ("message" in res) return { ok: false, message: res.message };
  const parsed = orderSchema.safeParse(res.json);
  return parsed.success ? parsed.data : { ok: false, message: failureMessage(res.json) };
}

/** Ask the server to capture an order the couple approved in PayPal. */
export async function requestCapture(paymentId: string, orderId: string): Promise<CaptureOutcome> {
  const res = await post(`/api/payments/${encodeURIComponent(paymentId)}/capture`, { orderId });
  if ("message" in res) return { ok: false, message: res.message };
  const parsed = captureSchema.safeParse(res.json);
  return parsed.success ? parsed.data : { ok: false, message: failureMessage(res.json) };
}
