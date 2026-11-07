import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { PayPalError } from "@/lib/paypal";
import { MAX_WEBHOOK_BYTES, webhookHandler, type WebhookDeps } from "@/lib/payments/webhook";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase } from "@/lib/test-utils/db";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDatabase());
}, 60_000);
afterAll(async () => cleanup());

let paymentId: string;
beforeEach(async () => {
  await seedDemo(prisma);
  const p = await prisma.payment.findFirstOrThrow({ where: { label: "Venue second installment" } });
  // The state the pay flow leaves behind: an order was created, nothing is captured yet.
  await prisma.payment.update({ where: { id: p.id }, data: { paypalOrderId: "ORDER-1" } });
  paymentId = p.id;
});

const HEADERS = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
  "paypal-transmission-id": "tx-1",
  "paypal-transmission-sig": "sig",
  "paypal-transmission-time": "2026-11-07T10:00:00Z",
};

/** A PAYMENT.CAPTURE.COMPLETED event shaped like PayPal's, for the seeded $3,000 payment. */
function event(over: { id?: string; type?: string; resource?: Record<string, unknown> | null } = {}) {
  return {
    id: over.id ?? "WH-1",
    event_version: "1.0",
    create_time: "2026-11-07T10:00:05Z",
    resource_type: "capture",
    event_type: over.type ?? "PAYMENT.CAPTURE.COMPLETED",
    summary: "Payment completed for $ 3000.0 USD",
    resource:
      over.resource === null
        ? undefined
        : {
            id: "CAP-1",
            status: "COMPLETED",
            amount: { currency_code: "USD", value: "3000.00" },
            final_capture: true,
            custom_id: paymentId,
            create_time: "2026-11-07T10:00:03Z",
            supplementary_data: { related_ids: { order_id: "ORDER-1" } },
            ...over.resource,
          },
    links: [],
  };
}

const post = (body: unknown) =>
  new Request("http://localhost/api/webhooks/paypal", {
    method: "POST",
    headers: HEADERS,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

function deps(verify: (headers: Headers, raw: string) => Promise<boolean> = async () => true): WebhookDeps & { verify: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(verify);
  return { prisma, paypal: () => ({ verifyWebhookSignature: spy }), verify: spy };
}

const run = async (body: unknown, d = deps()) => {
  const res = await webhookHandler(post(body), d);
  return { status: res.status, body: await res.json() };
};
const payment = () => prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
const events = (type: string) => prisma.eventLog.findMany({ where: { type } });

describe("verification comes first", () => {
  it("answers 401 and changes nothing when PayPal says the signature is not genuine", async () => {
    const { status, body } = await run(event(), deps(async () => false));
    expect(status).toBe(401);
    expect(body).toEqual({ ok: false, error: { code: "invalid_signature", message: "The signature could not be verified." } });
    expect(await payment()).toMatchObject({ status: "scheduled", captureId: null });
    expect(await events("payment_paid")).toHaveLength(0);
  });

  it("verifies the exact raw body and the request headers, untouched", async () => {
    // Odd spacing and a non-ASCII character: re-serialising this would change the bytes PayPal signed.
    const raw = `{ "id" : "WH-9",  "event_type": "SOMETHING.ELSE",   "resource": { "note": "café" } }`;
    const d = deps();
    await webhookHandler(post(raw), d);

    expect(d.verify).toHaveBeenCalledTimes(1);
    const [headers, body] = d.verify.mock.calls[0] as [Headers, string];
    expect(body).toBe(raw);
    expect(headers.get("paypal-transmission-id")).toBe("tx-1");
    expect(headers.get("paypal-transmission-sig")).toBe("sig");
  });

  it("answers 503, so PayPal retries, when verification is unavailable (no webhook id, PayPal down)", async () => {
    const d = deps(async () => {
      throw new PayPalError("PAYPAL_WEBHOOK_ID is not set", null);
    });
    const { status, body } = await run(event(), d);
    expect(status).toBe(503);
    expect(body.error.code).toBe("unavailable");
    expect(JSON.stringify(body)).not.toContain("PAYPAL_WEBHOOK_ID");
    expect((await payment()).status).toBe("scheduled");
  });

  it("answers 503 when PayPal credentials are not configured at all", async () => {
    const unconfigured: WebhookDeps = {
      prisma,
      paypal: () => {
        throw new PayPalError("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set", null);
      },
    };
    expect((await run(event(), unconfigured as never)).status).toBe(503);
  });

  it("does not hide a programming error as a verification problem", async () => {
    const d = deps(async () => {
      throw new TypeError("bug");
    });
    await expect(webhookHandler(post(event()), d)).rejects.toThrow("bug");
  });

  it("refuses an oversized payload without calling PayPal", async () => {
    const d = deps();
    const { status } = await run("x".repeat(MAX_WEBHOOK_BYTES + 1), d);
    expect(status).toBe(413);
    expect(d.verify).not.toHaveBeenCalled();
  });

  it("answers 401 for an empty or non-JSON body, which PayPal's check rejects", async () => {
    expect((await run("", deps(async () => false))).status).toBe(401);
    expect((await run("not json", deps(async () => false))).status).toBe(401);
  });

  it("acknowledges a verified event it cannot make sense of, instead of making PayPal retry it forever", async () => {
    expect(await run({ hello: "world" })).toEqual({ status: 200, body: { ok: true, outcome: "ignored" } });
  });
});

describe("PAYMENT.CAPTURE.COMPLETED", () => {
  it("marks the payment paid, with the capture id, order id and PayPal's payment time", async () => {
    const { status, body } = await run(event());
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, outcome: "paid" });

    const after = await payment();
    expect(after).toMatchObject({ status: "paid", captureId: "CAP-1", paypalOrderId: "ORDER-1" });
    expect(after.paidAt?.toISOString()).toBe("2026-11-07T10:00:03.000Z");
    const log = await events("payment_paid");
    expect(log.map((e) => e.message)).toEqual(["Paid $3,000 to Grand Oak Estate (Venue second installment)"]);
  });

  it("uses the current time if PayPal's timestamp is unreadable", async () => {
    await run(event({ resource: { create_time: "not a date" } }));
    const paidAt = (await payment()).paidAt!.getTime();
    expect(Math.abs(paidAt - Date.now())).toBeLessThan(10_000);
  });

  it("completes a slow payment that the capture route left unpaid as pending", async () => {
    expect((await payment()).status).toBe("scheduled"); // what the capture route does for a PENDING capture
    expect((await run(event())).body.outcome).toBe("paid");
    expect((await payment()).status).toBe("paid");
  });

  it("records a repeated delivery once", async () => {
    await run(event());
    const again = await run(event());
    expect(again.body).toEqual({ ok: true, outcome: "already_paid" });
    expect(await events("payment_paid")).toHaveLength(1);
  });

  it("does nothing when the capture route already recorded the same capture", async () => {
    await prisma.payment.update({ where: { id: paymentId }, data: { status: "paid", captureId: "CAP-1", paidAt: new Date("2026-11-07T10:00:01Z") } });
    expect((await run(event())).body.outcome).toBe("already_paid");
    expect((await payment()).paidAt?.toISOString()).toBe("2026-11-07T10:00:01.000Z"); // not overwritten
    expect(await events("payment_paid")).toHaveLength(0);
  });

  describe("finding the payment", () => {
    it("uses the order id when the event carries no custom id", async () => {
      expect((await run(event({ resource: { custom_id: undefined } }))).body.outcome).toBe("paid");
    });

    it("uses the capture id for a payment that is already paid, when nothing else identifies it", async () => {
      await prisma.payment.update({ where: { id: paymentId }, data: { status: "paid", captureId: "CAP-1" } });
      const resource = { custom_id: undefined, supplementary_data: undefined };
      expect((await run(event({ resource }))).body.outcome).toBe("already_paid");
    });

    it("acknowledges, without changing anything, a capture that matches no payment", async () => {
      const { status, body } = await run(event({ resource: { custom_id: "nope", id: "CAP-X", supplementary_data: { related_ids: { order_id: "ORDER-X" } } } }));
      expect(status).toBe(200);
      expect(body.outcome).toBe("unknown_payment");
      expect((await payment()).status).toBe("scheduled");
    });
  });

  describe("refusing to mark paid when something does not match", () => {
    it("an order we did not create for this payment", async () => {
      const resource = { supplementary_data: { related_ids: { order_id: "SOMEONE-ELSES" } } };
      expect((await run(event({ resource }))).body.outcome).toBe("order_mismatch");
      expect((await payment()).status).toBe("scheduled");
      expect((await events("payment_order_mismatch"))[0].message).toContain("Not marked paid");
    });

    it("a different amount", async () => {
      const { body } = await run(event({ resource: { amount: { currency_code: "USD", value: "2999.99" } } }));
      expect(body.outcome).toBe("amount_mismatch");
      expect((await payment()).status).toBe("scheduled");
      const [log] = await events("payment_amount_mismatch");
      expect(log.message).toContain("captured $2,999.99 but $3,000 was expected");
    });

    it("a different currency", async () => {
      const { body } = await run(event({ resource: { amount: { currency_code: "EUR", value: "3000.00" } } }));
      expect(body.outcome).toBe("amount_mismatch");
      expect((await payment()).status).toBe("scheduled");
      expect((await events("payment_amount_mismatch"))[0].message).toContain("3000.00 EUR");
    });

    it("an amount that is not a plain number", async () => {
      expect((await run(event({ resource: { amount: { currency_code: "USD", value: "lots" } } }))).body.outcome).toBe("amount_mismatch");
      expect((await payment()).status).toBe("scheduled");
    });

    it("logs each problem once, however often PayPal repeats the event", async () => {
      const bad = event({ resource: { amount: { currency_code: "USD", value: "1.00" } } });
      await run(bad);
      await run(bad);
      expect(await events("payment_amount_mismatch")).toHaveLength(1);
    });
  });

  it("accepts a capture with no amount, since we set the amount when we created the order", async () => {
    expect((await run(event({ resource: { amount: undefined } }))).body.outcome).toBe("paid");
  });

  it("ignores an event whose capture is not actually completed", async () => {
    expect((await run(event({ resource: { status: "PENDING" } }))).body.outcome).toBe("ignored");
    expect((await payment()).status).toBe("scheduled");
  });

  it("ignores a capture it cannot read", async () => {
    expect((await run(event({ resource: null }))).body.outcome).toBe("ignored");
    expect((await run(event({ resource: { id: "" } }))).body.outcome).toBe("ignored");
  });

  describe("money that moved when it should not have", () => {
    it("flags a second, different capture for a payment that is already paid, and keeps the first", async () => {
      await prisma.payment.update({ where: { id: paymentId }, data: { status: "paid", captureId: "CAP-FIRST" } });
      const { body } = await run(event({ resource: { id: "CAP-SECOND" } }));
      expect(body.outcome).toBe("unexpected_capture");
      expect((await payment()).captureId).toBe("CAP-FIRST");
      const [log] = await events("payment_duplicate_capture");
      expect(log.message).toContain("CAP-SECOND");
      expect(log.message).toContain("already paid");
    });

    it.each(["void", "refunded", "refund_requested"] as const)("flags a completed capture for a payment that is %s, and leaves its status", async (status) => {
      await prisma.payment.update({ where: { id: paymentId }, data: { status } });
      expect((await run(event())).body.outcome).toBe("unexpected_capture");
      expect((await payment()).status).toBe(status);
      const [log] = await events("payment_unexpected_capture");
      expect(log.message).toContain(`that payment is ${status}`);
    });
  });
});

describe("PAYMENT.CAPTURE.DENIED", () => {
  const denied = (over: Record<string, unknown> = {}) => event({ id: "WH-D1", type: "PAYMENT.CAPTURE.DENIED", resource: { status: "DECLINED", ...over } });

  it("leaves the payment unpaid, so the couple can try again, and logs it once", async () => {
    expect((await run(denied())).body).toEqual({ ok: true, outcome: "denied" });
    await run(denied());
    expect((await payment()).status).toBe("scheduled");
    const log = await events("payment_denied");
    expect(log).toHaveLength(1);
    expect(log[0].message).toBe("PayPal denied the payment of $3,000 to Grand Oak Estate (Venue second installment). It is still unpaid. PayPal event WH-D1");
  });

  it("acknowledges a denial for a payment it does not know", async () => {
    const { body } = await run(denied({ custom_id: "nope", supplementary_data: undefined, id: "CAP-NOPE" }));
    expect(body.outcome).toBe("unknown_payment");
  });
});

describe("other events", () => {
  it.each(["PAYMENT.CAPTURE.REFUNDED", "CHECKOUT.ORDER.APPROVED", "PAYMENT.CAPTURE.PENDING", "SOMETHING.NEW"])("acknowledges %s and changes nothing", async (type) => {
    const before = JSON.stringify(await prisma.payment.findMany({ orderBy: { id: "asc" } }));
    expect(await run(event({ type }))).toEqual({ status: 200, body: { ok: true, outcome: "ignored" } });
    expect(JSON.stringify(await prisma.payment.findMany({ orderBy: { id: "asc" } }))).toBe(before);
  });
});
