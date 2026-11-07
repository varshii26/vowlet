/**
 * Server-only PayPal client (sandbox), built on the official `@paypal/paypal-server-sdk`.
 *
 * - Orders, capture and refund go through the SDK's OrdersController / PaymentsController.
 * - The SDK owns the OAuth client-credentials token: one cached token per client, refreshed
 *   TOKEN_REFRESH_MARGIN_S before expiry. We only add de-duplication of concurrent token requests.
 * - Webhook signature verification isn't in the SDK, so it goes through the SDK's own request
 *   builder: same base URL, same cached token.
 * - Every SDK result is validated with Zod before we trust it. Money crosses the boundary as integer cents.
 *
 * Nothing here is exposed to the agent: paying only happens after the couple approves in the
 * PayPal popup, and the capture route calls `captureOrder` afterwards.
 */
import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  type OAuthToken,
  OrdersController,
  PaymentsController,
} from "@paypal/paypal-server-sdk";
import { z } from "zod";
import { centsToDecimalString, decimalStringToCents } from "@/lib/money";

if (typeof window !== "undefined") {
  throw new Error("lib/paypal.ts is server-only; never import it from client components.");
}

/** The SDK refreshes the token this many seconds before PayPal says it expires. */
export const TOKEN_REFRESH_MARGIN_S = 5 * 60;
const CURRENCY = "USD";

// ---------------------------------------------------------------------------
// Result schemas (only the fields we use; the SDK maps PayPal's JSON to camelCase)
// ---------------------------------------------------------------------------

const moneySchema = z.object({ currencyCode: z.string(), value: z.string() });

const createdOrderSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  links: z.array(z.object({ href: z.string(), rel: z.string() })).optional(),
});

const capturedOrderSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  purchaseUnits: z
    .array(
      z.object({
        payments: z.object({
          captures: z.array(z.object({ id: z.string().min(1), status: z.string(), amount: moneySchema.optional() })).min(1),
        }),
      }),
    )
    .min(1),
});

// GET /v2/checkout/orders/{id}: an order may have no payments yet (created or approved, not captured).
const orderDetailsSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  purchaseUnits: z
    .array(
      z.object({
        amount: moneySchema.optional(),
        payee: z.object({ emailAddress: z.string().optional() }).optional(),
        payments: z
          .object({
            captures: z.array(z.object({ id: z.string().min(1), status: z.string(), amount: moneySchema.optional(), createTime: z.string().optional() })).optional(),
          })
          .optional(),
      }),
    )
    .min(1),
});

// GET /v2/payments/captures/{id}: the payment itself, kept by PayPal after the checkout order is gone.
const captureDetailsSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  amount: moneySchema.optional(),
  payee: z.object({ emailAddress: z.string().optional() }).optional(),
  createTime: z.string().optional(),
  supplementaryData: z.object({ relatedIds: z.object({ orderId: z.string().optional() }).optional() }).optional(),
});

const refundSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  amount: moneySchema.optional(),
});

// Not an SDK model: raw JSON from /v1/notifications/verify-webhook-signature.
const verifyResponseSchema = z.object({ verification_status: z.enum(["SUCCESS", "FAILURE"]) });

const errorBodySchema = z
  .object({
    name: z.string().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
    error_description: z.string().optional(),
    debug_id: z.string().optional(),
    details: z.array(z.object({ issue: z.string().optional(), description: z.string().optional() })).optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PayPalConfig = {
  clientId: string;
  clientSecret: string;
  environment?: Environment;
  webhookId?: string;
  /** Passed to the SDK's HTTP client (axios config). Tests inject an `adapter` here. */
  httpClientOverrides?: Record<string, unknown>;
};

/** The fields of a Payment / Vendor row that createOrder needs. */
export type OrderPayment = { id: string; label: string; amount: number };
export type OrderVendor = { name: string; paypalEmail: string };

export type CreatedOrder = { orderId: string; status: string; approveUrl: string | null };

export type CapturedOrder = {
  orderId: string;
  status: string;
  captureId: string;
  captureStatus: string;
  /** Captured amount in cents, if PayPal returned it. */
  amount: number | null;
};

export type Refund = { refundId: string; status: string; amount: number | null };

/** What PayPal says about an order right now. Read-only. */
export type OrderDetails = {
  orderId: string;
  /** CREATED, APPROVED, COMPLETED, VOIDED, ... */
  status: string;
  /** Order amount in cents. */
  amount: number | null;
  payeeEmail: string | null;
  captures: Array<{ captureId: string; status: string; amount: number | null; createdAt: string | null }>;
};

/** What PayPal says about a captured payment right now. Read-only. */
export type CaptureDetails = {
  captureId: string;
  /** COMPLETED, PENDING, REFUNDED, PARTIALLY_REFUNDED, DECLINED, ... */
  status: string;
  amount: number | null;
  payeeEmail: string | null;
  createdAt: string | null;
  orderId: string | null;
};

/**
 * A lookup that never throws. `not_found`: PayPal has no such record (checkout orders
 * stop being served after some hours). `not_allowed`: PayPal won't show it to this app
 * (seen for captures paid to an account the app doesn't own). `unavailable`: anything else.
 */
export type Lookup<T> = { ok: true; value: T } | { ok: false; reason: "not_found" | "not_allowed" | "unavailable" };

/**
 * The only PayPal access the agent gets: looking orders and captures up. It has no
 * way to create, capture or refund, because those functions are simply not on it.
 */
export type PayPalReader = {
  readonly getOrder: (orderId: string) => Promise<Lookup<OrderDetails>>;
  readonly getCapture: (captureId: string) => Promise<Lookup<CaptureDetails>>;
};

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly debugId: string | null = null,
    readonly issue: string | null = null,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export function createPayPalClient(config: PayPalConfig) {
  // The SDK caches the token but lets concurrent calls each fetch one when none is cached;
  // share a single in-flight token request instead.
  let tokenInFlight: Promise<OAuthToken> | null = null;
  const client = new Client({
    environment: config.environment ?? Environment.Sandbox,
    timeout: 30_000,
    clientCredentialsAuthCredentials: {
      oAuthClientId: config.clientId,
      oAuthClientSecret: config.clientSecret,
      oAuthClockSkew: TOKEN_REFRESH_MARGIN_S,
      oAuthTokenProvider: (last, manager) => {
        tokenInFlight ??= manager.updateToken(last).finally(() => {
          tokenInFlight = null;
        });
        return tokenInFlight;
      },
    },
    unstable_httpClientOptions: config.httpClientOverrides,
  });
  const orders = new OrdersController(client);
  const payments = new PaymentsController(client);

  /**
   * Create a CAPTURE order paying the vendor directly (vendor is the payee).
   * Each call makes a fresh order (e.g. after the couple closes the popup); capture is the idempotent step.
   */
  async function createOrder(payment: OrderPayment, vendor: OrderVendor): Promise<CreatedOrder> {
    if (!Number.isSafeInteger(payment.amount) || payment.amount <= 0) {
      throw new PayPalError(`Payment ${payment.id} has invalid amount ${payment.amount}`, null);
    }
    const { result } = await call(() =>
      orders.createOrder({
        body: {
          intent: CheckoutPaymentIntent.Capture,
          purchaseUnits: [
            {
              referenceId: payment.id,
              customId: payment.id,
              description: `${vendor.name}: ${payment.label}`.slice(0, 127),
              amount: { currencyCode: CURRENCY, value: centsToDecimalString(payment.amount) },
              payee: { emailAddress: vendor.paypalEmail },
            },
          ],
        },
        prefer: "return=representation",
      }),
    );
    const order = parse(createdOrderSchema, result, "create order");
    const approve = order.links?.find((l) => l.rel === "approve" || l.rel === "payer-action");
    return { orderId: order.id, status: order.status, approveUrl: approve?.href ?? null };
  }

  /** Look an order up. Read-only: changes nothing at PayPal. */
  async function getOrder(orderId: string): Promise<OrderDetails> {
    const { result } = await call(() => orders.getOrder({ id: orderId }));
    const order = parse(orderDetailsSchema, result, "get order");
    const unit = order.purchaseUnits[0];
    return {
      orderId: order.id,
      status: order.status,
      amount: unit.amount ? toCents(unit.amount) : null,
      payeeEmail: unit.payee?.emailAddress ?? null,
      captures: (unit.payments?.captures ?? []).map((c) => ({ captureId: c.id, status: c.status, amount: c.amount ? toCents(c.amount) : null, createdAt: c.createTime ?? null })),
    };
  }

  /** Look a captured payment up. Read-only: changes nothing at PayPal. */
  async function getCapture(captureId: string): Promise<CaptureDetails> {
    const { result } = await call(() => payments.getCapturedPayment({ captureId }));
    const capture = parse(captureDetailsSchema, result, "get capture");
    return {
      captureId: capture.id,
      status: capture.status,
      amount: capture.amount ? toCents(capture.amount) : null,
      payeeEmail: capture.payee?.emailAddress ?? null,
      createdAt: capture.createTime ?? null,
      orderId: capture.supplementaryData?.relatedIds?.orderId ?? null,
    };
  }

  /** Capture an order the couple has approved in the PayPal popup. Idempotent per order id. */
  async function captureOrder(orderId: string): Promise<CapturedOrder> {
    const { result } = await call(() =>
      orders.captureOrder({ id: orderId, paypalRequestId: `capture-${orderId}`, prefer: "return=representation" }),
    );
    const order = parse(capturedOrderSchema, result, "capture order");
    const capture = order.purchaseUnits[0].payments.captures[0];
    return {
      orderId: order.id,
      status: order.status,
      captureId: capture.id,
      captureStatus: capture.status,
      amount: capture.amount ? toCents(capture.amount) : null,
    };
  }

  /**
   * Refund a capture, fully (amount omitted) or partially (amount in cents).
   * Note: PayPal only lets the account that received the money refund it; see issue #10.
   */
  async function refundCapture(captureId: string, amount?: number): Promise<Refund> {
    if (amount !== undefined && (!Number.isSafeInteger(amount) || amount <= 0)) {
      throw new PayPalError(`Invalid refund amount ${amount}`, null);
    }
    const { result } = await call(() =>
      payments.refundCapturedPayment({
        captureId,
        paypalRequestId: `refund-${captureId}-${amount ?? "full"}`,
        prefer: "return=representation",
        body: amount === undefined ? {} : { amount: { currencyCode: CURRENCY, value: centsToDecimalString(amount) } },
      }),
    );
    const refund = parse(refundSchema, result, "refund capture");
    return { refundId: refund.id, status: refund.status, amount: refund.amount ? toCents(refund.amount) : null };
  }

  /**
   * Verify a webhook delivery with PayPal. `rawBody` must be the exact request body text:
   * it is spliced into the request unparsed, because re-serializing the event can break the signature.
   * Returns false (never throws) for missing headers, a non-JSON body or a FAILURE verdict.
   */
  async function verifyWebhookSignature(headers: Headers, rawBody: string): Promise<boolean> {
    if (!config.webhookId) throw new PayPalError("PAYPAL_WEBHOOK_ID is not set", null);
    const h = {
      auth_algo: headers.get("paypal-auth-algo"),
      cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"),
      transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"),
    };
    if (Object.values(h).some((v) => !v)) return false;
    try {
      JSON.parse(rawBody);
    } catch {
      return false;
    }
    const prefix = JSON.stringify({ ...h, webhook_id: config.webhookId });
    const body = `${prefix.slice(0, -1)},"webhook_event":${rawBody}}`;

    const req = client.getRequestBuilderFactory()("POST", "/v1/notifications/verify-webhook-signature");
    req.header("Content-Type", "application/json");
    req.text(body);
    req.authenticate([{ oauth2: true }]);
    const { result } = await call(() => req.callAsText());
    let json: unknown;
    try {
      json = JSON.parse(result);
    } catch {
      json = result;
    }
    return parse(verifyResponseSchema, json, "verify webhook").verification_status === "SUCCESS";
  }

  return { createOrder, getOrder, getCapture, captureOrder, refundCapture, verifyWebhookSignature };
}

export type PayPalClient = ReturnType<typeof createPayPalClient>;

// ---------------------------------------------------------------------------
// Default client from env (lazy, so importing this file never throws at build time)
// ---------------------------------------------------------------------------

let defaultClient: PayPalClient | null = null;

/**
 * A reader over a client: a new frozen object holding only `getOrder`, so handing
 * it to the agent exposes nothing that moves money, even by reflection.
 */
export function readOnly(client: Pick<PayPalClient, "getOrder" | "getCapture">): PayPalReader {
  const safely = async <T>(fn: () => Promise<T>): Promise<Lookup<T>> => {
    try {
      return { ok: true, value: await fn() };
    } catch (error) {
      const status = error instanceof PayPalError ? error.status : null;
      return { ok: false, reason: status === 404 ? "not_found" : status === 401 || status === 403 ? "not_allowed" : "unavailable" };
    }
  };
  const getOrder = (orderId: string) => safely(() => client.getOrder(orderId));
  const getCapture = (captureId: string) => safely(() => client.getCapture(captureId));
  return Object.freeze({ getOrder, getCapture });
}

/** The default reader, or null when PayPal isn't configured (the agent then says so). */
export function paypalReader(): PayPalReader | null {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) return null;
  return readOnly(paypal());
}

export function paypal(): PayPalClient {
  if (!defaultClient) {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new PayPalError("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set", null);
    }
    defaultClient = createPayPalClient({
      clientId,
      clientSecret,
      environment: Environment.Sandbox, // sandbox only; see CLAUDE.md
      webhookId: process.env.PAYPAL_WEBHOOK_ID || undefined,
    });
  }
  return defaultClient;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run an SDK call, turning SDK errors into PayPalError with PayPal's issue code and debug id. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) throw fromApiError(err);
    if (err instanceof PayPalError) throw err;
    throw new PayPalError(`PayPal request failed: ${err instanceof Error ? err.message : String(err)}`, null);
  }
}

function fromApiError(err: ApiError<unknown>): PayPalError {
  let body: unknown = err.result;
  if (body === undefined && typeof err.body === "string") {
    try {
      body = JSON.parse(err.body);
    } catch {
      body = undefined;
    }
  }
  const parsed = errorBodySchema.safeParse(body);
  const b = parsed.success ? parsed.data : {};
  const issue = b.details?.[0]?.issue ?? b.name ?? b.error ?? null;
  const message = b.details?.[0]?.description ?? b.message ?? b.error_description ?? err.message;
  const debugId = err.headers?.["paypal-debug-id"] ?? b.debug_id ?? null;
  return new PayPalError(`${message} (HTTP ${err.statusCode})`, err.statusCode, debugId, issue);
}

function parse<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new PayPalError(`Unexpected PayPal ${what} response: ${z.prettifyError(result.error)}`, null);
  }
  return result.data;
}

function toCents(money: z.infer<typeof moneySchema>): number {
  if (money.currencyCode !== CURRENCY) {
    throw new PayPalError(`Unexpected currency ${money.currencyCode}`, null);
  }
  return decimalStringToCents(money.value);
}
