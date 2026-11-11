import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildResults, evalResultsSchema } from "@/evals/results";
import type { ExtractionScore } from "@/evals/score";
import { formatPercent } from "@/components/ui/AccuracyBadge";

const score = (correct: number, total: number, quoteRate: number) => ({ correct, total, quoteRate }) as ExtractionScore;

describe("buildResults", () => {
  it("adds up fields across contracts, averages quote rates, and lists the models that answered", () => {
    const results = buildResults(
      [
        { score: score(5, 5, 1), model: "m1" },
        { score: score(3, 4, 0.5), model: "m2" },
        { score: score(4, 4, 1), model: "m1" },
      ],
      new Date("2026-11-11T18:00:00.000Z"),
    );
    expect(results).toEqual({ accuracy: 12 / 13, correct: 12, total: 13, contracts: 3, quoteRate: 2.5 / 3, models: ["m1", "m2"], date: "2026-11-11" });
  });
});

describe("evals/results.json (written by the last full npm run eval)", () => {
  const file = JSON.parse(readFileSync(path.join(process.cwd(), "evals", "results.json"), "utf8"));

  it("is valid and covers every sample contract", () => {
    const results = evalResultsSchema.parse(file);
    const expected = readFileSync(path.join(process.cwd(), "evals", "results.json"), "utf8");
    expect(expected.endsWith("\n")).toBe(true);
    expect(results.contracts).toBe(14);
  });

  it("matches the numbers quoted in the README, so neither drifts from the other", () => {
    const results = evalResultsSchema.parse(file);
    const readme = readFileSync(path.join(process.cwd(), "README.md"), "utf8");
    const line = `Extraction accuracy: ${formatPercent(results.accuracy)} (${results.correct}/${results.total} fields) on ${results.contracts} contracts`;
    expect(readme).toContain(line);
    expect(readme).toContain(`${formatPercent(results.quoteRate)} of quotes verified`);
  });
});
