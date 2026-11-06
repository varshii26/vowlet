import { describe, expect, it, vi } from "vitest";
import { createPayPalClient, PayPalError, TOKEN_REFRESH_MARGIN_MS } from "@/lib/paypal";

const API = "https://api-m.sandbox.paypal.com";

type Call = { url: string; init: RequestInit };
type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

/** Fake fetch: token requests get a token; other requests are answered from `routes` in order. */
function setup(routes: Reply[] = [], opts: { expiresIn?: number; webhookId?: string } = {}) {
  const calls: Call[] = [];
  let clock = 1_000_000;
  let tokenCount = 0;
  const queue = [...routes];
  const fetchMock = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/v1/oauth2/token")) {
      tokenCount++;
      return json({ access_token: `tok-${tokenCount}`, token_type: "Bearer", expires_in: opts.expiresIn ?? 32400 });
    }
    const reply = queue.shift();
    if (!reply) throw new Error(`Unexpected request to ${url}`);
    return json(reply.body ?? null, reply.status ?? 200, reply.headers);
  });
  const client = createPayPalClient({
    clientId: "cid",
    clientSecret: "secret",
    apiBase: API,
    webhookId: opts.webhookId,
    fetch: fetchMock as unknown as typeof fetch,
    now: () => clock,
  });
  return {
    client,
    calls,
    apiCalls: () => calls.filter((c) => !c.url.endsWith("/v1/oauth2/token")),
    tokenCalls: () => calls.filter((c) => c.url.endsWith("/v1/oauth2/token")),
    advance: (ms: number) => (clock += ms),
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(body === null ? "" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];
const bodyOf = (c: Call) => JSON.parse(String(c.init.body));

const orderReply = {
  body: {
    id: "ORDER-1",
    status: "CREATED",
    links: [{ href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1", rel: "approve", method: "GET" }],
  },
};

const captureReply = {
  body: {
    id: "ORDER-1",
    status: "COMPLETED",
    purchase_units: [
      {
        reference_id: "pay_1",
        payments: {
          captures: [{ id: "CAP-1", status: "COMPLETED", amount: { currency_code: "USD", value: "1500.50" } }],
        },
      },
    ],
  },
};

const payment = { id: "pay_1", label: "Deposit", amount: 150_050 };
const vendor = { name: "Bloom & Vine", paypalEmail: "florist@example.com" };

describe("OAuth token cache", () => {
  it("requests a token with client credentials and Basic auth", async () => {
    const t = setup();
    expect(await t.client.getAccessToken()).toBe("tok-1");
    const [call] = t.tokenCalls();
    expect(call.url).toBe(`${API}/v1/oauth2/token`);
    expect(call.init.method).toBe("POST");
    expect(call.init.body).toBe("grant_type=client_credentials");
    expect(header(call, "Authorization")).toBe(`Basic ${Buffer.from("cid:secret").toString("base64")}`);
  });

  it("reuses the token across calls until near expiry, then refreshes", async () => {
    const t = setup([orderReply, orderReply, orderReply], { expiresIn: 3600 });
    await t.client.createOrder(payment, vendor);
    await t.client.createOrder(payment, vendor);
    expect(t.tokenCalls()).toHaveLength(1);
    expect(t.apiCalls().map((c) => header(c, "Authorization"))).toEqual(["Bearer tok-1", "Bearer tok-1"]);

    // Still valid just outside the refresh margin.
    t.advance(3600_000 - TOKEN_REFRESH_MARGIN_MS - 1);
    expect(await t.client.getAccessToken()).toBe("tok-1");

    // Inside the margin: refresh before PayPal would reject it.
    t.advance(1);
    await t.client.createOrder(payment, vendor);
    expect(t.tokenCalls()).toHaveLength(2);
    expect(header(t.apiCalls()[2], "Authorization")).toBe("Bearer tok-2");
  });

  it("shares one token request between concurrent callers", async () => {
    const t = setup();
    const tokens = await Promise.all([t.client.getAccessToken(), t.client.getAccessToken(), t.client.getAccessToken()]);
    expect(tokens).toEqual(["tok-1", "tok-1", "tok-1"]);
    expect(t.tokenCalls()).toHaveLength(1);
  });

  it("drops the cached token and retries once on 401", async () => {
    const t = setup([{ status: 401, body: { error: "invalid_token" } }, orderReply]);
    const order = await t.client.createOrder(payment, vendor);
    expect(order.orderId).toBe("ORDER-1");
    expect(t.tokenCalls()).toHaveLength(2);
    expect(t.apiCalls().map((c) => header(c, "Authorization"))).toEqual(["Bearer tok-1", "Bearer tok-2"]);
  });

  it("does not cache a malformed token response", async () => {
    const calls: string[] = [];
    let n = 0;
    const client = createPayPalClient({
      clientId: "cid",
      clientSecret: "secret",
      apiBase: API,
      fetch: (async (url: string) => {
        calls.push(url);
        n++;
        return json(n === 1 ? { token_type: "Bearer" } : { access_token: "good", token_type: "Bearer", expires_in: 100 });
      }) as unknown as typeof fetch,
    });
    await expect(client.getAccessToken()).rejects.toThrow(PayPalError);
    expect(await client.getAccessToken()).toBe("good");
  });
});

describe("createOrder", () => {
  it("creates a CAPTURE order with the vendor as payee and the amount from cents", async () => {
    const t = setup([orderReply]);
    const order = await t.client.createOrder(payment, vendor);
    expect(order).toEqual({
      orderId: "ORDER-1",
      status: "CREATED",
      approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1",
    });
    const [call] = t.apiCalls();
    expect(call.url).toBe(`${API}/v2/checkout/orders`);
    const body = bodyOf(call);
    expect(body.intent).toBe("CAPTURE");
    expect(body.purchase_units[0]).toMatchObject({
      reference_id: "pay_1",
      custom_id: "pay_1",
      amount: { currency_code: "USD", value: "1500.50" },
      payee: { email_address: "florist@example.com" },
    });
  });

  it("rejects non-positive or fractional amounts without calling PayPal", async () => {
    const t = setup();
    await expect(t.client.createOrder({ ...payment, amount: 0 }, vendor)).rejects.toThrow(PayPalError);
    await expect(t.client.createOrder({ ...payment, amount: 10.5 }, vendor)).rejects.toThrow(PayPalError);
    expect(t.calls).toHaveLength(0);
  });

  it("rejects a response without an order id", async () => {
    const t = setup([{ body: { status: "CREATED" } }]);
    await expect(t.client.createOrder(payment, vendor)).rejects.toThrow(/Unexpected PayPal create order response/);
  });

  it("surfaces PayPal error details and debug id", async () => {
    const t = setup([
      {
        status: 422,
        headers: { "paypal-debug-id": "dbg123" },
        body: {
          name: "UNPROCESSABLE_ENTITY",
          message: "The requested action could not be performed.",
          details: [{ issue: "PAYEE_ACCOUNT_INVALID", description: "Payee account is invalid." }],
        },
      },
    ]);
    const err = await t.client.createOrder(payment, vendor).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err).toMatchObject({ status: 422, debugId: "dbg123", issue: "PAYEE_ACCOUNT_INVALID" });
    expect((err as Error).message).toContain("Payee account is invalid.");
  });
});

describe("captureOrder", () => {
  it("captures with an idempotency key and returns the capture id and cents", async () => {
    const t = setup([captureReply]);
    const result = await t.client.captureOrder("ORDER-1");
    expect(result).toEqual({
      orderId: "ORDER-1",
      status: "COMPLETED",
      captureId: "CAP-1",
      captureStatus: "COMPLETED",
      amount: 150_050,
    });
    const [call] = t.apiCalls();
    expect(call.url).toBe(`${API}/v2/checkout/orders/ORDER-1/capture`);
    expect(header(call, "PayPal-Request-Id")).toBe("capture-ORDER-1");
  });

  it("rejects a response with no captures", async () => {
    const t = setup([{ body: { id: "ORDER-1", status: "COMPLETED", purchase_units: [{ payments: { captures: [] } }] } }]);
    await expect(t.client.captureOrder("ORDER-1")).rejects.toThrow(PayPalError);
  });

  it("rejects a non-USD capture amount", async () => {
    const reply = structuredClone(captureReply);
    reply.body.purchase_units[0].payments.captures[0].amount.currency_code = "EUR";
    const t = setup([reply]);
    await expect(t.client.captureOrder("ORDER-1")).rejects.toThrow(/currency/);
  });
});

describe("refundCapture", () => {
  it("issues a partial refund in decimal dollars", async () => {
    const t = setup([{ body: { id: "REF-1", status: "COMPLETED", amount: { currency_code: "USD", value: "250.00" } } }]);
    expect(await t.client.refundCapture("CAP-1", 25_000)).toEqual({ refundId: "REF-1", status: "COMPLETED", amount: 25_000 });
    const [call] = t.apiCalls();
    expect(call.url).toBe(`${API}/v2/payments/captures/CAP-1/refund`);
    expect(bodyOf(call)).toEqual({ amount: { currency_code: "USD", value: "250.00" } });
  });

  it("sends an empty body for a full refund", async () => {
    const t = setup([{ body: { id: "REF-2", status: "COMPLETED" } }]);
    expect(await t.client.refundCapture("CAP-1")).toEqual({ refundId: "REF-2", status: "COMPLETED", amount: null });
    expect(bodyOf(t.apiCalls()[0])).toEqual({});
  });
});

describe("verifyWebhookSignature", () => {
  const rawBody = '{"id":"WH-1","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"id":"CAP-1","amount":{"value":"1500.50"}}}';
  const headers = () =>
    new Headers({
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": "https://api.sandbox.paypal.com/cert.pem",
      "paypal-transmission-id": "tx-1",
      "paypal-transmission-sig": "sig",
      "paypal-transmission-time": "2027-01-01T00:00:00Z",
    });

  it("posts the headers, webhook id and the raw event body unchanged", async () => {
    const t = setup([{ body: { verification_status: "SUCCESS" } }], { webhookId: "WHID" });
    expect(await t.client.verifyWebhookSignature(headers(), rawBody)).toBe(true);
    const [call] = t.apiCalls();
    expect(call.url).toBe(`${API}/v1/notifications/verify-webhook-signature`);
    expect(String(call.init.body).endsWith(`"webhook_event":${rawBody}}`)).toBe(true);
    expect(bodyOf(call)).toMatchObject({
      auth_algo: "SHA256withRSA",
      cert_url: "https://api.sandbox.paypal.com/cert.pem",
      transmission_id: "tx-1",
      transmission_sig: "sig",
      transmission_time: "2027-01-01T00:00:00Z",
      webhook_id: "WHID",
      webhook_event: JSON.parse(rawBody),
    });
  });

  it("returns false on a FAILURE verdict", async () => {
    const t = setup([{ body: { verification_status: "FAILURE" } }], { webhookId: "WHID" });
    expect(await t.client.verifyWebhookSignature(headers(), rawBody)).toBe(false);
  });

  it("returns false without calling PayPal when headers are missing or the body is not JSON", async () => {
    const t = setup([], { webhookId: "WHID" });
    const partial = headers();
    partial.delete("paypal-transmission-sig");
    expect(await t.client.verifyWebhookSignature(partial, rawBody)).toBe(false);
    expect(await t.client.verifyWebhookSignature(headers(), "not json")).toBe(false);
    expect(t.calls).toHaveLength(0);
  });

  it("throws when PAYPAL_WEBHOOK_ID is not configured", async () => {
    const t = setup();
    await expect(t.client.verifyWebhookSignature(headers(), rawBody)).rejects.toThrow(/PAYPAL_WEBHOOK_ID/);
  });

  it("rejects an unexpected verification response", async () => {
    const t = setup([{ body: { verification_status: "MAYBE" } }], { webhookId: "WHID" });
    await expect(t.client.verifyWebhookSignature(headers(), rawBody)).rejects.toThrow(PayPalError);
  });
});
