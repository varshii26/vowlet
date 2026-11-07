import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { TODAY } from "@/lib/agent/tools/test-utils";
import { dateChangeRulesSchema } from "@/lib/rules";
import { toIsoDate } from "@/lib/schedule";
import { seedDemo } from "@/lib/seed/demo";
import { dateChangeCost } from "@/lib/terms";
import { createTestDatabase } from "@/lib/test-utils/db";
import { applyWhatIfHandler, whatIfHandler } from "@/lib/whatif/handler";
import { DRAG_REASON } from "@/lib/whatif/service";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDatabase());
}, 60_000);
afterAll(async () => cleanup());
beforeEach(async () => seedDemo(prisma));

const post = (body: unknown) =>
  new Request("http://localhost/api/whatif", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const preview = async (body: unknown) => {
  const res = await whatIfHandler(post(body), { prisma, now: () => TODAY });
  return { status: res.status, body: await res.json() };
};
const apply = async (body: unknown) => {
  const res = await applyWhatIfHandler(post(body), { prisma, now: () => TODAY });
  return { status: res.status, body: await res.json() };
};
const weddingDate = async () => toIsoDate((await prisma.wedding.findFirstOrThrow()).date);

describe("POST /api/whatif", () => {
  it("returns exactly what dateChangeCost() computes from the contract terms", async () => {
    const r = await preview({ newDate: "2027-06-12" });
    expect(r.status).toBe(200);

    // Recompute straight from the database with lib/terms.ts.
    const wedding = await prisma.wedding.findFirstOrThrow();
    const vendors = await prisma.vendor.findMany({
      include: { terms: true, clauses: { where: { kind: "date_change" }, orderBy: { page: "asc" } } },
      orderBy: { name: "asc" },
    });
    const expected = dateChangeCost({
      originalDate: wedding.date,
      newDate: new Date("2027-06-12T00:00:00.000Z"),
      today: TODAY,
      vendors: vendors.map((v) => ({
        vendorId: v.id,
        vendorName: v.name,
        totalCostCents: v.totalCost,
        status: v.status,
        dateChangeRules: v.terms ? dateChangeRulesSchema.parse(v.terms.dateChangeRules) : [],
        clauseId: v.clauses[0]?.id ?? null,
      })),
    });

    expect(r.body.totalCents).toBe(expected.totalCents);
    expect(r.body.rows).toHaveLength(expected.rows.length);
    expect(
      r.body.rows.map((row: Record<string, unknown>) => ({ vendorId: row.vendorId, costCents: row.costCents, reason: row.reason, clauseId: row.clauseId })),
    ).toEqual(expected.rows.map((row) => ({ vendorId: row.vendorId, costCents: row.costCents, reason: row.reason, clauseId: row.clauseId })));
    expect(r.body).toMatchObject({ ok: true, currentDate: "2027-04-17", newDate: "2027-06-12", shiftDays: 56 });
    // Sanity: the seeded contracts make this move cost something.
    expect(expected.totalCents).toBeGreaterThan(0);
  });

  it("cites the date-change clause for rows that have one", async () => {
    const r = await preview({ newDate: "2027-06-12" });
    const cited = r.body.rows.filter((row: { clauseId: string | null }) => row.clauseId);
    expect(cited.length).toBeGreaterThan(0);
    for (const row of cited) expect(row.citation).toMatch(/contract, page \d+$/);
  });

  it("labels each row: a fee, free under the contract, or a contract to check", async () => {
    const r = await preview({ newDate: "2027-06-12" });
    for (const row of r.body.rows) {
      if (row.costCents > 0) expect(row.kind).toBe("fee");
      else expect(["free", "check", "cancelled"]).toContain(row.kind);
    }
    expect(r.body.rows.some((row: { kind: string }) => row.kind === "fee")).toBe(true);
  });

  it("changes nothing", async () => {
    await preview({ newDate: "2027-06-12" });
    expect(await weddingDate()).toBe("2027-04-17");
    expect(await prisma.proposal.count()).toBe(0);
  });

  it("refuses a date in the past", async () => {
    expect(await preview({ newDate: "2026-11-06" })).toMatchObject({ status: 400, body: { ok: false, error: { code: "in_past" } } });
  });

  it.each([["not json"], [{}], [{ newDate: "June 12" }], [{ newDate: "2027-02-30" }]])("answers 400 for a bad body %#", async (body) => {
    expect((await preview(body)).status).toBe(400);
  });
});

describe("POST /api/whatif/apply", () => {
  it("moves the wedding and records an approved reschedule proposal", async () => {
    const r = await apply({ newDate: "2027-06-12", previousDate: "2027-04-17" });
    expect(r.status).toBe(200);
    expect(r.body.message).toContain("2027-06-12");
    expect(await weddingDate()).toBe("2027-06-12");

    const proposals = await prisma.proposal.findMany();
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ kind: "reschedule", status: "approved" });
    expect(proposals[0].payload).toMatchObject({ previousDate: "2027-04-17", newDate: "2027-06-12", reason: DRAG_REASON });
  });

  it("stores the same total the preview showed", async () => {
    const shown = (await preview({ newDate: "2027-06-12" })).body.totalCents;
    await apply({ newDate: "2027-06-12", previousDate: "2027-04-17" });
    const stored = (await prisma.proposal.findFirstOrThrow()).payload as { totalCostCents: number };
    expect(stored.totalCostCents).toBe(shown);
  });

  it("refuses when the wedding moved since the couple started dragging", async () => {
    const r = await apply({ newDate: "2027-06-12", previousDate: "2027-05-01" });
    expect(r).toMatchObject({ status: 409, body: { ok: false, error: { code: "stale" } } });
    expect(await weddingDate()).toBe("2027-04-17");
    expect(await prisma.proposal.count()).toBe(0);
  });

  it("refuses the current date and dates in the past", async () => {
    expect((await apply({ newDate: "2027-04-17", previousDate: "2027-04-17" })).body.error.code).toBe("unchanged");
    expect((await apply({ newDate: "2026-01-01", previousDate: "2027-04-17" })).body.error.code).toBe("in_past");
    expect(await weddingDate()).toBe("2027-04-17");
    expect(await prisma.proposal.count()).toBe(0);
  });

  it("answers 400 for a bad body", async () => {
    expect((await apply({ newDate: "2027-06-12" })).status).toBe(400);
  });
});
