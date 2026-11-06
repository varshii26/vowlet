import { describe, expect, it } from "vitest";
import { extraction, payment } from "@/lib/extraction/fixtures";
import { contractExtractionJsonSchema, contractExtractionSchema } from "@/lib/extraction/schema";

describe("contractExtractionSchema", () => {
  it("accepts a complete extraction", () => {
    expect(contractExtractionSchema.safeParse(extraction()).success).toBe(true);
  });

  it("accepts a contract with no cancellation or date-change terms", () => {
    const none = { found: false, tiers: [], clauseQuote: "", page: 1, confidence: 1 };
    expect(contractExtractionSchema.safeParse(extraction({ cancellation: none, dateChange: none })).success).toBe(true);
  });

  it.each([
    ["confidence above 1", { confidence: 1.5 }],
    ["negative confidence", { confidence: -0.1 }],
    ["page 0", { page: 0 }],
    ["fractional page", { page: 1.5 }],
    ["fractional offset", { offsetDays: -30.5 }],
    ["unknown amount type", { amountType: "stock" }],
    ["unknown anchor", { anchor: "whenever" }],
    ["numeric amount where text is required", { amount: 3000 }],
  ])("rejects a payment with %s", (_name, bad) => {
    const result = contractExtractionSchema.safeParse(extraction({ payments: [payment(bad as never)] }));
    expect(result.success).toBe(false);
  });

  it("rejects a missing section", () => {
    const incomplete: Partial<ReturnType<typeof extraction>> = extraction();
    delete incomplete.cancellation;
    expect(contractExtractionSchema.safeParse(incomplete).success).toBe(false);
  });

  it("rejects a refund percent above 100", () => {
    const bad = extraction();
    bad.cancellation.tiers[0].refundPercent = 150;
    expect(contractExtractionSchema.safeParse(bad).success).toBe(false);
  });
});

describe("contractExtractionJsonSchema", () => {
  const schema = contractExtractionJsonSchema();
  const text = JSON.stringify(schema);

  it("is a plain object schema without the $schema marker the Gemini API rejects", () => {
    expect(schema.type).toBe("object");
    expect(schema).not.toHaveProperty("$schema");
  });

  it("requires every top-level field", () => {
    expect(schema.required).toEqual(["vendorName", "category", "totalAmount", "payments", "cancellation", "dateChange"]);
  });

  it("avoids unions and nulls, which models and JSON Schema dialects handle unevenly", () => {
    expect(text).not.toContain("anyOf");
    expect(text).not.toContain("oneOf");
    expect(text).not.toContain('"null"');
  });

  it("tells the model what each field means", () => {
    expect(text).toContain("verbatim");
    expect(text).toContain("Negative = before");
    expect(text).toContain("below 0.8");
  });

  it("forbids extra fields", () => {
    expect(text).toContain('"additionalProperties":false');
  });
});
