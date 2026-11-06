/**
 * A small wrapper over the Google Gen AI SDK, built for the free tier: every
 * call has a timeout, per-minute limits are waited out (honouring the "retry in
 * N seconds" hint), a spent daily quota fails fast so the caller can switch
 * model, and the models are tried in order until one answers.
 *
 * Server only: the API key must never reach the browser.
 */
import { ApiError, GoogleGenAI, type Content, type GenerateContentConfig } from "@google/genai";

if (typeof window !== "undefined") {
  throw new Error("lib/llm/gemini.ts is server-only; never import it from client components.");
}

export type LlmUsage = { inputTokens: number; outputTokens: number; thinkingTokens: number };

export type FunctionCall = { name: string; args: Record<string, unknown> };

export type GenerateResult = {
  text: string;
  functionCalls: FunctionCall[];
  /** The model's turn exactly as returned. Put it back in the history unchanged: Gemini 3 needs its thought signatures. */
  content: Content;
  usage: LlmUsage;
  model: string;
  ms: number;
  /** Per-minute rate limits waited out before this answer. */
  rateLimitWaits: number;
};

export type LlmErrorCode =
  | "daily_quota" // the free daily limit is spent: switch model or wait until tomorrow
  | "rate_limited" // still limited after retries
  | "overloaded" // 5xx / capacity
  | "timeout"
  | "bad_request" // our request was wrong (schema, model name): retrying will not help
  | "no_key"
  | "empty"; // the model returned nothing usable

export class LlmError extends Error {
  constructor(
    message: string,
    readonly code: LlmErrorCode,
    readonly model: string | null = null,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export type GenerateRequest = {
  model: string;
  contents: Content[];
  config?: GenerateContentConfig;
};

/** The one SDK method we use, so tests can supply a fake. */
export type GenAiPort = {
  models: { generateContent: (params: GenerateRequest) => Promise<import("@google/genai").GenerateContentResponse> };
};

export type GeminiOptions = {
  apiKey?: string;
  genai?: GenAiPort;
  /** Per attempt. Free-tier models can hang, so there is always a limit. */
  timeoutMs?: number;
  /** Retries after a per-minute rate limit, a capacity error or a timeout. */
  maxRetries?: number;
  /** Never wait longer than this for a rate limit to clear. */
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Called each time a rate limit is waited out. */
  onRateLimit?: (info: { model: string; waitMs: number }) => void;
};

/** "retry in 27.5s" or `"retryDelay": "27s"` in an error body, as milliseconds. */
export function parseRetryDelayMs(message: string): number | null {
  const match = /retry in ([\d.]+)\s*s/i.exec(message) ?? /"retryDelay"\s*:\s*"([\d.]+)s"/.exec(message);
  return match ? Math.ceil(Number(match[1]) * 1000) : null;
}

/** Turn an SDK error into ours, deciding what is worth retrying. */
export function classifyError(error: unknown, model: string): LlmError {
  if (error instanceof LlmError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof ApiError ? error.status : undefined;

  if (status === 429 || /RESOURCE_EXHAUSTED/.test(message)) {
    // A per-day limit will not clear by waiting.
    if (/PerDay/i.test(message)) return new LlmError(`${model}: the free daily quota is used up`, "daily_quota", model);
    return new LlmError(`${model}: rate limited`, "rate_limited", model);
  }
  if (status === 503 || status === 500 || status === 504 || /UNAVAILABLE|overloaded/i.test(message)) {
    return new LlmError(`${model}: the model is overloaded or unavailable`, "overloaded", model);
  }
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError" || /timed? ?out/i.test(message))) {
    return new LlmError(`${model}: no answer in time`, "timeout", model);
  }
  if (status === 400 || status === 404 || status === 403) {
    // Never echo the raw body: it can quote parts of the request.
    return new LlmError(`${model}: the request was rejected (HTTP ${status})`, "bad_request", model);
  }
  return new LlmError(`${model}: unexpected error`, "overloaded", model);
}

export function createGeminiClient(options: GeminiOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxRetries = options.maxRetries ?? 3;
  const maxWaitMs = options.maxWaitMs ?? 65_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let genai = options.genai;
  function sdk(): GenAiPort {
    if (!genai) {
      const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
      if (!apiKey) throw new LlmError("GEMINI_API_KEY is not set", "no_key");
      genai = new GoogleGenAI({ apiKey }) as unknown as GenAiPort;
    }
    return genai;
  }

  /** One model, with retries for per-minute limits and transient failures. */
  async function generate(request: GenerateRequest): Promise<GenerateResult> {
    const started = Date.now();
    let rateLimitWaits = 0;

    for (let attempt = 0; ; attempt++) {
      try {
        const response = await sdk().models.generateContent({
          ...request,
          config: { ...request.config, httpOptions: { timeout: timeoutMs, ...request.config?.httpOptions } },
        });
        const content = response.candidates?.[0]?.content;
        // Read the text from the parts: the SDK's `response.text` getter logs a warning whenever
        // the reply also contains function calls. Thought summaries are not part of the answer.
        const text = (content?.parts ?? [])
          .filter((part) => typeof part.text === "string" && !part.thought)
          .map((part) => part.text)
          .join("");
        const functionCalls = (response.functionCalls ?? []).map((c) => ({ name: c.name ?? "", args: (c.args ?? {}) as Record<string, unknown> }));
        if (!content || (text === "" && functionCalls.length === 0)) {
          throw new LlmError(`${request.model}: the model returned nothing`, "empty", request.model);
        }
        const u = response.usageMetadata;
        return {
          text,
          functionCalls,
          content,
          usage: {
            inputTokens: u?.promptTokenCount ?? 0,
            outputTokens: u?.candidatesTokenCount ?? 0,
            thinkingTokens: u?.thoughtsTokenCount ?? 0,
          },
          model: request.model,
          ms: Date.now() - started,
          rateLimitWaits,
        };
      } catch (raw) {
        const error = classifyError(raw, request.model);
        const retryable = error.code === "rate_limited" || error.code === "overloaded" || error.code === "timeout";
        if (!retryable || attempt >= maxRetries) throw error;

        const hinted = parseRetryDelayMs(raw instanceof Error ? raw.message : "");
        const waitMs = Math.min(hinted ?? 2000 * 2 ** attempt, maxWaitMs);
        if (error.code === "rate_limited") {
          // If the hint says to wait longer than we are willing to, give up now.
          if (hinted !== null && hinted > maxWaitMs) throw error;
          rateLimitWaits++;
          options.onRateLimit?.({ model: request.model, waitMs });
        }
        await sleep(waitMs);
      }
    }
  }

  /**
   * Try each model in order. A model that is out of daily quota, overloaded or
   * timing out is skipped for the next one; a request error is ours to fix, so
   * it stops the chain.
   */
  async function generateWithFallback(models: string[], request: Omit<GenerateRequest, "model">): Promise<GenerateResult> {
    if (models.length === 0) throw new LlmError("no models configured", "bad_request");
    const failures: LlmError[] = [];
    for (const model of models) {
      try {
        return await generate({ ...request, model });
      } catch (error) {
        const e = error instanceof LlmError ? error : classifyError(error, model);
        if (e.code === "bad_request" || e.code === "no_key") throw e;
        failures.push(e);
      }
    }
    throw new LlmError(`every model failed: ${failures.map((f) => f.message).join("; ")}`, failures[failures.length - 1].code);
  }

  return { generate, generateWithFallback };
}

export type GeminiClient = ReturnType<typeof createGeminiClient>;
