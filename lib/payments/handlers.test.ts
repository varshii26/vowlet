import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { PayPalError, type CapturedOrder, type CreatedOrder } from "@/lib/paypal";
import { captureHandler, createOrderHandler, type HandlerDeps } from "@/lib/payments/handlers";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase } from "@/lib/test-utils/db";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let paymentId: string;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDatabase());
}, 60_000);
afterAll(async () => cleanup());

beforeEach(async () => {
  await seedDemo(prisma);
  paymentId = (await prisma.payment.findFirstOrThrow({ where: { label: "Venue second installment" } })).id;
});

function deps(over: { capture?: Partial<CapturedOrder>; captureError?: PayPalError } = {}): HandlerDeps {
  return {
    prisma,
    paypal: () => ({
      createOrder: vi.fn(async (): Promise<CreatedOrder> => ({ orderId: "ORDER-1", status: "CREATED", approveUrl: null })),
      captureOrder: vi.fn(async (orderId: string): Promise<CapturedOrder> => {
        if (over.captureError) throw over.captureError;
        return { orderId, status: "COMPLETED", captureId: "CAP-1", captureStatus: "COMPLETED", amount: null, ...over.capture };
      }),
    }),
  };
}

const post = (body: unknown) =>
  new Request("http://localhost/api/payments/x/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("createOrderHandler", () => {
  it("returns the new order id", async () => {
    const res = await createOrderHandler(paymentId, deps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, orderId: "ORDER-1" });
  });

  it("returns 404 for an unknown payment", async () => {
    const res = await createOrderHandler("nope", deps());
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("returns 409 for a payment already paid", async () => {
    await prisma.payment.update({ where: { id: paymentId }, data: { status: "paid" } });
    const res = await createOrderHandler(paymentId, deps());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "not_payable" } });
  });

  it("returns 503 with a plain message when PayPal is not configured", async () => {
    const unconfigured: HandlerDeps = {
      prisma,
      paypal: () => {
        throw new PayPalError("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set", null);
      },
    };
    const res = await createOrderHandler(paymentId, unconfigured);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("not_configured");
    expect(JSON.stringify(body)).not.toContain("PAYPAL_CLIENT");
  });

  it("does not hide a programming error as a PayPal problem", async () => {
    const broken: HandlerDeps = {
      prisma,
      paypal: () => {
        throw new TypeError("bug");
      },
    };
    await expect(createOrderHandler(paymentId, broken)).rejects.toThrow("bug");
  });
});

describe("captureHandler", () => {
  async function withOrder() {
    await createOrderHandler(paymentId, deps());
  }

  it("marks the payment paid and returns 200", async () => {
    await withOrder();
    const res = await captureHandler(paymentId, post({ orderId: "ORDER-1" }), deps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, state: "paid", message: "Payment complete." });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("paid");
  });

  it("returns 200 again for a repeat, without paying twice", async () => {
    await withOrder();
    await captureHandler(paymentId, post({ orderId: "ORDER-1" }), deps());
    const res = await captureHandler(paymentId, post({ orderId: "ORDER-1" }), deps());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, state: "already_paid" });
    expect(await prisma.eventLog.count({ where: { type: "payment_paid" } })).toBe(1);
  });

  it("returns 202 when PayPal is still processing", async () => {
    await withOrder();
    const res = await captureHandler(paymentId, post({ orderId: "ORDER-1" }), deps({ capture: { captureStatus: "PENDING" } }));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ ok: true, state: "pending" });
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await captureHandler(paymentId, post("not json"), deps());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: "bad_request" } });
  });

  it.each([{}, { orderId: "" }, { orderId: 123 }, { orderId: "x".repeat(65) }, null, []])(
    "returns 400 for a bad order id: %j",
    async (body) => {
      const res = await captureHandler(paymentId, post(body), deps());
      expect(res.status).toBe(400);
    },
  );

  it("does not capture, or change anything, for a bad request", async () => {
    await withOrder();
    await captureHandler(paymentId, post({}), deps());
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("scheduled");
  });

  it("returns 409 for an order that is not this payment's", async () => {
    await withOrder();
    const res = await captureHandler(paymentId, post({ orderId: "OTHER" }), deps());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "order_mismatch" } });
  });

  it("returns 409 when the couple never approved", async () => {
    await withOrder();
    const res = await captureHandler(paymentId, post({ orderId: "ORDER-1" }), deps({ captureError: new PayPalError("x", 422, "d", "ORDER_NOT_APPROVED") }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "not_approved" } });
  });

  it("returns 402 when the payment method is declined", async () => {
    await withOrder();
    const res = await captureHandler(paymentId, post({ orderId: "ORDER-1" }), deps({ captureError: new PayPalError("x", 422, "d", "INSTRUMENT_DECLINED") }));
    expect(res.status).toBe(402);
  });

  it("returns 404 for an unknown payment", async () => {
    const res = await captureHandler("nope", post({ orderId: "ORDER-1" }), deps());
    expect(res.status).toBe(404);
  });

  it("returns 503 when PayPal is not configured", async () => {
    await withOrder();
    const unconfigured: HandlerDeps = {
      prisma,
      paypal: () => {
        throw new PayPalError("not set", null);
      },
    };
    expect((await captureHandler(paymentId, post({ orderId: "ORDER-1" }), unconfigured)).status).toBe(503);
  });

  it("never puts PayPal debug ids or internals in a response", async () => {
    await withOrder();
    const res = await captureHandler(
      paymentId,
      post({ orderId: "ORDER-1" }),
      deps({ captureError: new PayPalError("secret internal detail", 500, "debug-xyz", "WEIRD") }),
    );
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(text).not.toContain("debug-xyz");
    expect(text).not.toContain("secret internal detail");
  });
});
