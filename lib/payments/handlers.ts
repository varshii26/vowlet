import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { PayPalError } from "@/lib/paypal";
import {
  capturePaymentOrder,
  createPaymentOrder,
  type PayFailure,
  type PayPalPort,
} from "@/lib/payments/service";

/**
 * HTTP handling for the pay routes, kept apart from the route files so it can be
 * tested with a fake PayPal. Responses are `{ ok: true, ... }` or
 * `{ ok: false, error: { code, message } }`; messages are safe to show the couple.
 */
export type HandlerDeps = {
  prisma: PrismaClient;
  /** Lazily built, because it throws when PayPal credentials are missing. */
  paypal: () => PayPalPort;
  /** The caller's wedding, from their session; null if they have none yet. */
  resolveWeddingId: () => Promise<string | null>;
};

const notFound = () => failure({ code: "not_found", message: "That payment does not exist.", status: 404 });

const captureBodySchema = z.object({ orderId: z.string().min(1).max(64) });

const failure = (f: Pick<PayFailure, "code" | "message" | "status">) =>
  Response.json({ ok: false, error: { code: f.code, message: f.message } }, { status: f.status });

const badRequest = (message: string) => failure({ code: "bad_request", message, status: 400 });

/** PayPal client, or null (and a 503 for the caller) when it is not configured. */
function tryPayPal(deps: HandlerDeps): PayPalPort | Response {
  try {
    return deps.paypal();
  } catch (error) {
    if (error instanceof PayPalError) {
      return Response.json(
        { ok: false, error: { code: "not_configured", message: "PayPal isn't set up on this server yet." } },
        { status: 503 },
      );
    }
    throw error;
  }
}

/** POST /api/payments/[id]/order */
export async function createOrderHandler(paymentId: string, deps: HandlerDeps): Promise<Response> {
  const weddingId = await deps.resolveWeddingId();
  if (!weddingId) return notFound();
  const paypal = tryPayPal(deps);
  if (paypal instanceof Response) return paypal;

  const result = await createPaymentOrder(deps.prisma, paypal, weddingId, paymentId);
  return result.ok ? Response.json({ ok: true, orderId: result.orderId }) : failure(result);
}

/** POST /api/payments/[id]/capture with body `{ orderId }` */
export async function captureHandler(paymentId: string, request: Request, deps: HandlerDeps): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("The request body must be JSON.");
  }
  const parsed = captureBodySchema.safeParse(body);
  if (!parsed.success) return badRequest("An orderId is required.");

  const weddingId = await deps.resolveWeddingId();
  if (!weddingId) return notFound();
  const paypal = tryPayPal(deps);
  if (paypal instanceof Response) return paypal;

  const result = await capturePaymentOrder(deps.prisma, paypal, weddingId, paymentId, parsed.data.orderId);
  if (!result.ok) return failure(result);
  // 202: PayPal accepted the payment but has not finished processing it.
  return Response.json({ ok: true, state: result.state, message: result.message }, { status: result.state === "pending" ? 202 : 200 });
}
