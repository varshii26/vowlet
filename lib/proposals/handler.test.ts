import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { TODAY, ok } from "@/lib/agent/tools/test-utils";
import { loadPendingProposals } from "@/lib/proposals/data";
import { proposalHandler } from "@/lib/proposals/handler";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase } from "@/lib/test-utils/db";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDatabase());
}, 60_000);
afterAll(async () => cleanup());
beforeEach(async () => seedDemo(prisma));

const post = (body: unknown) =>
  new Request("http://localhost/api/proposals/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const call = async (id: string, body: unknown) => {
  const res = await proposalHandler(id, post(body), { prisma, now: () => TODAY });
  return { status: res.status, body: await res.json() };
};
const propose = async (args: Record<string, unknown>) => (await ok(prisma, "propose_action", { reason: "because", ...args })).proposalId as string;

describe("proposalHandler", () => {
  it("approves and says what happened", async () => {
    const id = await propose({ kind: "reschedule", newDate: "2027-06-17" });
    const r = await call(id, { action: "approve" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, status: "approved" });
    expect(r.body.message).toContain("2027-06-17");
  });

  it("dismisses", async () => {
    const id = await propose({ kind: "message", message: "A note for you." });
    expect(await call(id, { action: "dismiss" })).toEqual({ status: 200, body: { ok: true, status: "dismissed", message: "Dismissed. Nothing was changed." } });
  });

  it("returns the drafted message when a refund request is approved", async () => {
    const id = await propose({ kind: "refund_request", vendorId: "Grand Oak Estate", cancelledBy: "couple", message: "Please refund us." });
    expect((await call(id, { action: "approve" })).body.draft).toBe("Please refund us.");
  });

  it("flags a repeat as already resolved", async () => {
    const id = await propose({ kind: "message", message: "A note for you." });
    await call(id, { action: "approve" });
    expect((await call(id, { action: "approve" })).body).toMatchObject({ ok: true, alreadyResolved: true });
  });

  it.each([
    ["an unknown id", "nope", { action: "approve" }, 404],
  ])("answers %s with %i", async (_name, id, body, status) => {
    expect((await call(id, body)).status).toBe(status);
  });

  it("answers 409 for the opposite action after one was taken", async () => {
    const id = await propose({ kind: "message", message: "A note for you." });
    await call(id, { action: "dismiss" });
    expect(await call(id, { action: "approve" })).toMatchObject({ status: 409, body: { ok: false, error: { code: "conflict" } } });
  });

  it("answers 409 with a reason when a payment hasn't been made, and 422 for unreadable details", async () => {
    const pay = await propose({ kind: "pay", paymentId: (await prisma.payment.findFirstOrThrow({ where: { label: "Venue second installment" } })).id });
    expect(await call(pay, { action: "approve" })).toMatchObject({ status: 409, body: { error: { code: "not_paid" } } });

    const w = await prisma.wedding.findFirstOrThrow();
    const bad = (await prisma.proposal.create({ data: { weddingId: w.id, kind: "pay", payload: { nope: true } } })).id;
    expect(await call(bad, { action: "approve" })).toMatchObject({ status: 422, body: { error: { code: "invalid_payload" } } });
  });

  describe("bad requests", () => {
    it("answers 400 for a body that isn't JSON", async () => {
      expect((await call("x", "not json")).status).toBe(400);
    });

    it.each([{}, { action: "pay" }, { action: "APPROVE" }, { action: 1 }, { action: null }, []])("answers 400 for %j and names the allowed actions", async (body) => {
      const r = await call("x", body);
      expect(r.status).toBe(400);
      expect(r.body.error.message).toContain('"approve" or "dismiss"');
    });

    it("does not touch the proposal for a bad request", async () => {
      const id = await propose({ kind: "message", message: "A note for you." });
      await call(id, { action: "delete" });
      expect((await prisma.proposal.findUniqueOrThrow({ where: { id } })).status).toBe("pending");
    });
  });
});

describe("loadPendingProposals", () => {
  it("lists only the proposals still waiting, oldest first, ready for the cards", async () => {
    const a = await propose({ kind: "message", message: "First note, please read." });
    const b = await propose({ kind: "reschedule", newDate: "2027-06-17" });
    const c = await propose({ kind: "message", message: "Third note, please read." });
    await call(c, { action: "dismiss" });
    await call(a, { action: "approve" });

    const pending = await loadPendingProposals(prisma);
    expect(pending.map((p) => p.id)).toEqual([b]);
    expect(pending[0]).toMatchObject({ kind: "reschedule", title: "Move the wedding", approvable: true });
  });

  it("includes the clause citation in words", async () => {
    await propose({ kind: "refund_request", vendorId: "Grand Oak Estate", cancelledBy: "couple", message: "Please refund us." });
    expect((await loadPendingProposals(prisma))[0].citation).toBe("Grand Oak Estate contract, page 2");
  });

  it("is empty when nothing is waiting", async () => {
    expect(await loadPendingProposals(prisma)).toEqual([]);
  });
});
