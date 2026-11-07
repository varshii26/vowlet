import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { collectSources, splitCitations, type CitationSource } from "@/lib/agent/sources";
import { ok } from "@/lib/agent/tools/test-utils";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase } from "@/lib/test-utils/db";

const src = (label: string, over: Partial<CitationSource> = {}): CitationSource => ({ label, vendorId: "v1", clauseId: `c-${label}`, page: 2, text: null, ...over });

describe("collectSources", () => {
  it("takes citations with a clause id, inheriting the vendor from the object around them", () => {
    const into = new Map<string, CitationSource>();
    collectSources({ vendorId: "v1", clauses: [{ clauseId: "c1", citation: "Bloom contract, page 2", page: 2, text: "Deposit is non-refundable." }] }, into);
    expect([...into.values()]).toEqual([{ label: "Bloom contract, page 2", vendorId: "v1", clauseId: "c1", page: 2, text: "Deposit is non-refundable." }]);
  });

  it("reads the page from the label when there's no page field, and keeps text found earlier", () => {
    const into = new Map<string, CitationSource>();
    collectSources({ vendorId: "v1", clauses: [{ clauseId: "c1", citation: "Bloom contract, page 3", page: 3, text: "Quoted." }] }, into);
    collectSources({ rows: [{ vendorId: "v1", clauseId: "c1", citation: "Bloom contract, page 3" }] }, into);
    expect(into.get("Bloom contract, page 3")).toMatchObject({ page: 3, text: "Quoted." });
  });

  it("ignores anything without a clause id or a vendor", () => {
    const into = new Map<string, CitationSource>();
    collectSources({ citation: "No vendor contract, page 1", clauseId: "c1" }, into);
    collectSources({ vendorId: "v1", citation: "No clause contract, page 1", clauseId: null }, into);
    collectSources([null, 1, "text", { vendorId: "v1", citation: 5, clauseId: "c" }], into);
    expect(into.size).toBe(0);
  });
});

describe("collectSources on real tool results", () => {
  let prisma: PrismaClient;
  let cleanup: () => Promise<void>;
  beforeAll(async () => {
    ({ prisma, cleanup } = createTestDatabase());
    await seedDemo(prisma);
  }, 60_000);
  afterAll(async () => cleanup());

  it.each([
    ["compute_date_change_cost", { newDate: "2027-06-12" }],
    ["compute_refund_owed", { vendorId: "Bloom & Thistle Florals", cancelledBy: "vendor" }],
    ["get_payment_schedule", { unpaidDueWithinDays: 60 }],
    ["read_clause", { vendorId: "Grand Oak Estate", kind: "cancellation" }],
  ])("%s: every citation points at a real clause of that vendor, on the cited page", async (tool, args) => {
    const into = new Map<string, CitationSource>();
    collectSources(await ok(prisma, tool, args), into);
    expect(into.size).toBeGreaterThan(0);
    for (const s of into.values()) {
      const clause = await prisma.clause.findUniqueOrThrow({ where: { id: s.clauseId }, include: { vendor: true } });
      expect(clause.vendorId).toBe(s.vendorId);
      expect(s.label).toBe(`${clause.vendor.name} contract, page ${clause.page}`);
      expect(s.page).toBe(clause.page);
    }
  });

  it("read_clause also brings the clause text", async () => {
    const into = new Map<string, CitationSource>();
    collectSources(await ok(prisma, "read_clause", { vendorId: "Grand Oak Estate", kind: "cancellation" }), into);
    expect([...into.values()][0].text).toBeTruthy();
  });
});

describe("splitCitations", () => {
  const oak = src("Grand Oak Estate contract, page 2");

  it("finds known citations, in and out of parentheses; a bracketed one becomes the chip alone", () => {
    expect(splitCitations("The fee is $450 (Grand Oak Estate contract, page 2).", [oak])).toEqual(["The fee is $450 ", oak, "."]);
    expect(splitCitations("Fee ( Grand Oak Estate contract, page 2 ) applies.", [oak])).toEqual(["Fee ", oak, " applies."]);
    expect(splitCitations("(See Grand Oak Estate contract, page 2)", [oak])).toEqual(["(See ", oak, ")"]);
    expect(splitCitations("Grand Oak Estate contract, page 2 says so; see Grand Oak Estate contract, page 2.", [oak])).toEqual([oak, " says so; see ", oak, "."]);
  });

  it("leaves a citation no tool returned as plain text", () => {
    expect(splitCitations("See (Made Up Vendor contract, page 9).", [oak])).toEqual(["See (Made Up Vendor contract, page 9)."]);
  });

  it("doesn't match a longer page number", () => {
    expect(splitCitations("See Grand Oak Estate contract, page 23.", [oak])).toEqual(["See Grand Oak Estate contract, page 23."]);
  });

  it("prefers the longer of two overlapping labels", () => {
    const short = src("Oak Estate contract, page 2");
    expect(splitCitations("Per Grand Oak Estate contract, page 2.", [short, oak])).toEqual(["Per ", oak, "."]);
  });

  it("treats labels with regex characters literally", () => {
    const odd = src("A+B (Events) contract, page 1");
    expect(splitCitations("Per A+B (Events) contract, page 1.", [odd])).toEqual(["Per ", odd, "."]);
  });

  it("returns the text unchanged when there are no sources", () => {
    expect(splitCitations("Anything.", [])).toEqual(["Anything."]);
  });
});
