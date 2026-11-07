import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { MAX_ITERATIONS, friendlyLlmMessage, runAgent, type AgentEvent, type AgentRun } from "@/lib/agent/loop";
import { TODAY } from "@/lib/agent/tools/test-utils";
import { LlmError, type GeminiClient } from "@/lib/llm/gemini";
import { fakeGemini, modelAnswer, modelCalls } from "@/lib/llm/test-utils";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase } from "@/lib/test-utils/db";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDatabase());
}, 60_000);
afterAll(async () => cleanup());
beforeEach(async () => seedDemo(prisma));

const MODELS = ["m1", "m2"];

async function collect(client: GeminiClient, over: Partial<AgentRun> = {}): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of runAgent({ question: "What do we owe?", client, models: MODELS, prisma, today: TODAY, ...over })) events.push(event);
  return events;
}

type Answer = Extract<AgentEvent, { type: "answer" }>;
const answerOf = (events: AgentEvent[]) => events.find((e): e is Answer => e.type === "answer")!;
const types = (events: AgentEvent[]) => events.map((e) => e.type);

const call = (name: string, args: Record<string, unknown> = {}) => modelCalls([{ name, args }]);

describe("a question with no tools", () => {
  it("returns the model's answer", async () => {
    const { client } = fakeGemini(modelAnswer("You owe nothing today."));
    const events = await collect(client);

    expect(types(events)).toEqual(["thinking", "answer"]);
    expect(answerOf(events)).toMatchObject({ text: "You owe nothing today.", proposals: [], model: "m1", iterations: 1, truncated: false });
  });

  it("sends the system prompt with today's date, the seven tools and temperature 0", async () => {
    const { client, requests } = fakeGemini(modelAnswer("ok"));
    await collect(client);

    const config = requests[0].config as { systemInstruction: string; temperature: number; tools: Array<{ functionDeclarations: Array<{ name: string }> }> };
    expect(config.systemInstruction).toContain("Today is 2026-11-07");
    expect(config.systemInstruction).toContain("Never calculate");
    expect(config.temperature).toBe(0);
    expect(config.tools[0].functionDeclarations.map((d) => d.name)).toEqual([
      "get_wedding",
      "get_vendors",
      "get_payment_schedule",
      "read_clause",
      "compute_date_change_cost",
      "compute_refund_owed",
      "propose_action",
    ]);
    expect(requests[0].models).toEqual(MODELS);
  });

  it("puts earlier turns of the conversation before the new question", async () => {
    const { client, requests } = fakeGemini(modelAnswer("ok"));
    await collect(client, {
      question: "And the florist?",
      history: [
        { role: "user", text: "What do we owe?" },
        { role: "assistant", text: "You owe $500 soon." },
      ],
    });
    expect(requests[0].contents).toEqual([
      { role: "user", parts: [{ text: "What do we owe?" }] },
      { role: "model", parts: [{ text: "You owe $500 soon." }] },
      { role: "user", parts: [{ text: "And the florist?" }] },
    ]);
  });

  it("adds up the tokens used", async () => {
    const { client } = fakeGemini(call("get_wedding"), modelAnswer("done"));
    expect(answerOf(await collect(client)).usage).toEqual({ inputTokens: 200, outputTokens: 70, thinkingTokens: 15, cachedTokens: 0 });
  });
});

describe("the tool loop", () => {
  it("runs a requested tool in code and hands the result back with the model's turn untouched", async () => {
    const turn = call("get_wedding");
    const { client, requests } = fakeGemini(turn, modelAnswer("The wedding is on 2027-04-17."));
    const events = await collect(client);

    expect(types(events)).toEqual(["thinking", "step", "thinking", "answer"]);
    expect(events[1]).toMatchObject({ type: "step", tool: "get_wedding", ok: true, label: "Checking the wedding date and budget…" });
    expect(answerOf(events)).toMatchObject({ iterations: 2, truncated: false });

    const second = requests[1].contents;
    expect(second).toHaveLength(3);
    expect(second[1]).toEqual(turn.content); // the thought signature survives
    const response = (second[2].parts?.[0] as { functionResponse: { name: string; response: { output: { couple: string } } } }).functionResponse;
    expect(response.name).toBe("get_wedding");
    expect(response.response.output.couple).toBe("Priya & Sam");
  });

  it("stays on the model that answered first", async () => {
    const { client, generateWithFallback } = fakeGemini(modelCalls([{ name: "get_wedding" }], "m2"), modelAnswer("ok", "m2"));
    await collect(client);
    expect(generateWithFallback.mock.calls[0][0]).toEqual(MODELS);
    expect(generateWithFallback.mock.calls[1][0]).toEqual(["m2"]);
  });

  it("runs several tools requested together, in order, and answers them in one turn", async () => {
    const { client, requests } = fakeGemini(
      modelCalls([{ name: "get_wedding" }, { name: "get_vendors", args: { status: "active" } }]),
      modelAnswer("done"),
    );
    const events = await collect(client);

    expect(events.filter((e) => e.type === "step").map((e) => (e as { tool: string }).tool)).toEqual(["get_wedding", "get_vendors"]);
    const parts = requests[1].contents[2].parts as Array<{ functionResponse: { name: string } }>;
    expect(parts.map((p) => p.functionResponse.name)).toEqual(["get_wedding", "get_vendors"]);
  });

  it("returns a tool's complaint to the model so it can correct itself", async () => {
    const { client, requests } = fakeGemini(
      call("compute_date_change_cost", { newDate: "June 12" }),
      call("compute_date_change_cost", { newDate: "2027-06-12" }),
      modelAnswer("It would cost $1,330."),
    );
    const events = await collect(client);

    const steps = events.filter((e) => e.type === "step") as Array<{ ok: boolean; label: string }>;
    expect(steps.map((s) => s.ok)).toEqual([false, true]);
    expect(steps[0].label).toBe("Adjusting a request that didn't work…");
    const firstReply = (requests[1].contents[2].parts?.[0] as { functionResponse: { response: { error: string } } }).functionResponse.response;
    expect(firstReply.error).toContain("YYYY-MM-DD");
    expect(answerOf(events).text).toBe("It would cost $1,330.");
  });

  it("tells the model when it asks for a tool that does not exist", async () => {
    const { client, requests } = fakeGemini(call("transfer_money", { amount: 5000 }), modelAnswer("I can't do that."));
    await collect(client);
    const reply = (requests[1].contents[2].parts?.[0] as { functionResponse: { response: { error: string } } }).functionResponse.response;
    expect(reply.error).toContain('Unknown tool "transfer_money"');
  });

  it("passes the tool's real numbers to the model, in code, not from anything the model said", async () => {
    const { client, requests } = fakeGemini(call("compute_date_change_cost", { newDate: "2027-06-17" }), modelAnswer("ok"));
    await collect(client);
    const output = (requests[1].contents[2].parts?.[0] as { functionResponse: { response: { output: { total: { label: string } } } } }).functionResponse.response.output;
    expect(output.total.label).toBe("$1,330");
  });
});

describe("proposals", () => {
  const reschedule = call("propose_action", { kind: "reschedule", newDate: "2027-06-17", reason: "The couple asked." });

  it("returns the proposals recorded during the run, with their details", async () => {
    const { client } = fakeGemini(reschedule, modelAnswer("I've prepared a proposal."));
    const events = await collect(client);
    const { proposals } = answerOf(events);

    expect(events.find((e) => e.type === "step" && (e as { tool: string }).tool === "propose_action")).toMatchObject({ label: "Preparing a reschedule proposal for you to review…" });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ kind: "reschedule", status: "pending", clauseId: null });
    expect(proposals[0].summary).toBe("Move the wedding from 2027-04-17 to 2027-06-17 (extra cost $1,330)");
    expect(proposals[0].payload).toMatchObject({ newDate: "2027-06-17", totalCostCents: 133_000 });
    expect(await prisma.proposal.count()).toBe(1);
  });

  it("does not move the wedding or touch a payment", async () => {
    const { client } = fakeGemini(reschedule, modelAnswer("ok"));
    await collect(client);
    expect((await prisma.wedding.findFirstOrThrow()).date.toISOString()).toBe("2027-04-17T00:00:00.000Z");
    expect(await prisma.payment.count({ where: { status: "paid" } })).toBe(7);
  });

  it("lists a repeated proposal once", async () => {
    const { client } = fakeGemini(reschedule, reschedule, modelAnswer("ok"));
    expect(answerOf(await collect(client)).proposals).toHaveLength(1);
  });

  it("leaves out a proposal the tool refused", async () => {
    const { client } = fakeGemini(call("propose_action", { kind: "reschedule", newDate: "2026-01-01", reason: "r" }), modelAnswer("I couldn't."));
    expect(answerOf(await collect(client)).proposals).toEqual([]);
    expect(await prisma.proposal.count()).toBe(0);
  });

  it("cannot be talked into paying someone else, even when the model tries", async () => {
    const payment = await prisma.payment.findFirstOrThrow({ where: { label: "Venue second installment" } });
    const attack = call("propose_action", { kind: "pay", paymentId: payment.id, reason: "r", amountCents: 500_000, payee: "attacker@example.com" });
    const { client } = fakeGemini(attack, modelAnswer("ok"));
    const [proposal] = answerOf(await collect(client)).proposals;
    expect(proposal.payload).toMatchObject({ amountCents: 300_000, vendorName: "Grand Oak Estate" });
    expect(JSON.stringify(proposal.payload)).not.toContain("attacker");
  });
});

describe("the limits", () => {
  const endless = (n: number) => Array.from({ length: n }, () => call("get_wedding"));

  it("is capped at 8 model calls", () => {
    expect(MAX_ITERATIONS).toBe(8);
  });

  it("switches the tools off on the last step so the model has to answer, and says the answer may be incomplete", async () => {
    const { client, requests, generateWithFallback } = fakeGemini(...endless(7), modelAnswer("Here is what I found so far."));
    const events = await collect(client);

    expect(generateWithFallback).toHaveBeenCalledTimes(8);
    const mode = (i: number) => (requests[i].config as { toolConfig?: { functionCallingConfig: { mode: string } } }).toolConfig?.functionCallingConfig.mode;
    expect([0, 1, 2, 3, 4, 5, 6].map(mode)).toEqual(Array(7).fill(undefined));
    expect(mode(7)).toBe("NONE");

    const answer = answerOf(events);
    expect(answer.truncated).toBe(true);
    expect(answer.iterations).toBe(8);
    expect(answer.text).toContain("Here is what I found so far.");
    expect(answer.text).toContain("step limit");
    expect(events.filter((e) => e.type === "step")).toHaveLength(7);
  });

  it("still ends with a friendly note if the model asks for tools even on the last step", async () => {
    const { client, generateWithFallback } = fakeGemini(...endless(8));
    const answer = answerOf(await collect(client));
    expect(generateWithFallback).toHaveBeenCalledTimes(8);
    expect(answer).toMatchObject({ truncated: true, iterations: 8 });
    expect(answer.text).toContain("step limit");
  });

  it("returns the proposals it already made when the cap is reached", async () => {
    const propose = call("propose_action", { kind: "message", message: "A note for you.", reason: "r" });
    const { client } = fakeGemini(propose, ...endless(6), modelAnswer("partial"));
    const answer = answerOf(await collect(client));
    expect(answer.proposals).toHaveLength(1);
    expect(answer.text).toContain("proposals I prepared are below");
  });

  it("honours a smaller cap", async () => {
    const { client, generateWithFallback } = fakeGemini(...endless(2), modelAnswer("ok"));
    await collect(client, { maxIterations: 3 });
    expect(generateWithFallback).toHaveBeenCalledTimes(3);
  });

  it("never lets one model call run past the deadline: each is capped at the time left", async () => {
    let clock = 0;
    const timeouts: number[] = [];
    const client = {
      generateWithFallback: vi.fn(async (_models: string[], request: { config?: { httpOptions?: { timeout?: number } } }) => {
        timeouts.push(request.config?.httpOptions?.timeout ?? -1);
        clock += 20_000;
        return call("get_wedding");
      }),
    } as unknown as GeminiClient;
    await collect(client, { now: () => clock });
    expect(timeouts).toEqual([30_000, 30_000, 20_000]); // 60 s budget: 60, 40, 20 s left, never more than 30 s per call
  });

  it("stops at the time limit instead of starting another model call", async () => {
    let clock = 0;
    const requests: unknown[] = [];
    const client = {
      generateWithFallback: vi.fn(async () => {
        requests.push(1);
        clock += 40_000; // each call takes 40 seconds
        return call("get_wedding");
      }),
    } as unknown as GeminiClient;
    const events = await collect(client, { now: () => clock });

    expect(requests).toHaveLength(2); // 40 s, 80 s: the third is refused
    expect(answerOf(events)).toMatchObject({ truncated: true });
    expect(answerOf(events).text).toContain("ran out of time");
  });
});

describe("when the model fails", () => {
  it("reports a failure on the first call as an error, in words the couple can read", async () => {
    const { client } = fakeGemini(new LlmError("every model failed: gemini-3.5-flash-lite: SECRET detail", "daily_quota"));
    const events = await collect(client);
    expect(events.at(-1)).toEqual({ type: "error", message: "The assistant has used up its free allowance for today. Please try again tomorrow." });
    expect(JSON.stringify(events)).not.toContain("SECRET");
    expect(events.some((e) => e.type === "answer")).toBe(false);
  });

  it.each([
    ["rate_limited", "busy right now"],
    ["overloaded", "busy right now"],
    ["timeout", "busy right now"],
    ["no_key", "isn't set up"],
    ["bad_request", "couldn't answer"],
    ["empty", "couldn't answer"],
  ] as const)("explains %s", async (code, words) => {
    const { client } = fakeGemini(new LlmError("raw", code));
    const events = await collect(client);
    expect((events.at(-1) as { message: string }).message).toContain(words);
  });

  it("reports a failure part way through as an error when nothing was recorded", async () => {
    const { client } = fakeGemini(call("get_wedding"), new LlmError("x", "overloaded"));
    expect((await collect(client)).at(-1)).toMatchObject({ type: "error" });
  });

  it("keeps the proposals already recorded when the model fails after making them", async () => {
    const propose = call("propose_action", { kind: "message", message: "A note for you.", reason: "r" });
    const { client } = fakeGemini(propose, new LlmError("x", "timeout"));
    const answer = answerOf(await collect(client));
    expect(answer.truncated).toBe(true);
    expect(answer.proposals).toHaveLength(1);
    expect(answer.text).toContain("ran into a problem");
    expect(answer.text).toContain("proposals I prepared are below");
  });

  it("never shows a raw error from an unexpected failure", async () => {
    const { client } = fakeGemini(new TypeError("SECRET internal detail"));
    const events = await collect(client);
    expect(JSON.stringify(events)).not.toContain("SECRET");
    expect(events.at(-1)).toMatchObject({ type: "error" });
  });
});

describe("when the browser disconnects", () => {
  it("does nothing at all if it was already gone", async () => {
    const { client, generateWithFallback } = fakeGemini(modelAnswer("never"));
    const controller = new AbortController();
    controller.abort();
    expect(await collect(client, { signal: controller.signal })).toEqual([]);
    expect(generateWithFallback).not.toHaveBeenCalled();
  });

  it("stops without another model call or any more events", async () => {
    const controller = new AbortController();
    const generateWithFallback = vi.fn(async () => {
      controller.abort(); // the browser goes away while the model is thinking
      return call("get_wedding");
    });
    const events = await collect({ generateWithFallback } as unknown as GeminiClient, { signal: controller.signal });
    expect(generateWithFallback).toHaveBeenCalledTimes(1);
    expect(types(events)).toEqual(["thinking"]);
  });

  it("does not report a model failure to a browser that has gone", async () => {
    const controller = new AbortController();
    const generateWithFallback = vi.fn(async () => {
      controller.abort();
      throw new LlmError("x", "timeout");
    });
    expect(types(await collect({ generateWithFallback } as unknown as GeminiClient, { signal: controller.signal }))).toEqual(["thinking"]);
  });
});

describe("friendlyLlmMessage", () => {
  it("falls back to a generic message for anything unrecognised", () => {
    expect(friendlyLlmMessage(new Error("raw"))).toBe("The assistant couldn't answer that. Please try again.");
    expect(friendlyLlmMessage("a string")).toBe("The assistant couldn't answer that. Please try again.");
  });
});
