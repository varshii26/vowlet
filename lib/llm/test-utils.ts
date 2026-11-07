import type { Content } from "@google/genai";
import { vi } from "vitest";
import type { GeminiClient, GenerateResult, LlmUsage } from "@/lib/llm/gemini";

/** A model reply as `generateWithFallback` returns it. Objects are sent as JSON text. */
export function modelAnswer(
  body: unknown,
  model = "m1",
  usage: LlmUsage = { inputTokens: 100, outputTokens: 50, thinkingTokens: 10 },
): GenerateResult {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { text, functionCalls: [], content: { role: "model", parts: [{ text }] }, usage, model, ms: 5, rateLimitWaits: 0 };
}

/**
 * A model reply that asks for tools. The content carries a thought signature, as
 * Gemini 3 sends, so tests can check the loop hands the turn back unchanged.
 */
export function modelCalls(
  calls: Array<{ name: string; args?: Record<string, unknown> }>,
  model = "m1",
  usage: LlmUsage = { inputTokens: 100, outputTokens: 20, thinkingTokens: 5 },
): GenerateResult {
  const functionCalls = calls.map((c) => ({ name: c.name, args: c.args ?? {} }));
  return {
    text: "",
    functionCalls,
    content: {
      role: "model",
      parts: functionCalls.map((fc, i) => ({ functionCall: fc, ...(i === 0 ? { thoughtSignature: "sig-1" } : {}) })),
    },
    usage,
    model,
    ms: 5,
    rateLimitWaits: 0,
  };
}

export type RecordedRequest = { models: string[]; contents: Content[]; config: Record<string, unknown> };

/** A fake Gemini client that plays back results in order and records each request. */
export function fakeGemini(...steps: Array<GenerateResult | Error>) {
  const requests: RecordedRequest[] = [];
  const generateWithFallback = vi.fn(async (models: string[], request: { contents: Content[]; config?: Record<string, unknown> }) => {
    requests.push({ models, contents: structuredClone(request.contents), config: request.config ?? {} });
    const step = steps.shift();
    if (!step) throw new Error("script ran out");
    if (step instanceof Error) throw step;
    return step;
  });
  return { client: { generate: vi.fn(), generateWithFallback } as unknown as GeminiClient, requests, generateWithFallback };
}
