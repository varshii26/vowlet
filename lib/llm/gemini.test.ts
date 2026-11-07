import { ApiError, type GenerateContentResponse } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import {
  LlmError,
  classifyError,
  createGeminiClient,
  parseRetryDelayMs,
  type GenAiPort,
  type GenerateRequest,
} from "@/lib/llm/gemini";

const reply = (text: string, extra: Partial<GenerateContentResponse> = {}) =>
  ({
    text,
    functionCalls: undefined,
    candidates: [{ content: { role: "model", parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 2 },
    ...extra,
  }) as unknown as GenerateContentResponse;

const apiError = (status: number, message: string) => new ApiError({ message, status });
const quota429 = (metric = "GenerateRequestsPerMinutePerProjectPerModel-FreeTier", delay = "27s") =>
  apiError(429, `RESOURCE_EXHAUSTED ${metric} "retryDelay": "${delay}"`);

/** A fake SDK that plays back a script of results, one per call. */
function script(...steps: Array<GenerateContentResponse | Error>) {
  const calls: GenerateRequest[] = [];
  const genai: GenAiPort = {
    models: {
      generateContent: vi.fn(async (params: GenerateRequest) => {
        calls.push(params);
        const step = steps.shift();
        if (!step) throw new Error("script ran out");
        if (step instanceof Error) throw step;
        return step;
      }),
    },
  };
  return { genai, calls };
}

const ask: GenerateRequest = { model: "m1", contents: [{ role: "user", parts: [{ text: "hi" }] }] };
const noSleep = async (ms: number): Promise<void> => {
  expect(ms).toBeGreaterThanOrEqual(0); // never actually waits in tests
};

describe("parseRetryDelayMs", () => {
  it("reads both ways PayPal-style hints appear", () => {
    expect(parseRetryDelayMs("Please retry in 27.5s.")).toBe(27_500);
    expect(parseRetryDelayMs('{"retryDelay": "34s"}')).toBe(34_000);
    expect(parseRetryDelayMs("something else")).toBeNull();
  });
});

describe("classifyError", () => {
  it("separates a per-minute limit from a daily one", () => {
    expect(classifyError(quota429(), "m").code).toBe("rate_limited");
    expect(classifyError(quota429("GenerateRequestsPerDayPerProjectPerModel-FreeTier"), "m").code).toBe("daily_quota");
  });

  it("maps capacity, timeout and bad-request errors", () => {
    expect(classifyError(apiError(503, "UNAVAILABLE"), "m").code).toBe("overloaded");
    expect(classifyError(apiError(500, "boom"), "m").code).toBe("overloaded");
    expect(classifyError(Object.assign(new Error("aborted"), { name: "TimeoutError" }), "m").code).toBe("timeout");
    expect(classifyError(apiError(400, "bad schema"), "m").code).toBe("bad_request");
    expect(classifyError(apiError(404, "no such model"), "m").code).toBe("bad_request");
  });

  it("never echoes the raw error body, which can quote the request", () => {
    const e = classifyError(apiError(400, "your prompt: SECRET CONTRACT TEXT"), "m");
    expect(e.message).not.toContain("SECRET");
  });

  it("passes an LlmError through unchanged", () => {
    const original = new LlmError("x", "empty", "m");
    expect(classifyError(original, "other")).toBe(original);
  });
});

describe("generate", () => {
  it("returns the text, the model turn, usage and timing", async () => {
    const { genai } = script(reply("hello"));
    const result = await createGeminiClient({ genai }).generate(ask);
    expect(result).toMatchObject({
      text: "hello",
      model: "m1",
      functionCalls: [],
      usage: { inputTokens: 10, outputTokens: 5, thinkingTokens: 2, cachedTokens: 0 },
      rateLimitWaits: 0,
    });
    expect(result.content.parts?.[0]).toEqual({ text: "hello" });
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  it("reports how much of the prompt Gemini served from its cache", async () => {
    const { genai } = script(reply("hello", { usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 5, cachedContentTokenCount: 2048 } }));
    expect((await createGeminiClient({ genai }).generate(ask)).usage).toEqual({ inputTokens: 3000, outputTokens: 5, thinkingTokens: 0, cachedTokens: 2048 });
  });

  it("returns function calls, with the model's turn untouched for the history", async () => {
    const content = { role: "model", parts: [{ functionCall: { name: "lookup", args: { q: 1 } }, thoughtSignature: "sig" }] };
    const { genai } = script({ text: undefined, functionCalls: [{ name: "lookup", args: { q: 1 } }], candidates: [{ content }] } as unknown as GenerateContentResponse);
    const result = await createGeminiClient({ genai }).generate(ask);
    expect(result.functionCalls).toEqual([{ name: "lookup", args: { q: 1 } }]);
    expect(result.content).toBe(content);
  });

  it("always sets a timeout, and keeps the caller's other config", async () => {
    const { genai, calls } = script(reply("ok"));
    await createGeminiClient({ genai, timeoutMs: 1234 }).generate({ ...ask, config: { temperature: 0 } });
    expect(calls[0].config).toMatchObject({ temperature: 0, httpOptions: { timeout: 1234 } });
  });

  it("waits out a per-minute limit for as long as the hint says, then succeeds", async () => {
    const { genai } = script(quota429(undefined, "27s"), reply("after the wait"));
    const sleep = vi.fn(noSleep);
    const onRateLimit = vi.fn();
    const result = await createGeminiClient({ genai, sleep, onRateLimit }).generate(ask);

    expect(result.text).toBe("after the wait");
    expect(result.rateLimitWaits).toBe(1);
    expect(sleep).toHaveBeenCalledWith(27_000);
    expect(onRateLimit).toHaveBeenCalledWith({ model: "m1", waitMs: 27_000 });
  });

  it("gives up straight away when the hint asks for longer than it is willing to wait", async () => {
    const { genai } = script(quota429(undefined, "300s"));
    const sleep = vi.fn(noSleep);
    await expect(createGeminiClient({ genai, sleep, maxWaitMs: 65_000 }).generate(ask)).rejects.toMatchObject({ code: "rate_limited" });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not wait for a spent daily quota", async () => {
    const { genai } = script(quota429("GenerateRequestsPerDayPerProjectPerModel-FreeTier"));
    const sleep = vi.fn(noSleep);
    await expect(createGeminiClient({ genai, sleep }).generate(ask)).rejects.toMatchObject({ code: "daily_quota" });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a capacity error with growing waits, then gives up after maxRetries", async () => {
    const { genai } = script(apiError(503, "UNAVAILABLE"), apiError(503, "UNAVAILABLE"), apiError(503, "UNAVAILABLE"));
    const sleep = vi.fn(noSleep);
    await expect(createGeminiClient({ genai, sleep, maxRetries: 2 }).generate(ask)).rejects.toMatchObject({ code: "overloaded" });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 4000]);
  });

  it("retries a timeout", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const { genai } = script(timeout, reply("second try"));
    expect((await createGeminiClient({ genai, sleep: noSleep }).generate(ask)).text).toBe("second try");
  });

  it("does not retry a request that was rejected", async () => {
    const { genai } = script(apiError(400, "bad"), reply("never reached"));
    await expect(createGeminiClient({ genai, sleep: noSleep }).generate(ask)).rejects.toMatchObject({ code: "bad_request" });
    expect(genai.models.generateContent).toHaveBeenCalledTimes(1);
  });

  it("treats an empty answer as an error rather than returning nothing", async () => {
    const { genai } = script({ text: "", candidates: [{ content: { role: "model", parts: [] } }] } as unknown as GenerateContentResponse);
    await expect(createGeminiClient({ genai, maxRetries: 0 }).generate(ask)).rejects.toMatchObject({ code: "empty" });
  });

  it("reports a missing key clearly", async () => {
    const original = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      await expect(createGeminiClient().generate(ask)).rejects.toMatchObject({ code: "no_key" });
    } finally {
      if (original !== undefined) process.env.GEMINI_API_KEY = original;
    }
  });
});

describe("generateWithFallback", () => {
  const req = { contents: ask.contents };

  it("uses the first model when it works", async () => {
    const { genai, calls } = script(reply("from first"));
    const result = await createGeminiClient({ genai }).generateWithFallback(["a", "b"], req);
    expect(result).toMatchObject({ text: "from first", model: "a" });
    expect(calls.map((c) => c.model)).toEqual(["a"]);
  });

  it("moves to the next model when the first is out of daily quota", async () => {
    const { genai, calls } = script(quota429("GenerateRequestsPerDayPerProjectPerModel-FreeTier"), reply("from second"));
    const result = await createGeminiClient({ genai, sleep: noSleep }).generateWithFallback(["a", "b"], req);
    expect(result).toMatchObject({ text: "from second", model: "b" });
    expect(calls.map((c) => c.model)).toEqual(["a", "b"]);
  });

  it("moves on after a model keeps timing out", async () => {
    const timeout = () => Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const { genai } = script(timeout(), timeout(), reply("from b"));
    const result = await createGeminiClient({ genai, sleep: noSleep, maxRetries: 1 }).generateWithFallback(["a", "b"], req);
    expect(result.model).toBe("b");
  });

  it("stops at a request error instead of trying every model with the same bad request", async () => {
    const { genai, calls } = script(apiError(400, "bad schema"), reply("never"));
    await expect(createGeminiClient({ genai }).generateWithFallback(["a", "b"], req)).rejects.toMatchObject({ code: "bad_request" });
    expect(calls).toHaveLength(1);
  });

  it("reports every failure when no model answers", async () => {
    const { genai } = script(
      quota429("GenerateRequestsPerDayPerProjectPerModel-FreeTier"),
      quota429("GenerateRequestsPerDayPerProjectPerModel-FreeTier"),
    );
    const failure = await createGeminiClient({ genai }).generateWithFallback(["a", "b"], req).catch((e) => e);
    expect(failure).toBeInstanceOf(LlmError);
    expect(failure.message).toContain("a:");
    expect(failure.message).toContain("b:");
    expect(failure.code).toBe("daily_quota");
  });

  it("needs at least one model", async () => {
    await expect(createGeminiClient({ genai: script().genai }).generateWithFallback([], req)).rejects.toMatchObject({ code: "bad_request" });
  });
});
