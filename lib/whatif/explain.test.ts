import { describe, expect, it } from "vitest";
import { LlmError } from "@/lib/llm/gemini";
import { fakeGemini, modelAnswer } from "@/lib/llm/test-utils";
import { explainWhatIf, templateExplanation, unbackedNumbers } from "@/lib/whatif/explain";
import type { WhatIfPreview, WhatIfRow } from "@/lib/whatif/service";

const row = (over: Partial<WhatIfRow>): WhatIfRow => ({
  vendorId: "v",
  kind: "free",
  vendorName: "Vendor",
  costCents: 0,
  reason: "Free with 120 days' notice (needs at least 60).",
  clauseId: "c",
  citation: "Vendor contract, page 2",
  clause: { text: "Date changes are free with 60 days' notice.", page: 2 },
  ...over,
});

const preview: WhatIfPreview = {
  currentDate: "2027-04-17",
  newDate: "2027-06-12",
  shiftDays: 56,
  totalCents: 175_000,
  rows: [
    row({ vendorId: "a", kind: "fee", vendorName: "Grand Oak Estate", costCents: 150_000, reason: "$1,500 (10% of the contract) with 56 days' notice." }),
    row({ vendorId: "b", kind: "fee", vendorName: "Bloom & Vine", costCents: 25_000, reason: "$250 (a $250 flat fee) with 56 days' notice." }),
    row({ vendorId: "c", vendorName: "Lens & Light" }),
    row({ vendorId: "d", kind: "check", vendorName: "DJ Nova", reason: "No date-change terms apply; check the contract.", clauseId: null, citation: null, clause: null }),
  ],
};

const deps = (client: ReturnType<typeof fakeGemini>["client"]) => ({ client, models: ["m1"], configured: true });

describe("unbackedNumbers", () => {
  it("accepts amounts, counts and dates that are in the preview", () => {
    const text = "Moving to June 12, 2027 (56 days later) costs $1,750 from 2 vendors: Grand Oak Estate charges $1,500 (10%) and Bloom & Vine $250.00; 1 contract needs checking.";
    expect(unbackedNumbers(text, preview)).toEqual([]);
  });

  it("flags an amount that isn't in the table, even off by a cent", () => {
    expect(unbackedNumbers("It costs $1,750.01 in total.", preview)).toEqual(["$1,750.01"]);
    expect(unbackedNumbers("Grand Oak charges $1,250.", preview)).toEqual(["$1,250"]);
  });

  it("flags model arithmetic the table doesn't contain", () => {
    // $1,500 - $250 = $1,250 is not something the table says.
    expect(unbackedNumbers("Grand Oak costs $1,250 more than Bloom & Vine.", preview)).toEqual(["$1,250"]);
    expect(unbackedNumbers("That is about 8 weeks later.", preview)).toEqual(["8"]);
  });

  it("flags abbreviated amounts, which can't be checked to the cent", () => {
    expect(unbackedNumbers("About $1.75k in fees.", preview)).toEqual(["$1.75k"]);
  });
});

describe("templateExplanation", () => {
  it("states the total, the largest fee and what to check, all from the preview", () => {
    const text = templateExplanation(preview);
    expect(text).toBe(
      "Moving the wedding to June 12, 2027 costs $1,750 in date-change fees from 2 vendors, the largest being Grand Oak Estate at $1,500. 1 vendor won't charge for the move. 1 contract has no date-change terms, so check it directly.",
    );
    expect(unbackedNumbers(text, preview)).toEqual([]);
  });

  it("says when the move is free", () => {
    const free = { ...preview, totalCents: 0, rows: [row({})] };
    expect(templateExplanation(free)).toBe("Moving the wedding to June 12, 2027 costs nothing in date-change fees. 1 vendor won't charge for the move.");
  });
});

describe("explainWhatIf", () => {
  it("uses the model's summary when every number checks out", async () => {
    const fake = fakeGemini(modelAnswer("Moving to June 12 costs $1,750, mostly Grand Oak Estate's $1,500 fee. Check DJ Nova's contract."));
    const result = await explainWhatIf(preview, deps(fake.client));
    expect(result).toEqual({ source: "model", text: "Moving to June 12 costs $1,750, mostly Grand Oak Estate's $1,500 fee. Check DJ Nova's contract." });

    // The model gets the computed table, with amounts already formatted, and is told not to do arithmetic.
    const sent = JSON.stringify(fake.requests[0].contents);
    expect(sent).toContain("$1,750");
    expect(sent).toContain("Grand Oak Estate");
    expect(String(fake.requests[0].config.systemInstruction)).toMatch(/Never add, subtract/);
  });

  it("falls back to the template when the model writes a number the table doesn't back", async () => {
    const fake = fakeGemini(modelAnswer("Moving costs $1,800 in total."));
    expect(await explainWhatIf(preview, deps(fake.client))).toEqual({ source: "template", text: templateExplanation(preview) });
  });

  it("falls back to the template when the model fails or is not configured", async () => {
    const fake = fakeGemini(new LlmError("down", "overloaded"));
    expect((await explainWhatIf(preview, deps(fake.client))).source).toBe("template");

    const unused = fakeGemini();
    expect((await explainWhatIf(preview, { ...deps(unused.client), configured: false })).source).toBe("template");
    expect(unused.generateWithFallback).not.toHaveBeenCalled();
  });

  it("falls back when the summary is too long to be a summary", async () => {
    const fake = fakeGemini(modelAnswer("Grand Oak Estate. ".repeat(60)));
    expect((await explainWhatIf(preview, deps(fake.client))).source).toBe("template");
  });
});
