import { describe, expect, it } from "vitest";
import { DEFAULT_MODELS, modelChain } from "@/lib/llm/config";

describe("modelChain", () => {
  it("defaults to the benchmarked models, fastest first", () => {
    expect(modelChain("extraction", {})).toEqual(["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash"]);
    expect(modelChain("agent", {})).toEqual(["gemini-3.5-flash-lite", "gemini-3.5-flash"]);
  });

  it("keeps the model that fails the tool-use loop out of the agent's chain", () => {
    expect(modelChain("agent", {})).not.toContain("gemini-3.1-flash-lite");
    expect(modelChain("extraction", {})).toContain("gemini-3.1-flash-lite");
  });

  it("uses GEMINI_MODELS for either task, trimming spaces and dropping blanks", () => {
    expect(modelChain("extraction", { GEMINI_MODELS: " a , b ,, c " })).toEqual(["a", "b", "c"]);
    expect(modelChain("agent", { GEMINI_MODELS: "a,b" })).toEqual(["a", "b"]);
  });

  it("falls back to the defaults for an empty or blank value", () => {
    expect(modelChain("agent", { GEMINI_MODELS: "" })).toEqual([...DEFAULT_MODELS.agent]);
    expect(modelChain("extraction", { GEMINI_MODELS: " , " })).toEqual([...DEFAULT_MODELS.extraction]);
  });

  it("removes duplicates but keeps the order", () => {
    expect(modelChain("agent", { GEMINI_MODELS: "a,b,a,c,b" })).toEqual(["a", "b", "c"]);
  });

  it("returns a copy, so callers cannot change the defaults", () => {
    modelChain("agent", {}).push("oops");
    expect(modelChain("agent", {})).toHaveLength(2);
  });
});
