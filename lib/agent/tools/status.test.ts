import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { executeTool } from "@/lib/agent/tools";
import { TODAY } from "@/lib/agent/tools/test-utils";
import type { OrderLookup } from "@/lib/agent/tools/types";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase } from "@/lib/test-utils/db";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(() => {
  ({ prisma, cleanup } = createTestDatabase());
}, 60_000);
afterAll(async () => cleanup());
beforeEach(async () => seedDemo(prisma));

type OrderResult = Awaited<ReturnType<OrderLookup["getOrder"]>>;
type CaptureResult = Awaited<ReturnType<OrderLookup["getCapture"]>>;

const order = (over: Record<string, unknown> = {}): OrderResult => ({
  ok: true,
  value: { orderId: "ORDER-1", status: "COMPLETED", amount: 110_000, payeeEmail: null, captures: [{ captureId: "CAP-1", status: "COMPLETED", amount: 110_000, createdAt: "2026-11-07T10:38:40Z" }], ...over },
});
const capture = (over: Record<string, unknown> = {}): CaptureResult => ({
  ok: true,
  value: { captureId: "CAP-1", status: "COMPLETED", amount: 110_000, payeeEmail: null, createdAt: "2026-11-07T10:38:40Z", orderId: "ORDER-1", ...over },
});

/** A lookup that records every property touched on it, to prove the tool only reads. */
function spyLookup(answers: { order?: () => Promise<OrderResult>; capture?: () => Promise<CaptureResult> }) {
  const touched: string[] = [];
  const getOrder = vi.fn(answers.order ?? (async () => order()));
  const getCapture = vi.fn(answers.capture ?? (async () => capture()));
  const lookup = new Proxy({ getOrder, getCapture } as OrderLookup, {
    get(target, prop, receiver) {
      touched.push(String(prop));
      return Reflect.get(target, prop, receiver);
    },
  });
  return { lookup, getOrder, getCapture, touched };
}

async function check(vendor: string, paypal: OrderLookup | null) {
  const outcome = await executeTool("check_payment_status", { vendorId: vendor }, { prisma, today: TODAY, paypal });
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.output as { vendorName: string; payments: Array<{ label: string; vowletStatus: string; summary: string; paypal: Record<string, unknown> }> };
}

/** The suit payment ($1,100), started in PayPal: an order, and optionally a capture. */
async function suit(ids: { paypalOrderId?: string | null; captureId?: string | null }) {
  const p = await prisma.payment.findFirstOrThrow({ where: { label: "Suit full payment" } });
  await prisma.payment.update({ where: { id: p.id }, data: ids });
  return p;
}
const row = async (paypal: OrderLookup | null) => (await check("Dapper & Co Tailoring", paypal)).payments[0];

describe("check_payment_status", () => {
  it("asks PayPal about the capture when there is one, and confirms the payment", async () => {
    await suit({ paypalOrderId: "ORDER-1", captureId: "CAP-1" });
    const spy = spyLookup({});
    const r = await row(spy.lookup);
    expect(r).toMatchObject({ label: "Suit full payment", summary: "Paid: PayPal confirms the money was captured." });
    expect(r.paypal).toMatchObject({ checked: true, source: "capture", capture: { status: "COMPLETED", amount: { label: "$1,100" } }, amountMatches: true });
    expect(spy.getCapture).toHaveBeenCalledExactlyOnceWith("CAP-1");
    expect(spy.getOrder).not.toHaveBeenCalled();
    expect(new Set(spy.touched)).toEqual(new Set(["getCapture"]));
  });

  it("falls back to the order when the capture can't be read", async () => {
    await suit({ paypalOrderId: "ORDER-1", captureId: "CAP-1" });
    const spy = spyLookup({ capture: async () => ({ ok: false, reason: "not_allowed" }) });
    expect((await row(spy.lookup)).paypal).toMatchObject({ checked: true, source: "order" });
    expect(spy.getOrder).toHaveBeenCalledExactlyOnceWith("ORDER-1");
  });

  it("uses the order before a payment is captured", async () => {
    await suit({ paypalOrderId: "ORDER-1" });
    const spy = spyLookup({ order: async () => order({ status: "APPROVED", captures: [] }) });
    expect((await row(spy.lookup)).summary).toBe("Approved in PayPal but not captured yet.");
    expect(spy.getCapture).not.toHaveBeenCalled();
  });

  it("explains why PayPal couldn't be checked", async () => {
    await suit({ paypalOrderId: "OLD" });
    expect((await row(spyLookup({ order: async () => ({ ok: false, reason: "not_found" }) }).lookup)).paypal).toMatchObject({ checked: false, reason: expect.stringContaining("no longer has details") });
    expect((await row(spyLookup({ order: async () => ({ ok: false, reason: "unavailable" }) }).lookup)).paypal).toMatchObject({ checked: false, reason: expect.stringContaining("couldn't be reached") });
    expect((await row(null)).paypal).toMatchObject({ checked: false, reason: expect.stringContaining("isn't connected") });
    await suit({ paypalOrderId: null, captureId: "THEIRS" });
    expect((await row(spyLookup({ capture: async () => ({ ok: false, reason: "not_allowed" }) }).lookup)).paypal).toMatchObject({ checked: false, reason: expect.stringContaining("won't show") });
  });

  it("flags a capture for a different amount, instead of calling it paid", async () => {
    await suit({ captureId: "CAP-1" });
    const r = await row(spyLookup({ capture: async () => capture({ amount: 500 }) }).lookup);
    expect(r.paypal).toMatchObject({ amountMatches: false });
    expect(r.summary).toBe("PayPal captured $5, but $1,100 was expected for this payment. Check it in PayPal.");
  });

  it("flags a payee that isn't the vendor's PayPal account", async () => {
    await suit({ captureId: "CAP-1" });
    const r = await row(spyLookup({ capture: async () => capture({ payeeEmail: "someone-else@example.com" }) }).lookup);
    expect(r.paypal).toMatchObject({ payeeMatches: false });
    expect(r.summary).toMatch(/different recipient/);
  });

  it.each([
    ["PENDING", /^Pending at PayPal/],
    ["REFUNDED", /refunded\.$/],
    ["DECLINED", /as declined\.$/],
  ])("describes a %s capture", async (status, text) => {
    await suit({ captureId: "CAP-1" });
    expect((await row(spyLookup({ capture: async () => capture({ status }) }).lookup)).summary).toMatch(text);
  });

  it("doesn't ask PayPal about a payment never started there", async () => {
    const spy = spyLookup({});
    expect(await row(spy.lookup)).toMatchObject({ vowletStatus: "scheduled", summary: "Not paid yet, according to Vowlet's record.", paypal: { checked: false, reason: "Not started in PayPal yet." } });
    expect(spy.touched).toEqual([]);
  });

  it("changes nothing in the database", async () => {
    await suit({ paypalOrderId: "ORDER-1", captureId: "CAP-1" });
    const before = await prisma.payment.findMany({ orderBy: { id: "asc" } });
    await row(spyLookup({}).lookup);
    expect(await prisma.payment.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });

  it("finds the vendor by category or part of its name, like the other tools", async () => {
    expect((await check("photographer", null)).vendorName).toBe("Lumen Photography");
    expect((await check("Lumen", null)).vendorName).toBe("Lumen Photography");
  });
});

describe("the agent's only PayPal access is read-only", () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

  it("the agent route hands the loop the read-only reader, never the full client", () => {
    const route = read("app/api/agent/route.ts");
    expect(route).toMatch(/import \{ paypalReader \} from "@\/lib\/paypal";/);
    expect(route).not.toMatch(/\bpaypal\(\)/);
  });

  it("no agent file imports the PayPal client or SDK", () => {
    for (const file of ["lib/agent/loop.ts", "lib/agent/handler.ts", "lib/agent/prompt.ts", "lib/agent/tools/status.ts"]) {
      expect(read(file), file).not.toMatch(/from\s+["']@\/lib\/paypal["']|paypal-server-sdk/);
    }
  });
});
