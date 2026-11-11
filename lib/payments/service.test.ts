import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { PayPalError, type CapturedOrder, type CreatedOrder } from "@/lib/paypal";
import { capturePaymentOrder, createPaymentOrder, markPaymentPaid, type PayPalPort } from "@/lib/payments/service";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase, soleWeddingId } from "@/lib/test-utils/db";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDatabase());
}, 60_000);
afterAll(async () => cleanup());

/** A fake PayPal: records calls, answers with whatever the test sets up. */
function fakePayPal(over: { order?: Partial<CreatedOrder>; capture?: Partial<CapturedOrder> } = {}) {
  const createOrder = vi.fn(
    async (): Promise<CreatedOrder> => ({ orderId: "ORDER-1", status: "CREATED", approveUrl: null, ...over.order }),
  );
  const captureOrder = vi.fn(
    async (orderId: string): Promise<CapturedOrder> => ({
      orderId,
      status: "COMPLETED",
      captureId: "CAP-1",
      captureStatus: "COMPLETED",
      amount: null,
      ...over.capture,
    }),
  );
  return { port: { createOrder, captureOrder } satisfies PayPalPort, createOrder, captureOrder };
}

const rejecting = (issue: string | null, status = 422) => ({
  async createOrder(): Promise<CreatedOrder> {
    throw new PayPalError("boom", status, "debug-1", issue);
  },
  async captureOrder(): Promise<CapturedOrder> {
    throw new PayPalError("boom", status, "debug-1", issue);
  },
});

async function payment(label = "Venue second installment") {
  return prisma.payment.findFirstOrThrow({ where: { label }, include: { vendor: true } });
}

beforeEach(async () => {
  await seedDemo(prisma);
});

describe("createPaymentOrder", () => {
  it("creates an order paying the vendor and remembers its id", async () => {
    const p = await payment();
    const paypal = fakePayPal();
    const result = await createPaymentOrder(prisma, paypal.port, await soleWeddingId(prisma), p.id);

    expect(result).toEqual({ ok: true, orderId: "ORDER-1" });
    expect(paypal.createOrder).toHaveBeenCalledWith(
      { id: p.id, label: p.label, amount: p.amount },
      { name: p.vendor.name, paypalEmail: p.vendor.paypalEmail },
    );
    expect((await payment()).paypalOrderId).toBe("ORDER-1");
  });

  it("does not touch the payment's status", async () => {
    const p = await payment();
    await createPaymentOrder(prisma, fakePayPal().port, await soleWeddingId(prisma), p.id);
    expect((await payment()).status).toBe("scheduled");
  });

  it("returns not_found for an unknown payment, without calling PayPal", async () => {
    const paypal = fakePayPal();
    expect(await createPaymentOrder(prisma, paypal.port, await soleWeddingId(prisma), "nope")).toMatchObject({ ok: false, code: "not_found", status: 404 });
    expect(paypal.createOrder).not.toHaveBeenCalled();
  });

  it.each(["paid", "void", "refunded", "refund_requested"] as const)("refuses a %s payment", async (status) => {
    const p = await payment();
    await prisma.payment.update({ where: { id: p.id }, data: { status } });
    const paypal = fakePayPal();
    expect(await createPaymentOrder(prisma, paypal.port, await soleWeddingId(prisma), p.id)).toMatchObject({ ok: false, code: "not_payable", status: 409 });
    expect(paypal.createOrder).not.toHaveBeenCalled();
  });

  it("accepts a payment that is due", async () => {
    const p = await payment();
    await prisma.payment.update({ where: { id: p.id }, data: { status: "due" } });
    expect(await createPaymentOrder(prisma, fakePayPal().port, await soleWeddingId(prisma), p.id)).toMatchObject({ ok: true });
  });

  it("refuses a payment to a cancelled vendor", async () => {
    const p = await payment();
    await prisma.vendor.update({ where: { id: p.vendorId }, data: { status: "cancelled" } });
    const result = await createPaymentOrder(prisma, fakePayPal().port, await soleWeddingId(prisma), p.id);
    expect(result).toMatchObject({ ok: false, code: "not_payable" });
    expect(result.ok ? "" : result.message).toContain("cancelled");
  });

  it("reports a PayPal failure without leaking details, and stores no order", async () => {
    const p = await payment();
    const result = await createPaymentOrder(prisma, rejecting("INTERNAL_SERVER_ERROR", 500), await soleWeddingId(prisma), p.id);
    expect(result).toMatchObject({ ok: false, code: "paypal_error", status: 502 });
    expect(JSON.stringify(result)).not.toContain("debug-1");
    expect((await payment()).paypalOrderId).toBeNull();
  });

  it("lets non-PayPal errors surface as server errors", async () => {
    const p = await payment();
    const broken = { ...fakePayPal().port, createOrder: async () => Promise.reject(new TypeError("bug")) };
    await expect(createPaymentOrder(prisma, broken, await soleWeddingId(prisma), p.id)).rejects.toThrow("bug");
  });
});

describe("capturePaymentOrder", () => {
  async function ordered(label?: string) {
    const p = await payment(label);
    await createPaymentOrder(prisma, fakePayPal().port, await soleWeddingId(prisma), p.id);
    return p;
  }

  it("captures the approved order and marks the payment paid", async () => {
    const p = await ordered();
    const paypal = fakePayPal({ capture: { amount: p.amount } });
    const now = new Date("2026-11-07T10:00:00Z");

    const result = await capturePaymentOrder(prisma, paypal.port, await soleWeddingId(prisma), p.id, "ORDER-1", now);

    expect(result).toMatchObject({ ok: true, state: "paid" });
    expect(paypal.captureOrder).toHaveBeenCalledWith("ORDER-1");
    const after = await payment();
    expect(after).toMatchObject({ status: "paid", captureId: "CAP-1", paypalOrderId: "ORDER-1" });
    expect(after.paidAt?.toISOString()).toBe(now.toISOString());
  });

  it("writes one activity entry for the payment", async () => {
    const p = await ordered();
    await capturePaymentOrder(prisma, fakePayPal().port, await soleWeddingId(prisma), p.id, "ORDER-1");
    const events = await prisma.eventLog.findMany({ where: { type: "payment_paid" } });
    expect(events).toHaveLength(1);
    expect(events[0].message).toBe("Paid $3,000 to Grand Oak Estate (Venue second installment)");
  });

  it("is idempotent: a repeat does not capture again or log twice", async () => {
    const p = await ordered();
    const paypal = fakePayPal();
    await capturePaymentOrder(prisma, paypal.port, await soleWeddingId(prisma), p.id, "ORDER-1");
    const again = await capturePaymentOrder(prisma, paypal.port, await soleWeddingId(prisma), p.id, "ORDER-1");

    expect(again).toMatchObject({ ok: true, state: "already_paid" });
    expect(paypal.captureOrder).toHaveBeenCalledTimes(1);
    expect(await prisma.eventLog.count({ where: { type: "payment_paid" } })).toBe(1);
  });

  it("records a double click once, even when both captures reach PayPal", async () => {
    const p = await ordered();
    const paypal = fakePayPal();
    const [a, b] = await Promise.all([
      capturePaymentOrder(prisma, paypal.port, await soleWeddingId(prisma), p.id, "ORDER-1"),
      capturePaymentOrder(prisma, paypal.port, await soleWeddingId(prisma), p.id, "ORDER-1"),
    ]);

    expect(a.ok && b.ok).toBe(true);
    expect([a, b].filter((r) => r.ok && r.state === "paid")).toHaveLength(1);
    expect(await prisma.eventLog.count({ where: { type: "payment_paid" } })).toBe(1);
    expect((await payment()).status).toBe("paid");
  });

  it("refuses a different order for an already-paid payment, so the vendor is never paid twice", async () => {
    const p = await ordered();
    await capturePaymentOrder(prisma, fakePayPal().port, await soleWeddingId(prisma), p.id, "ORDER-1");
    const paypal = fakePayPal();
    const result = await capturePaymentOrder(prisma, paypal.port, await soleWeddingId(prisma), p.id, "ORDER-2");
    expect(result).toMatchObject({ ok: false, code: "not_payable", status: 409 });
    expect(paypal.captureOrder).not.toHaveBeenCalled();
  });

  it("refuses an order that does not belong to this payment", async () => {
    const p = await ordered();
    const paypal = fakePayPal();
    expect(await capturePaymentOrder(prisma, paypal.port, await soleWeddingId(prisma), p.id, "SOMEONE-ELSES-ORDER")).toMatchObject({
      ok: false,
      code: "order_mismatch",
      status: 409,
    });
    expect(paypal.captureOrder).not.toHaveBeenCalled();
    expect((await payment()).status).toBe("scheduled");
  });

  it("refuses a payment that never had an order", async () => {
    const p = await payment();
    expect(await capturePaymentOrder(prisma, fakePayPal().port, await soleWeddingId(prisma), p.id, "ORDER-1")).toMatchObject({ ok: false, code: "order_mismatch" });
  });

  it("returns not_found for an unknown payment", async () => {
    expect(await capturePaymentOrder(prisma, fakePayPal().port, await soleWeddingId(prisma), "nope", "ORDER-1")).toMatchObject({ ok: false, code: "not_found" });
  });

  it.each(["void", "refunded", "refund_requested"] as const)("refuses a %s payment", async (status) => {
    const p = await ordered();
    await prisma.payment.update({ where: { id: p.id }, data: { status } });
    const paypal = fakePayPal();
    expect(await capturePaymentOrder(prisma, paypal.port, await soleWeddingId(prisma), p.id, "ORDER-1")).toMatchObject({ ok: false, code: "not_payable" });
    expect(paypal.captureOrder).not.toHaveBeenCalled();
  });

  it("does not mark paid when PayPal reports a different amount, and logs it", async () => {
    const p = await ordered();
    const result = await capturePaymentOrder(prisma, fakePayPal({ capture: { amount: p.amount - 100 } }).port, await soleWeddingId(prisma), p.id, "ORDER-1");

    expect(result).toMatchObject({ ok: false, code: "amount_mismatch", status: 502 });
    expect((await payment()).status).toBe("scheduled");
    const events = await prisma.eventLog.findMany({ where: { type: "payment_amount_mismatch" } });
    expect(events).toHaveLength(1);
    expect(events[0].message).toContain("Not marked paid");
  });

  it("accepts a capture where PayPal gives no amount, since we set the amount when creating the order", async () => {
    const p = await ordered();
    expect(await capturePaymentOrder(prisma, fakePayPal({ capture: { amount: null } }).port, await soleWeddingId(prisma), p.id, "ORDER-1")).toMatchObject({
      ok: true,
      state: "paid",
    });
  });

  it("leaves a pending capture unpaid and says it is pending", async () => {
    const p = await ordered();
    const result = await capturePaymentOrder(prisma, fakePayPal({ capture: { captureStatus: "PENDING" } }).port, await soleWeddingId(prisma), p.id, "ORDER-1");

    expect(result).toMatchObject({ ok: true, state: "pending" });
    expect((await payment()).status).toBe("scheduled");
    expect(await prisma.eventLog.count({ where: { type: "payment_pending" } })).toBe(1);
  });

  it("maps PayPal's rejections to clear, status-correct failures that leave the payment unchanged", async () => {
    const p = await ordered();
    const notApproved = await capturePaymentOrder(prisma, rejecting("ORDER_NOT_APPROVED"), await soleWeddingId(prisma), p.id, "ORDER-1");
    expect(notApproved).toMatchObject({ ok: false, code: "not_approved", status: 409 });

    const declined = await capturePaymentOrder(prisma, rejecting("INSTRUMENT_DECLINED"), await soleWeddingId(prisma), p.id, "ORDER-1");
    expect(declined).toMatchObject({ ok: false, code: "declined", status: 402 });

    const other = await capturePaymentOrder(prisma, rejecting("SOMETHING_ELSE", 500), await soleWeddingId(prisma), p.id, "ORDER-1");
    expect(other).toMatchObject({ ok: false, code: "paypal_error", status: 502 });
    expect(JSON.stringify(other)).not.toContain("debug-1");

    const after = await payment();
    expect(after.status).toBe("scheduled");
    expect(after.captureId).toBeNull();
  });

  it("gives every failure a message the couple can read", async () => {
    const p = await ordered();
    const failures = [
      await capturePaymentOrder(prisma, rejecting("ORDER_NOT_APPROVED"), await soleWeddingId(prisma), p.id, "ORDER-1"),
      await capturePaymentOrder(prisma, rejecting("INSTRUMENT_DECLINED"), await soleWeddingId(prisma), p.id, "ORDER-1"),
      await capturePaymentOrder(prisma, rejecting(null, 500), await soleWeddingId(prisma), p.id, "ORDER-1"),
    ];
    for (const f of failures) {
      expect(f.ok).toBe(false);
      if (!f.ok) expect(f.message.length).toBeGreaterThan(20);
    }
  });
});

describe("markPaymentPaid", () => {
  it("marks a payment paid once, and only once", async () => {
    const p = await payment();
    expect(await markPaymentPaid(prisma, p.id, { captureId: "CAP-9" })).toBe(true);
    expect(await markPaymentPaid(prisma, p.id, { captureId: "CAP-10" })).toBe(false);
    const after = await payment();
    expect(after.captureId).toBe("CAP-9");
    expect(await prisma.eventLog.count({ where: { type: "payment_paid" } })).toBe(1);
  });

  it("does not change a payment that is void", async () => {
    const p = await payment();
    await prisma.payment.update({ where: { id: p.id }, data: { status: "void" } });
    expect(await markPaymentPaid(prisma, p.id, { captureId: "CAP-9" })).toBe(false);
    expect((await payment()).status).toBe("void");
  });
});
