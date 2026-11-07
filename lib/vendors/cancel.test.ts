import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { TODAY, ok } from "@/lib/agent/tools/test-utils";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase } from "@/lib/test-utils/db";
import { cancelVendorHandler } from "@/lib/vendors/cancel-handler";
import { confirmCancellation, draftRefundRequest, previewCancellation } from "@/lib/vendors/cancel";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDatabase());
}, 60_000);
afterAll(async () => cleanup());
beforeEach(async () => seedDemo(prisma));

const vendor = (name: string) => prisma.vendor.findFirstOrThrow({ where: { name } });
const payment = (label: string) => prisma.payment.findFirstOrThrow({ where: { label } });

describe("previewCancellation", () => {
  it("matches the agent's compute_refund_owed exactly, for both sides", async () => {
    for (const name of ["Bloom & Thistle Florals", "Grand Oak Estate", "Saffron & Sage Catering"]) {
      const v = await vendor(name);
      for (const cancelledBy of ["vendor", "couple"] as const) {
        const preview = await previewCancellation(prisma, v.id, cancelledBy, TODAY);
        const tool = await ok(prisma, "compute_refund_owed", { vendorId: v.id, cancelledBy });
        expect(preview).toMatchObject({ ok: true, owedCents: tool.owedBack.cents, paidCents: tool.paidSoFar.cents, clauseId: tool.clauseId, citation: tool.citation });
      }
    }
  });

  it("drafts a request citing the clause and the computed amount, and changes nothing", async () => {
    const v = await vendor("Bloom & Thistle Florals");
    const preview = await previewCancellation(prisma, v.id, "vendor", TODAY);
    if (!preview.ok) throw new Error(preview.message);

    expect(preview.owedCents).toBe(80_000);
    expect(preview.clause?.text.length).toBeGreaterThan(0);
    expect(preview.draft).toContain("Dear Bloom & Thistle Florals,");
    expect(preview.draft).toContain(preview.citation!);
    expect(preview.draft).toContain("Please refund $800");
    expect((await vendor("Bloom & Thistle Florals")).status).toBe("active");
    expect((await payment("Floral deposit")).status).toBe("paid");
  });

  it("has no draft when nothing is owed back", async () => {
    const v = await vendor("Velvet Strings Quartet"); // nothing paid yet
    const preview = await previewCancellation(prisma, v.id, "vendor", TODAY);
    expect(preview).toMatchObject({ ok: true, owedCents: 0, draft: null });
  });

  it("refuses an unknown or already-cancelled vendor", async () => {
    expect(await previewCancellation(prisma, "nope", "vendor", TODAY)).toMatchObject({ ok: false, code: "not_found", status: 404 });
    const v = await vendor("Bloom & Thistle Florals");
    await prisma.vendor.update({ where: { id: v.id }, data: { status: "cancelled" } });
    expect(await previewCancellation(prisma, v.id, "vendor", TODAY)).toMatchObject({ ok: false, code: "already_cancelled", status: 409 });
  });
});

describe("confirmCancellation", () => {
  it("cancels the vendor, marks paid payments refund requested and returns the draft; sends nothing", async () => {
    const v = await vendor("Bloom & Thistle Florals");
    const preview = await previewCancellation(prisma, v.id, "vendor", TODAY);
    const result = await confirmCancellation(prisma, v.id, "vendor", TODAY);

    expect(result).toMatchObject({ ok: true, owedCents: 80_000, draft: preview.ok ? preview.draft : "" });
    expect(result.ok && result.message).toContain("nothing has been sent");
    expect((await vendor("Bloom & Thistle Florals")).status).toBe("cancelled");
    expect(await payment("Floral deposit")).toMatchObject({ status: "refund_requested", captureId: null });
    expect((await payment("Floral final balance")).status).toBe("scheduled");
    expect(await prisma.proposal.findFirst({ where: { kind: "refund_request" } })).toMatchObject({ status: "approved" });
  });

  it("cancels with no refund request when nothing is owed back", async () => {
    const v = await vendor("Velvet Strings Quartet");
    const result = await confirmCancellation(prisma, v.id, "couple", TODAY);
    expect(result).toMatchObject({ ok: true, owedCents: 0, draft: null });
    expect((await vendor("Velvet Strings Quartet")).status).toBe("cancelled");
    expect(await prisma.proposal.count()).toBe(0);
    expect(await prisma.eventLog.count({ where: { type: "vendor_cancelled" } })).toBe(1);
  });

  it("can't cancel the same vendor twice", async () => {
    const v = await vendor("Bloom & Thistle Florals");
    await confirmCancellation(prisma, v.id, "vendor", TODAY);
    expect(await confirmCancellation(prisma, v.id, "vendor", TODAY)).toMatchObject({ ok: false, code: "already_cancelled" });
  });
});

describe("draftRefundRequest", () => {
  it("states the couple's calculation when the couple cancels", () => {
    const text = draftRefundRequest({
      vendorName: "Lumen Photography",
      coupleNames: "Priya & Sam",
      weddingDate: "2027-04-17",
      cancelledBy: "couple",
      owedCents: 50_000,
      paidCents: 100_000,
      reason: "161 days' notice: 50% of $1,000 paid = $500 owed back.",
      citation: "Lumen Photography contract, page 2",
    });
    expect(text).toContain("(Lumen Photography contract, page 2), the refund due works out as 161 days' notice: 50% of $1,000 paid = $500 owed back.");
    expect(text).toContain("Please refund $500");
    expect(text.endsWith("Priya & Sam")).toBe(true);
  });
});

describe("cancelVendorHandler", () => {
  const call = async (id: string, body: unknown) => {
    const req = new Request("http://localhost/api/vendors/x/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
    const res = await cancelVendorHandler(id, req, { prisma, now: () => TODAY });
    return { status: res.status, body: await res.json() };
  };

  it("previews without confirm, and cancels with it", async () => {
    const v = await vendor("Bloom & Thistle Florals");
    const preview = await call(v.id, { cancelledBy: "vendor" });
    expect(preview).toMatchObject({ status: 200, body: { ok: true, owedCents: 80_000 } });
    expect((await vendor("Bloom & Thistle Florals")).status).toBe("active");

    const done = await call(v.id, { cancelledBy: "vendor", confirm: true });
    expect(done).toMatchObject({ status: 200, body: { ok: true, owedCents: 80_000 } });
    expect((await vendor("Bloom & Thistle Florals")).status).toBe("cancelled");
  });

  it("rejects a bad body and reports failures", async () => {
    expect((await call("x", "not json")).status).toBe(400);
    expect((await call("x", { cancelledBy: "someone" })).status).toBe(400);
    expect(await call("x", { cancelledBy: "vendor" })).toMatchObject({ status: 404, body: { ok: false, error: { code: "not_found" } } });
  });
});
