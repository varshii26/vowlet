import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { called, citesAClause, expectFrom, mentions, mentionsAmount, noPaymentChanged, proposed, SMOKE_CASES, toolCallsFrom, type RunRecord } from "@/evals/agent/smoke";
import { TODAY } from "@/lib/agent/tools/test-utils";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase } from "@/lib/test-utils/db";

const record = (over: Partial<RunRecord> = {}): RunRecord => ({
  answer: "",
  tools: [],
  proposals: [],
  sources: [],
  paymentsBefore: new Map([["p1", "scheduled"]]),
  paymentsAfter: new Map([["p1", "scheduled"]]),
  ...over,
});

describe("mentionsAmount", () => {
  it.each([
    ["The total is $1,330.", true],
    ["The total is **$1,330**.", true],
    ["The total is $1,330.00 in all.", true],
    ["The total is $11,330.", false],
    ["The total is $1,3300.", false],
    ["The total is $1,330,000.", false],
    ["Nothing about money.", false],
  ])("%j -> %s", (answer, expected) => {
    expect(mentionsAmount(answer, "$1,330")).toBe(expected);
  });
});

describe("toolCallsFrom", () => {
  it("pairs each call with its result, including failed ones", () => {
    const calls = toolCallsFrom([
      { role: "user", parts: [{ text: "q" }] },
      { role: "model", parts: [{ functionCall: { name: "get_wedding", args: {} } }, { functionCall: { name: "read_clause", args: { vendorId: "x" } } }] },
      { role: "user", parts: [{ functionResponse: { name: "get_wedding", response: { output: { a: 1 } } } }, { functionResponse: { name: "read_clause", response: { error: "nope" } } }] },
    ]);
    expect(calls).toEqual([
      { name: "get_wedding", args: {}, output: { a: 1 }, ok: true },
      { name: "read_clause", args: { vendorId: "x" }, output: undefined, ok: false },
    ]);
  });
});

describe("checks", () => {
  it("called: passes only for a successful call with matching arguments", () => {
    const check = called("compute_date_change_cost", (a) => a.newDate === "2027-06-12");
    expect(check(record({ tools: [{ name: "compute_date_change_cost", args: { newDate: "2027-06-12" }, output: {}, ok: true }] }))).toBeNull();
    expect(check(record({ tools: [{ name: "compute_date_change_cost", args: { newDate: "2027-06-13" }, output: {}, ok: true }] }))).toMatch(/did not call/);
    expect(check(record({ tools: [{ name: "compute_date_change_cost", args: { newDate: "2027-06-12" }, output: undefined, ok: false }] }))).toMatch(/did not call/);
  });

  it("mentions and proposed explain what is missing", () => {
    expect(mentions("$800", "the refund")(record({ answer: "You get $800 back." }))).toBeNull();
    expect(mentions("$800", "the refund")(record({ answer: "You get $80 back." }))).toBe("answer does not state the refund ($800)");
    const proposal = { id: "x", kind: "reschedule", status: "pending", summary: "", clauseId: null, payload: { newDate: "2027-06-12" } };
    expect(proposed("reschedule", (p) => p.newDate === "2027-06-12")(record({ proposals: [proposal] }))).toBeNull();
    expect(proposed("refund_request")(record({ proposals: [proposal] }))).toMatch(/no refund_request proposal \(got: reschedule\)/);
  });

  it("citesAClause wants a citation the tools returned, not just any", () => {
    const sources = [{ label: "Grand Oak Estate contract, page 2", vendorId: "v", clauseId: "c", page: 2, text: null }];
    expect(citesAClause(record({ answer: "Per Grand Oak Estate contract, page 2.", sources }))).toBeNull();
    expect(citesAClause(record({ answer: "Per Made Up contract, page 2.", sources }))).toMatch(/cites no clause/);
  });

  it("noPaymentChanged catches any status change", () => {
    expect(noPaymentChanged(record())).toBeNull();
    expect(noPaymentChanged(record({ paymentsAfter: new Map([["p1", "paid"]]) }))).toMatch(/1 payment/);
  });
});

describe("the smoke cases", () => {
  let prisma: PrismaClient;
  let cleanup: () => Promise<void>;
  beforeAll(() => {
    ({ prisma, cleanup } = createTestDatabase());
  }, 60_000);
  afterAll(async () => cleanup());
  beforeEach(async () => seedDemo(prisma));

  // The expected values come from the real tools; make sure every case can work them out on the demo data.
  it.each(SMOKE_CASES.map((c) => [c.name, c] as const))("%s: works out its expected values", async (_name, smoke) => {
    const checks = await smoke.checks(expectFrom(prisma, TODAY));
    expect(checks.length).toBeGreaterThan(0);
  });

  it("the cancellation case expects a real refund, not zero", async () => {
    const out = await expectFrom(prisma, TODAY)("compute_refund_owed", { vendorId: "Bloom & Thistle Florals", cancelledBy: "vendor" });
    expect((out.owedBack as { cents: number }).cents).toBeGreaterThan(0);
  });

  it("an agent that does nothing fails every case except the refusal", async () => {
    for (const smoke of SMOKE_CASES) {
      const failures = (await smoke.checks(expectFrom(prisma, TODAY))).map((c) => c(record({ answer: "I don't know." }))).filter(Boolean);
      if (smoke.name === "refuses to move money") expect(failures).toEqual([]);
      else expect(failures.length).toBeGreaterThan(0);
    }
  });
});
