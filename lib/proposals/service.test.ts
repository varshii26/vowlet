import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { TODAY, ok } from "@/lib/agent/tools/test-utils";
import { markPaymentPaid } from "@/lib/payments/service";
import { resolveProposal } from "@/lib/proposals/service";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase } from "@/lib/test-utils/db";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDatabase());
}, 60_000);
afterAll(async () => cleanup());
beforeEach(async () => seedDemo(prisma));

/** Records a proposal the way the agent does, through the real tool, and returns its id. */
const propose = async (args: Record<string, unknown>) => (await ok(prisma, "propose_action", { reason: "because", ...args })).proposalId as string;
const approve = (id: string) => resolveProposal(prisma, id, "approve", TODAY);
const dismiss = (id: string) => resolveProposal(prisma, id, "dismiss", TODAY);

const payment = (label: string) => prisma.payment.findFirstOrThrow({ where: { label } });
const wedding = () => prisma.wedding.findFirstOrThrow();
const proposal = (id: string) => prisma.proposal.findUniqueOrThrow({ where: { id } });
const events = (type: string) => prisma.eventLog.findMany({ where: { type } });

/** A proposal written straight to the database, for shapes the tool would never produce. */
async function plant(kind: "pay" | "reschedule" | "refund_request" | "message", payload: unknown) {
  const w = await wedding();
  return (await prisma.proposal.create({ data: { weddingId: w.id, kind, payload: payload as never } })).id;
}

describe("dismissing", () => {
  it("marks it dismissed and changes nothing else", async () => {
    const id = await propose({ kind: "reschedule", newDate: "2027-06-17" });
    const before = await wedding();
    const result = await dismiss(id);

    expect(result).toEqual({ ok: true, status: "dismissed", message: "Dismissed. Nothing was changed." });
    expect((await proposal(id)).status).toBe("dismissed");
    expect((await wedding()).date).toEqual(before.date);
    expect(await events("proposal_dismissed")).toHaveLength(1);
  });

  it("is a no-op the second time", async () => {
    const id = await propose({ kind: "message", message: "A note for you." });
    await dismiss(id);
    expect(await dismiss(id)).toMatchObject({ ok: true, status: "dismissed", alreadyResolved: true });
    expect(await events("proposal_dismissed")).toHaveLength(1);
  });

  it("works on a proposal whose details can't be read", async () => {
    const id = await plant("pay", { garbage: true });
    expect(await dismiss(id)).toMatchObject({ ok: true, status: "dismissed" });
  });
});

describe("any proposal", () => {
  it("is refused for one that doesn't exist", async () => {
    expect(await approve("nope")).toEqual({ ok: false, code: "not_found", message: "That proposal doesn't exist.", status: 404 });
    expect(await dismiss("nope")).toMatchObject({ ok: false, status: 404 });
  });

  it("can't be approved after it was dismissed, or dismissed after it was approved", async () => {
    const a = await propose({ kind: "message", message: "A note for you." });
    await dismiss(a);
    expect(await approve(a)).toEqual({ ok: false, code: "conflict", message: "This proposal was already dismissed.", status: 409 });

    const b = await propose({ kind: "message", message: "Another note for you." });
    await approve(b);
    expect(await dismiss(b)).toMatchObject({ ok: false, code: "conflict", status: 409 });
    expect((await proposal(b)).status).toBe("approved");
  });

  it("is resolved exactly once when two clicks arrive together", async () => {
    const id = await propose({ kind: "reschedule", newDate: "2027-06-17" });
    const [a, b] = await Promise.all([approve(id), approve(id)]);

    expect([a, b].every((r) => r.ok)).toBe(true);
    expect([a, b].filter((r) => r.ok && !r.alreadyResolved)).toHaveLength(1);
    expect(await events("proposal_approved")).toHaveLength(1);
    expect((await wedding()).date.toISOString()).toBe("2027-06-17T00:00:00.000Z");
  });

  it("is refused if its stored details can't be read, and stays pending", async () => {
    const id = await plant("reschedule", { newDate: 42 });
    const result = await approve(id);
    expect(result).toMatchObject({ ok: false, code: "invalid_payload", status: 422 });
    expect((await proposal(id)).status).toBe("pending");
  });

  it("writes an activity-log entry when approved", async () => {
    await approve(await propose({ kind: "message", message: "A note for you." }));
    expect((await events("proposal_approved")).map((e) => e.message)).toEqual(["Noted."]);
  });
});

describe("approving a pay proposal never pays", () => {
  const payId = async () => propose({ kind: "pay", paymentId: (await payment("Venue second installment")).id });

  it("is refused while the payment has not been made, and the proposal stays pending", async () => {
    const id = await payId();
    const result = await approve(id);

    expect(result).toMatchObject({ ok: false, code: "not_paid", status: 409 });
    expect(result.ok ? "" : result.message).toContain("Pay with PayPal");
    expect((await proposal(id)).status).toBe("pending");
    expect(await events("proposal_approved")).toHaveLength(0);
  });

  it("leaves the payment unpaid, with no PayPal order, whatever is clicked", async () => {
    await approve(await payId());
    expect(await payment("Venue second installment")).toMatchObject({ status: "scheduled", paypalOrderId: null, captureId: null, paidAt: null });
  });

  it("is approved once the payment really has gone through PayPal", async () => {
    const id = await payId();
    await markPaymentPaid(prisma, (await payment("Venue second installment")).id, { captureId: "CAP-1", orderId: "ORDER-1" });
    const result = await approve(id);

    expect(result).toMatchObject({ ok: true, status: "approved", message: "Approved. $3,000 was paid to Grand Oak Estate (Venue second installment)." });
    expect((await proposal(id)).status).toBe("approved");
    expect(await payment("Venue second installment")).toMatchObject({ status: "paid", captureId: "CAP-1" }); // untouched by approval
  });

  it("is a no-op the second time", async () => {
    const id = await payId();
    await markPaymentPaid(prisma, (await payment("Venue second installment")).id, { captureId: "CAP-1" });
    await approve(id);
    expect(await approve(id)).toMatchObject({ ok: true, alreadyResolved: true });
  });
});

describe("approving a reschedule", () => {
  it("moves the wedding, and leaves every payment's anchor and offset alone so the dates follow", async () => {
    const before = await prisma.payment.findMany({ orderBy: { id: "asc" } });
    const id = await propose({ kind: "reschedule", newDate: "2027-06-17" });
    const result = await approve(id);

    expect(result.ok && result.message).toBe("Approved. The wedding is now on 2027-06-17 and every payment date has moved with it. Vendor change fees come to $1,330.");
    expect((await wedding()).date.toISOString()).toBe("2027-06-17T00:00:00.000Z");
    expect(await prisma.payment.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    expect((await events("proposal_approved"))[0].message).toContain("2027-06-17");
  });

  it("dismisses other pending date changes, which were worked out against the old date", async () => {
    const a = await propose({ kind: "reschedule", newDate: "2027-06-17" });
    const b = await propose({ kind: "reschedule", newDate: "2027-07-17" });
    await approve(a);

    expect((await proposal(b)).status).toBe("dismissed");
    expect(await approve(b)).toMatchObject({ ok: false, code: "conflict" });
    expect((await wedding()).date.toISOString()).toBe("2027-06-17T00:00:00.000Z");
  });

  it("is refused if the wedding date has changed since it was proposed", async () => {
    const id = await plant("reschedule", { previousDate: "2027-03-01", newDate: "2027-06-17", totalCostCents: 0, charges: [] });
    const result = await approve(id);
    expect(result).toMatchObject({ ok: false, code: "stale", status: 409 });
    expect(result.ok ? "" : result.message).toContain("it is now 2027-04-17");
    expect((await proposal(id)).status).toBe("pending");
    expect((await wedding()).date.toISOString()).toBe("2027-04-17T00:00:00.000Z");
  });

  it("is refused for a date that has already passed", async () => {
    const id = await plant("reschedule", { previousDate: "2027-04-17", newDate: "2026-01-01", totalCostCents: 0, charges: [] });
    expect(await approve(id)).toMatchObject({ ok: false, code: "in_past" });
    expect((await wedding()).date.toISOString()).toBe("2027-04-17T00:00:00.000Z");
  });

  it("is refused for a date that isn't a date", async () => {
    const id = await plant("reschedule", { previousDate: "2027-04-17", newDate: "someday", totalCostCents: 0, charges: [] });
    expect(await approve(id)).toMatchObject({ ok: false, code: "invalid_payload", status: 422 });
  });

  it("says nothing about fees when there are none", async () => {
    const id = await plant("reschedule", { previousDate: "2027-04-17", newDate: "2027-04-24", totalCostCents: 0, charges: [] });
    const result = await approve(id);
    expect(result.ok && result.message).toBe("Approved. The wedding is now on 2027-04-24 and every payment date has moved with it.");
  });
});

describe("approving a refund request", () => {
  const message = "Dear Grand Oak Estate, per your cancellation terms we request a refund.";
  const refund = (extra: Record<string, unknown> = {}) => propose({ kind: "refund_request", vendorId: "Grand Oak Estate", cancelledBy: "couple", message, ...extra });

  it("marks that vendor's paid payments refund requested, and hands back the drafted message", async () => {
    const id = await refund();
    const result = await approve(id);

    expect(result).toMatchObject({ ok: true, status: "approved", draft: message });
    expect(result.ok && result.message).toContain("The payment to Grand Oak Estate is now marked refund requested");
    expect(result.ok && result.message).toContain("nothing has been sent for you");
    expect((await payment("Venue deposit")).status).toBe("refund_requested");
  });

  it("leaves unpaid payments, other vendors and the vendor itself alone", async () => {
    await approve(await refund());
    expect((await payment("Venue second installment")).status).toBe("scheduled");
    expect((await payment("Catering deposit")).status).toBe("paid");
    expect((await prisma.vendor.findFirstOrThrow({ where: { name: "Grand Oak Estate" } })).status).toBe("active");
  });

  it("issues no PayPal refund: it only records the request", async () => {
    await approve(await refund());
    expect(await payment("Venue deposit")).toMatchObject({ status: "refund_requested", captureId: null });
  });

  it("says how many payments when there are several", async () => {
    const id = await refund();
    const second = await payment("Venue second installment");
    await prisma.payment.update({ where: { id: second.id }, data: { status: "paid" } });
    const result = await approve(id);
    expect(result.ok && result.message).toContain("2 payments to Grand Oak Estate are now marked refund requested");
  });

  it("is refused when nothing has been paid to that vendor, and the proposal stays pending", async () => {
    const velvet = await prisma.vendor.findFirstOrThrow({ where: { name: "Velvet Strings Quartet" } }); // nothing paid yet
    const id = await plant("refund_request", { vendorId: velvet.id, vendorName: velvet.name, cancelledBy: "couple", cancellationDate: "2026-11-07", owedCents: 100, paidCents: 100, calculation: "", message: "please refund", reason: "" });
    const result = await approve(id);
    expect(result).toMatchObject({ ok: false, code: "nothing_paid", status: 409 });
    expect((await proposal(id)).status).toBe("pending");
  });
});

describe("approving a note", () => {
  it("just acknowledges it", async () => {
    const id = await propose({ kind: "message", message: "Nothing is owed back: the deposit is non-refundable." });
    expect(await approve(id)).toEqual({ ok: true, status: "approved", message: "Noted." });
  });
});

describe("this module cannot move money", () => {
  const source = readFileSync(path.join(process.cwd(), "lib", "proposals", "service.ts"), "utf8");

  it("does not touch PayPal or the payment service", () => {
    expect(source).not.toMatch(/from\s+["']@\/lib\/paypal["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/payments/);
    expect(source).not.toMatch(/captureOrder|createOrder|refundCapture|markPaymentPaid/);
  });

  it("only ever sets payments to refund_requested, never to paid", () => {
    const writes = [...source.matchAll(/\.payment\.(update|updateMany|create|upsert|delete|deleteMany)\(([\s\S]*?)\)\s*;/g)];
    expect(writes).toHaveLength(1); // the one refund-requested update
    expect(writes[0][2]).toMatch(/data:\s*\{\s*status:\s*"refund_requested"\s*\}/);
  });
});
