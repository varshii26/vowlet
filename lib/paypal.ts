/**
 * Server-only PayPal REST client (sandbox). Orders v2, capture, refund, webhook verification.
 *
 * - OAuth client-credentials token is cached and reused until shortly before it expires.
 * - Every PayPal response is validated with Zod before we trust it.
 * - Money goes in and out as integer cents; PayPal's decimal strings are converted at the edge.
 *
 * Nothing here is exposed to the agent: paying only happens after the couple approves in the
 * PayPal popup, and the capture route calls `captureOrder` afterwards.
 */
import { z } from "zod";
import { centsToDecimalString, decimalStringToCents } from "@/lib/money";

if (typeof window !== "undefined") {
  throw new Error("lib/paypal.ts is server-only; never import it from client components.");
}

/** Refresh the token this long before PayPal says it expires. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const CURRENCY = "USD";

// ---------------------------------------------------------------------------
// Response schemas (only the fields we use; PayPal sends many more)
// ---------------------------------------------------------------------------

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().int().positive(), // seconds
});

const moneySchema = z.object({
  currency_code: z.string(),
  value: z.string(),
});

const linkSchema = z.object({ href: z.string(), rel: z.string(), method: z.string().optional() });

const orderResponseSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  links: z.array(linkSchema).optional(),
});

const captureSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  amount: moneySchema.optional(),
});

const captureResponseSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  purchase_units: z
    .array(
      z.object({
        reference_id: z.string().optional(),
        payments: z.object({ captures: z.array(captureSchema).min(1) }),
      }),
    )
    .min(1),
});

const refundResponseSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  amount: moneySchema.optional(),
});

const verifyResponseSchema = z.object({
  verification_status: z.enum(["SUCCESS", "FAILURE"]),
});

const errorBodySchema = z
  .object({
    name: z.string().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
    error_description: z.string().optional(),
    details: z.array(z.object({ issue: z.string().optional(), description: z.string().optional() })).optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PayPalConfig = {
  clientId: string;
  clientSecret: string;
  apiBase: string;
  webhookId?: string;
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
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
  const doFetch = config.fetch ?? fetch;
  const now = config.now ?? Date.now;
  const apiBase = config.apiBase.replace(/\/+$/, "");

  let cached: { token: string; expiresAt: number } | null = null;
  let inFlight: Promise<string> | null = null;

  async function fetchToken(): Promise<string> {
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    const res = await doFetch(`${apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
      cache: "no-store",
    });
    const body = await readJson(res);
    if (!res.ok) throw toPayPalError(res, body, "OAuth token request failed");
    const parsed = parse(tokenResponseSchema, body, "OAuth token");
    cached = { token: parsed.access_token, expiresAt: now() + parsed.expires_in * 1000 };
    return parsed.access_token;
  }

  /** Cached token, refreshed when within TOKEN_REFRESH_MARGIN_MS of expiry. Concurrent callers share one request. */
  async function getAccessToken(): Promise<string> {
    if (cached && now() < cached.expiresAt - TOKEN_REFRESH_MARGIN_MS) return cached.token;
    if (!inFlight) {
      inFlight = fetchToken().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  /** Authenticated JSON call. Retries once with a fresh token if PayPal rejects the cached one. */
  async function api(
    method: "GET" | "POST",
    path: string,
    options: { body?: string; requestId?: string } = {},
  ): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const token = await getAccessToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
      };
      if (options.requestId) headers["PayPal-Request-Id"] = options.requestId;
      const res = await doFetch(`${apiBase}${path}`, { method, headers, body: options.body, cache: "no-store" });
      const body = await readJson(res);
      if (res.status === 401 && attempt === 0) {
        cached = null;
        continue;
      }
      if (!res.ok) throw toPayPalError(res, body, `PayPal ${method} ${path} failed`);
      return body;
    }
  }

  /**
   * Create a CAPTURE order paying the vendor directly (vendor is the payee).
   * Each call makes a fresh order (e.g. after the couple closes the popup); capture is the idempotent step.
   */
  async function createOrder(payment: OrderPayment, vendor: OrderVendor): Promise<CreatedOrder> {
    if (!Number.isSafeInteger(payment.amount) || payment.amount <= 0) {
      throw new PayPalError(`Payment ${payment.id} has invalid amount ${payment.amount}`, null);
    }
    const body = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: payment.id,
          custom_id: payment.id,
          description: `${vendor.name}: ${payment.label}`.slice(0, 127),
          amount: { currency_code: CURRENCY, value: centsToDecimalString(payment.amount) },
          payee: { email_address: vendor.paypalEmail },
        },
      ],
    };
    const raw = await api("POST", "/v2/checkout/orders", { body: JSON.stringify(body) });
    const order = parse(orderResponseSchema, raw, "create order");
    const approve = order.links?.find((l) => l.rel === "approve" || l.rel === "payer-action");
    return { orderId: order.id, status: order.status, approveUrl: approve?.href ?? null };
  }

  /** Capture an order the couple has approved in the PayPal popup. Idempotent per order id. */
  async function captureOrder(orderId: string): Promise<CapturedOrder> {
    const raw = await api("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      requestId: `capture-${orderId}`,
    });
    const order = parse(captureResponseSchema, raw, "capture order");
    const capture = order.purchase_units[0].payments.captures[0];
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
    const body = amount === undefined ? {} : { amount: { currency_code: CURRENCY, value: centsToDecimalString(amount) } };
    const raw = await api("POST", `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
      body: JSON.stringify(body),
      requestId: `refund-${captureId}-${amount ?? "full"}`,
    });
    const refund = parse(refundResponseSchema, raw, "refund capture");
    return { refundId: refund.id, status: refund.status, amount: refund.amount ? toCents(refund.amount) : null };
  }

  /**
   * Verify a webhook delivery with PayPal. `rawBody` must be the exact request body text:
   * it is spliced into the request unparsed, because re-serializing the event can break the signature.
   * Returns false (never throws) for missing headers or a FAILURE verdict.
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
    const raw = await api("POST", "/v1/notifications/verify-webhook-signature", { body });
    return parse(verifyResponseSchema, raw, "verify webhook").verification_status === "SUCCESS";
  }

  return { getAccessToken, createOrder, captureOrder, refundCapture, verifyWebhookSignature };
}

export type PayPalClient = ReturnType<typeof createPayPalClient>;

// ---------------------------------------------------------------------------
// Default client from env (lazy, so importing this file never throws at build time)
// ---------------------------------------------------------------------------

let defaultClient: PayPalClient | null = null;

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
      apiBase: process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com",
      webhookId: process.env.PAYPAL_WEBHOOK_ID || undefined,
    });
  }
  return defaultClient;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parse<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new PayPalError(`Unexpected PayPal ${what} response: ${z.prettifyError(result.error)}`, null);
  }
  return result.data;
}

function toCents(money: z.infer<typeof moneySchema>): number {
  if (money.currency_code !== CURRENCY) {
    throw new PayPalError(`Unexpected currency ${money.currency_code}`, null);
  }
  return decimalStringToCents(money.value);
}

function toPayPalError(res: Response, body: unknown, fallback: string): PayPalError {
  const parsed = errorBodySchema.safeParse(body);
  const b = parsed.success ? parsed.data : {};
  const issue = b.details?.[0]?.issue ?? b.name ?? b.error ?? null;
  const message = b.details?.[0]?.description ?? b.message ?? b.error_description ?? fallback;
  return new PayPalError(`${message} (HTTP ${res.status})`, res.status, res.headers.get("paypal-debug-id"), issue);
}
