import { z } from "zod";
import type { ExtractionScore } from "@/evals/score";

/**
 * The latest full `npm run eval`, as evals/results.json. The run writes it, and a
 * test checks the README's numbers against it, so they are never typed by hand. Only a full run over every sample contract with no failures writes
 * the file: a partial or broken run would understate or overstate the result.
 */
/** "100%", "98.5%": one decimal, none when it's whole. */
export function formatPercent(share: number): string {
  const tenths = Math.round(share * 1000) / 10;
  return `${Number.isInteger(tenths) ? tenths.toFixed(0) : tenths.toFixed(1)}%`;
}

export const evalResultsSchema = z.object({
  /** Share of fields extracted exactly right, 0 to 1. */
  accuracy: z.number().min(0).max(1),
  correct: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  contracts: z.number().int().positive(),
  /** Average share of each contract's quotes found word for word in its PDF, 0 to 1. */
  quoteRate: z.number().min(0).max(1),
  /** Models that answered, in order of first use. */
  models: z.array(z.string()).min(1),
  /** `YYYY-MM-DD` the run finished (UTC). */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type EvalResults = z.infer<typeof evalResultsSchema>;

export type ScoredRun = { score: ExtractionScore; model: string };

/** The results of a complete run, from each contract's score and the model that read it. */
export function buildResults(runs: ScoredRun[], finished: Date): EvalResults {
  const correct = runs.reduce((sum, r) => sum + r.score.correct, 0);
  const total = runs.reduce((sum, r) => sum + r.score.total, 0);
  return evalResultsSchema.parse({
    accuracy: total === 0 ? 0 : correct / total,
    correct,
    total,
    contracts: runs.length,
    quoteRate: runs.length === 0 ? 0 : runs.reduce((sum, r) => sum + r.score.quoteRate, 0) / runs.length,
    models: [...new Set(runs.map((r) => r.model))],
    date: finished.toISOString().slice(0, 10),
  });
}

export const resultsJson = (results: EvalResults) => `${JSON.stringify(results, null, 2)}\n`;
