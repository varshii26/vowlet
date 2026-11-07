import { afterEach, describe, expect, it, vi } from "vitest";
import { createPayPalClient, PayPalError, readOnly, TOKEN_REFRESH_MARGIN_S } from "@/lib/paypal";

const API = "https://api-m.sandbox.paypal.com";

type Call = { url: string; method: string; headers: Record<string, string>; data: string | undefined };
type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

/**
 * Fake HTTP layer injected into the SDK's axios client: the SDK's real token caching,
 * request building and response mapping all run; only the network is replaced.
 * Token requests get a fresh token; other requests are answered from `routes` in order.
 */
function setup(routes: Reply[] = [], opts: { expiresIn?: number; webhookId?: string } = {}) {
  const calls: Call[] = [];
  let tokenCount = 0;
  const queue = [...routes];
  const adapter = async (config: {
    url?: string;
    method?: string;
    data?: unknown;
    headers?: { toJSON?: () => Record<string, unknown> } & Record<string, unknown>;
  }) => {
    const raw = config.headers?.toJSON ? config.headers.toJSON() : (config.headers ?? {});
    const headers = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const call: Call = {
      url: String(config.url),
      method: String(config.method).toUpperCase(),
      headers,
      data: typeof config.data === "string" ? config.data : undefined,
    };
    calls.push(call);
    if (call.url.endsWith("/v1/oauth2/token")) {
      tokenCount++;
      return response(config, {
        body: { access_token: `tok-${tokenCount}`, token_type: "Bearer", expires_in: opts.expiresIn ?? 32400 },
      });
    }
    const reply = queue.shift();
    if (!reply) throw new Error(`Unexpected request to ${call.url}`);
    return response(config, reply);
  };
  const client = createPayPalClient({
    clientId: "cid",
    clientSecret: "secret",
    webhookId: opts.webhookId,
    httpClientOverrides: { adapter },
  });
  return {
    client,
    calls,
    apiCalls: () => calls.filter((c) => !c.url.endsWith("/v1/oauth2/token")),
    tokenCalls: () => calls.filter((c) => c.url.endsWith("/v1/oauth2/token")),
  };
}

function response(config: unknown, reply: Reply) {
  return {
    data: reply.body === undefined ? "" : JSON.stringify(reply.body),
    status: reply.status ?? 200,
    statusText: "",
    headers: { "content-type": "application/json", ...reply.headers },
    config,
  };
}

const bodyOf = (c: Call) => JSON.parse(String(c.data));

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

afterEach(() => {
  vi.useRealTimers();
});

describe("OAuth token (managed by the SDK)", () => {
  it("requests a client-credentials token with Basic auth and sends it as Bearer", async () => {
    const t = setup([orderReply]);
    await t.client.createOrder(payment, vendor);
    const [tokenCall] = t.tokenCalls();
    expect(tokenCall.url).toBe(`${API}/v1/oauth2/token`);
    expect(tokenCall.method).toBe("POST");
    expect(tokenCall.data).toContain("grant_type=client_credentials");
    expect(tokenCall.headers.authorization).toBe(`Basic ${Buffer.from("cid:secret").toString("base64")}`);
    expect(t.apiCalls()[0].headers.authorization).toBe("Bearer tok-1");
  });

  it("reuses the token across calls until near expiry, then refreshes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
    const t = setup([orderReply, orderReply, orderReply, orderReply], { expiresIn: 3600 });

    await t.client.createOrder(payment, vendor);
    await t.client.createOrder(payment, vendor);
    expect(t.tokenCalls()).toHaveLength(1);

    // Still outside the refresh margin: reused.
    vi.setSystemTime(new Date(Date.now() + (3600 - TOKEN_REFRESH_MARGIN_S - 60) * 1000));
    await t.client.createOrder(payment, vendor);
    expect(t.tokenCalls()).toHaveLength(1);

    // Past the refresh margin: refreshed before PayPal would reject it.
    vi.setSystemTime(new Date(Date.now() + 120 * 1000));
    await t.client.createOrder(payment, vendor);
    expect(t.tokenCalls()).toHaveLength(2);
    expect(t.apiCalls().map((c) => c.headers.authorization)).toEqual([
      "Bearer tok-1",
      "Bearer tok-1",
      "Bearer tok-1",
      "Bearer tok-2",
    ]);
  });

  it("shares one token request between concurrent calls", async () => {
    const t = setup([orderReply, orderReply, orderReply]);
    await Promise.all([
      t.client.createOrder(payment, vendor),
      t.client.createOrder(payment, vendor),
      t.client.createOrder(payment, vendor),
    ]);
    expect(t.tokenCalls()).toHaveLength(1);
  });

  it("uses the same cached token for webhook verification", async () => {
    const t = setup([orderReply, { body: { verification_status: "SUCCESS" } }], { webhookId: "WHID" });
    await t.client.createOrder(payment, vendor);
    await t.client.verifyWebhookSignature(webhookHeaders(), webhookBody);
    expect(t.tokenCalls()).toHaveLength(1);
    expect(t.apiCalls()[1].headers.authorization).toBe("Bearer tok-1");
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
    await expect(t.client.createOrder(payment, vendor)).rejects.toThrow(PayPalError);
  });

  it("surfaces PayPal error details and debug id", async () => {
    const t = setup([
      {
        status: 422,
        headers: { "paypal-debug-id": "dbg123" },
        body: {
          name: "UNPROCESSABLE_ENTITY",
          message: "The requested action could not be performed.",
          debug_id: "dbg123",
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

describe("getOrder", () => {
  const order = (over: Record<string, unknown> = {}) => ({
    body: {
      id: "ORDER-1",
      status: "COMPLETED",
      purchase_units: [
        {
          amount: { currency_code: "USD", value: "500.00" },
          payee: { email_address: "dj@example.com" },
          payments: { captures: [{ id: "CAP-1", status: "COMPLETED", amount: { currency_code: "USD", value: "500.00" }, create_time: "2026-11-07T10:38:40Z" }] },
        },
      ],
      ...over,
    },
  });

  it("reads an order with a GET and returns its status, amount, payee and captures in cents", async () => {
    const t = setup([order()]);
    expect(await t.client.getOrder("ORDER-1")).toEqual({
      orderId: "ORDER-1",
      status: "COMPLETED",
      amount: 50_000,
      payeeEmail: "dj@example.com",
      captures: [{ captureId: "CAP-1", status: "COMPLETED", amount: 50_000, createdAt: "2026-11-07T10:38:40Z" }],
    });
    const [call] = t.apiCalls();
    expect(call.method).toBe("GET");
    expect(call.url.replace(/\?$/, "")).toBe(`${API}/v2/checkout/orders/ORDER-1`);
  });

  it("handles an order that was approved but never captured", async () => {
    const t = setup([order({ status: "APPROVED", purchase_units: [{ amount: { currency_code: "USD", value: "500.00" } }] })]);
    expect(await t.client.getOrder("ORDER-1")).toMatchObject({ status: "APPROVED", captures: [], payeeEmail: null });
  });

  it("turns PayPal's 404 into a PayPalError", async () => {
    const t = setup([{ status: 404, body: { name: "RESOURCE_NOT_FOUND", message: "The specified resource does not exist.", debug_id: "d1" } }]);
    await expect(t.client.getOrder("NOPE")).rejects.toThrow(PayPalError);
  });
});

describe("getCapture", () => {
  it("reads a captured payment with a GET and returns its status, amount, payee and order", async () => {
    const t = setup([
      {
        body: {
          id: "CAP-1",
          status: "COMPLETED",
          amount: { currency_code: "USD", value: "500.00" },
          payee: { email_address: "dj@example.com" },
          create_time: "2026-11-07T10:38:38Z",
          supplementary_data: { related_ids: { order_id: "ORDER-1" } },
        },
      },
    ]);
    expect(await t.client.getCapture("CAP-1")).toEqual({ captureId: "CAP-1", status: "COMPLETED", amount: 50_000, payeeEmail: "dj@example.com", createdAt: "2026-11-07T10:38:38Z", orderId: "ORDER-1" });
    const [call] = t.apiCalls();
    expect(call.method).toBe("GET");
    expect(call.url.replace(/[?]$/, "")).toBe(`${API}/v2/payments/captures/CAP-1`);
  });
});

describe("readOnly", () => {
  it("hands out getOrder and getCapture and nothing else, frozen", () => {
    const reader = readOnly(setup().client);
    expect(Object.keys(reader).sort()).toEqual(["getCapture", "getOrder"]);
    expect(Object.isFrozen(reader)).toBe(true);
    for (const name of ["createOrder", "captureOrder", "refundCapture", "verifyWebhookSignature"]) expect(name in reader, name).toBe(false);
    expect(() => Object.assign(reader, { captureOrder: () => {} })).toThrow();
  });

  it("returns results instead of throwing, with a plain reason on failure", async () => {
    const t = setup([
      { body: { id: "ORDER-1", status: "CREATED", purchase_units: [{}] } },
      { status: 404, body: { name: "RESOURCE_NOT_FOUND", message: "The specified resource does not exist." } },
      { status: 401, body: { name: "NOT_AUTHORIZED", message: "Authorization failed due to insufficient permissions.", details: [{ issue: "PERMISSION_DENIED" }] } },
      { status: 500, body: { name: "INTERNAL_SERVER_ERROR", message: "boom" } },
    ]);
    const reader = readOnly(t.client);
    expect(await reader.getOrder("ORDER-1")).toMatchObject({ ok: true, value: { status: "CREATED" } });
    expect(await reader.getOrder("OLD")).toEqual({ ok: false, reason: "not_found" });
    expect(await reader.getCapture("THEIRS")).toEqual({ ok: false, reason: "not_allowed" });
    expect(await reader.getCapture("X")).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("captureOrder", () => {
  it("captures with an idempotency key and returns the capture id and cents", async () => {
    const t = setup([captureReply]);
    expect(await t.client.captureOrder("ORDER-1")).toEqual({
      orderId: "ORDER-1",
      status: "COMPLETED",
      captureId: "CAP-1",
      captureStatus: "COMPLETED",
      amount: 150_050,
    });
    const [call] = t.apiCalls();
    expect(call.url).toBe(`${API}/v2/checkout/orders/ORDER-1/capture`);
    expect(call.headers["paypal-request-id"]).toBe("capture-ORDER-1");
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
    expect(call.headers["paypal-request-id"]).toBe("refund-CAP-1-25000");
  });

  it("sends an empty body for a full refund", async () => {
    const t = setup([{ body: { id: "REF-2", status: "COMPLETED" } }]);
    expect(await t.client.refundCapture("CAP-1")).toEqual({ refundId: "REF-2", status: "COMPLETED", amount: null });
    expect(bodyOf(t.apiCalls()[0])).toEqual({});
  });

  it("rejects an invalid amount without calling PayPal", async () => {
    const t = setup();
    await expect(t.client.refundCapture("CAP-1", -5)).rejects.toThrow(PayPalError);
    expect(t.calls).toHaveLength(0);
  });
});

const webhookBody =
  '{"id":"WH-1","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"id":"CAP-1","amount":{"value":"1500.50"}}}';
const webhookHeaders = () =>
  new Headers({
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/cert.pem",
    "paypal-transmission-id": "tx-1",
    "paypal-transmission-sig": "sig",
    "paypal-transmission-time": "2027-01-01T00:00:00Z",
  });

describe("verifyWebhookSignature", () => {
  it("posts the headers, webhook id and the raw event body unchanged", async () => {
    const t = setup([{ body: { verification_status: "SUCCESS" } }], { webhookId: "WHID" });
    expect(await t.client.verifyWebhookSignature(webhookHeaders(), webhookBody)).toBe(true);
    const [call] = t.apiCalls();
    expect(call.url).toBe(`${API}/v1/notifications/verify-webhook-signature`);
    expect(String(call.data).endsWith(`"webhook_event":${webhookBody}}`)).toBe(true);
    expect(bodyOf(call)).toMatchObject({
      auth_algo: "SHA256withRSA",
      cert_url: "https://api.sandbox.paypal.com/cert.pem",
      transmission_id: "tx-1",
      transmission_sig: "sig",
      transmission_time: "2027-01-01T00:00:00Z",
      webhook_id: "WHID",
      webhook_event: JSON.parse(webhookBody),
    });
  });

  it("returns false on a FAILURE verdict", async () => {
    const t = setup([{ body: { verification_status: "FAILURE" } }], { webhookId: "WHID" });
    expect(await t.client.verifyWebhookSignature(webhookHeaders(), webhookBody)).toBe(false);
  });

  it("returns false without calling PayPal when headers are missing or the body is not JSON", async () => {
    const t = setup([], { webhookId: "WHID" });
    const partial = webhookHeaders();
    partial.delete("paypal-transmission-sig");
    expect(await t.client.verifyWebhookSignature(partial, webhookBody)).toBe(false);
    expect(await t.client.verifyWebhookSignature(webhookHeaders(), "not json")).toBe(false);
    expect(t.calls).toHaveLength(0);
  });

  it("throws when PAYPAL_WEBHOOK_ID is not configured", async () => {
    const t = setup();
    await expect(t.client.verifyWebhookSignature(webhookHeaders(), webhookBody)).rejects.toThrow(/PAYPAL_WEBHOOK_ID/);
  });

  it("rejects an unexpected verification response", async () => {
    const t = setup([{ body: { verification_status: "MAYBE" } }], { webhookId: "WHID" });
    await expect(t.client.verifyWebhookSignature(webhookHeaders(), webhookBody)).rejects.toThrow(PayPalError);
  });

  it("maps an HTTP error from the verify endpoint to PayPalError", async () => {
    const t = setup([{ status: 400, body: { name: "VALIDATION_ERROR", message: "Invalid request" } }], {
      webhookId: "WHID",
    });
    await expect(t.client.verifyWebhookSignature(webhookHeaders(), webhookBody)).rejects.toMatchObject({
      status: 400,
      issue: "VALIDATION_ERROR",
    });
  });
});
