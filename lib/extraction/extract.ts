import type { Content } from "@google/genai";
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_USER_PROMPT } from "@/lib/extraction/prompt";
import { contractExtractionJsonSchema, contractExtractionSchema } from "@/lib/extraction/schema";
import { toTerms } from "@/lib/extraction/terms";
import { verifyTerms, type VerifiedTerms } from "@/lib/extraction/verify";
import { LlmError, type GeminiClient, type LlmUsage } from "@/lib/llm/gemini";

export type ExtractionOutcome =
  | { ok: true; terms: VerifiedTerms; model: string; attempts: number; usage: LlmUsage; ms: number }
  | { ok: false; errors: string[]; model: string | null; attempts: number; usage: LlmUsage; ms: number };

export type ExtractInput = {
  client: GeminiClient;
  /** Models to try, in order. The first that answers is used. */
  models: string[];
  /** The PDF's bytes. */
  pdf: Uint8Array;
  /** The PDF's text, one entry per page, for checking the quotes. */
  pages: readonly string[];
};

const ZERO: LlmUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
const add = (a: LlmUsage, b: LlmUsage): LlmUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  thinkingTokens: a.thinkingTokens + b.thinkingTokens,
});

/**
 * Read a contract with the model, then check everything in code: the output
 * must match the schema, amounts and dates must be well formed, and every quote
 * must really appear in the PDF. One retry is allowed, and it tells the model
 * what was wrong with its first answer.
 */
export async function extractContract({ client, models, pdf, pages }: ExtractInput): Promise<ExtractionOutcome> {
  const started = Date.now();
  const document = { inlineData: { mimeType: "application/pdf", data: Buffer.from(pdf).toString("base64") } };
  const contents: Content[] = [{ role: "user", parts: [document, { text: EXTRACTION_USER_PROMPT }] }];
  const config = {
    systemInstruction: EXTRACTION_SYSTEM_PROMPT,
    responseMimeType: "application/json",
    responseJsonSchema: contractExtractionJsonSchema(),
    temperature: 0,
  };

  let usage = ZERO;
  let model: string | null = null;
  let errors: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    let answer;
    try {
      // After the first answer, stay with the model that gave it.
      answer = await client.generateWithFallback(model ? [model] : models, { contents, config });
    } catch (error) {
      const message = error instanceof LlmError ? error.message : "the model could not be reached";
      return { ok: false, errors: [message], model, attempts: attempt, usage, ms: Date.now() - started };
    }
    model = answer.model;
    usage = add(usage, answer.usage);

    const parsed = parseAnswer(answer.text);
    if (parsed.ok) {
      const terms = toTerms(parsed.extraction);
      if (terms.ok) {
        return { ok: true, terms: verifyTerms(terms.terms, pages), model, attempts: attempt, usage, ms: Date.now() - started };
      }
      errors = terms.errors;
    } else {
      errors = parsed.errors;
    }

    // Retry once, telling the model exactly what to fix.
    contents.push(answer.content, {
      role: "user",
      parts: [{ text: `Your answer had problems. Fix them and return the full corrected JSON:\n- ${errors.join("\n- ")}` }],
    });
  }

  return { ok: false, errors, model, attempts: 2, usage, ms: Date.now() - started };
}

function parseAnswer(text: string): { ok: true; extraction: ReturnType<typeof contractExtractionSchema.parse> } | { ok: false; errors: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["the answer was not valid JSON"] };
  }
  const result = contractExtractionSchema.safeParse(json);
  if (result.success) return { ok: true, extraction: result.data };
  return {
    ok: false,
    errors: result.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "answer"}: ${i.message}`),
  };
}
