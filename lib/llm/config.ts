/**
 * Which Gemini models to use for each job, in order. The first that answers
 * wins; the next is tried when one is out of free daily quota, overloaded or
 * timing out.
 *
 * Chosen with `npm run llm:bench` on a free AI Studio key (results in the README):
 * - gemini-3.5-flash-lite: fastest, 100% on extraction and on both tool-use tests,
 *   twice in a row.
 * - gemini-3.1-flash-lite: also exact on extraction, but it fails the tool-use
 *   loop every time, so it is a fallback for extraction only.
 * - gemini-3.5-flash: accurate at both, but slow, and it hits the free rate limit
 *   within a few requests: a last resort.
 * Set GEMINI_MODELS (comma separated) to override both lists when availability changes.
 */
export type LlmTask = "extraction" | "agent";

export const DEFAULT_MODELS: Record<LlmTask, readonly string[]> = {
  extraction: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash"],
  agent: ["gemini-3.5-flash-lite", "gemini-3.5-flash"],
};

export function modelChain(task: LlmTask, env: Record<string, string | undefined> = process.env): string[] {
  const configured = (env.GEMINI_MODELS ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter((model) => model.length > 0);
  const chain = configured.length > 0 ? configured : [...DEFAULT_MODELS[task]];
  return [...new Set(chain)];
}
