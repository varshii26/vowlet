import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { TODAY } from "@/lib/agent/tools/test-utils";
import { dateChangeRulesSchema } from "@/lib/rules";
import { toIsoDate } from "@/lib/schedule";
import { seedDemo } from "@/lib/seed/demo";
import { dateChangeCost } from "@/lib/terms";
import { createTestDatabase, soleWeddingId } from "@/lib/test-utils/db";
import { LlmError } from "@/lib/llm/gemini";
import { fakeGemini, modelAnswer } from "@/lib/llm/test-utils";
import { formatCents } from "@/lib/money";
import { createRateLimiter } from "@/lib/rate-limit";
import { templateExplanation } from "@/lib/whatif/explain";
import { applyWhatIfHandler, explainWhatIfHandler, whatIfHandler } from "@/lib/whatif/handler";
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
  const res = await whatIfHandler(post(body), { prisma, resolveWeddingId: () => soleWeddingId(prisma), now: () => TODAY });
  return { status: res.status, body: await res.json() };
};
const apply = async (body: unknown) => {
  const res = await applyWhatIfHandler(post(body), { prisma, resolveWeddingId: () => soleWeddingId(prisma), now: () => TODAY });
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

  it("reports the wedding's total after the move against the budget", async () => {
    const r = await preview({ newDate: "2027-06-12" });
    expect(r.body.budget).toMatchObject({ budgetCents: 3_600_000, overByCents: 0 });
    expect(r.body.budget.projectedCents).toBeGreaterThan(r.body.totalCents);
  });

  it("cites the date-change clause for rows that have one, with the clause text to open", async () => {
    const r = await preview({ newDate: "2027-06-12" });
    const cited = r.body.rows.filter((row: { clauseId: string | null }) => row.clauseId);
    expect(cited.length).toBeGreaterThan(0);
    for (const row of cited) {
      expect(row.citation).toMatch(/contract, page \d+$/);
      const clause = await prisma.clause.findUniqueOrThrow({ where: { id: row.clauseId } });
      expect(row.clause).toEqual({ text: clause.text, page: clause.page });
      expect(row.citation).toContain(`page ${clause.page}`);
    }
    for (const row of r.body.rows.filter((row: { clauseId: string | null }) => !row.clauseId)) expect(row.clause).toBeNull();
  });

  it("gives the notice once, the same for any new date, and each row's fee basis without it", async () => {
    const june = (await preview({ newDate: "2027-06-12" })).body;
    const sept = (await preview({ newDate: "2027-09-04" })).body;
    // Today (TODAY) to the current wedding date, as dateChangeCost() measures it.
    const expected = Math.round((Date.UTC(2027, 3, 17) - TODAY.getTime()) / 86_400_000);
    expect(june.noticeDays).toBe(expected);
    expect(sept.noticeDays).toBe(expected);

    for (const row of june.rows) {
      expect(row.basis).not.toContain(`${expected} days' notice`);
      if (row.kind === "fee") expect(row.basis).toMatch(/% of the contract|flat fee/);
      if (row.kind === "free") expect(row.basis).toMatch(/^Free with at least \d+ days' notice$/);
      if (row.kind === "check") expect(row.basis).toBe(row.reason);
    }
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

describe("an account that hasn't set up a wedding", () => {
  const none = { prisma, resolveWeddingId: async () => null, now: () => TODAY };
  const body = { newDate: "2027-06-12", previousDate: "2027-04-17" };

  it("gets 409 from the preview, the apply and the explain, and nothing is changed", async () => {
    const before = await weddingDate();
    for (const res of [
      await whatIfHandler(post(body), none),
      await applyWhatIfHandler(post(body), none),
      await explainWhatIfHandler(post(body), { ...none, client: fakeGemini().client, models: ["m1"], configured: true, limiter: createRateLimiter({ max: 10, windowMs: 60_000 }) }),
    ]) {
      expect(res.status).toBe(409);
      expect((await res.json()).error).toEqual({ code: "no_wedding", message: "Set up your wedding first." });
    }
    expect(await weddingDate()).toBe(before);
  });
});

describe("POST /api/whatif/explain", () => {
  const explain = async (body: unknown, client = fakeGemini().client, opts: { configured?: boolean; max?: number } = {}) => {
    const res = await explainWhatIfHandler(post(body), {
      prisma,
      resolveWeddingId: () => soleWeddingId(prisma),
      now: () => TODAY,
      client,
      models: ["m1"],
      configured: opts.configured ?? true,
      limiter: createRateLimiter({ max: opts.max ?? 10, windowMs: 60_000 }),
    });
    return { status: res.status, body: await res.json() };
  };
  const table = async () => (await preview({ newDate: "2027-06-12" })).body;

  it("returns the model's summary when its numbers match the computed table", async () => {
    const t = await table();
    const fee = t.rows.find((row: { kind: string }) => row.kind === "fee");
    const text = `Moving to June 12 costs ${formatCents(t.totalCents)} in fees, including ${fee.vendorName}.`;
    const fake = fakeGemini(modelAnswer(text));

    const r = await explain({ newDate: "2027-06-12" }, fake.client);
    expect(r).toMatchObject({ status: 200, body: { ok: true, source: "model", text, totalCents: t.totalCents } });
    // The model is given the table computed on the server, not anything from the browser.
    expect(JSON.stringify(fake.requests[0].contents)).toContain(fee.vendorName);
  });

  it("replaces a summary with a wrong number by the code-written one", async () => {
    const fake = fakeGemini(modelAnswer("Moving costs $99,999."));
    const r = await explain({ newDate: "2027-06-12" }, fake.client);
    expect(r.body.source).toBe("template");
    expect(r.body.text).toContain("June 12, 2027");
    expect(r.body.text).not.toContain("99,999");
  });

  it("still answers with the code-written summary when the model is down, unset or rate limited", async () => {
    expect((await explain({ newDate: "2027-06-12" }, fakeGemini(new LlmError("down", "overloaded")).client)).body.source).toBe("template");
    expect((await explain({ newDate: "2027-06-12" }, undefined, { configured: false })).body.source).toBe("template");

    const unused = fakeGemini();
    const limited = await explain({ newDate: "2027-06-12" }, unused.client, { max: 0 });
    expect(limited).toMatchObject({ status: 200, body: { source: "template" } });
    expect(unused.generateWithFallback).not.toHaveBeenCalled();
  });

  it("writes the template from the same table the preview shows", async () => {
    const t = await table();
    const r = await explain({ newDate: "2027-06-12" }, undefined, { configured: false });
    expect(r.body.text).toBe(templateExplanation(t));
  });

  it("refuses past dates and bad bodies without calling the model", async () => {
    const unused = fakeGemini();
    expect((await explain({ newDate: "2026-11-06" }, unused.client)).body.error.code).toBe("in_past");
    expect((await explain({}, unused.client)).status).toBe(400);
    expect(unused.generateWithFallback).not.toHaveBeenCalled();
  });
});
