import { afterEach, describe, expect, it, vi } from "vitest";
import { streamAgent } from "@/lib/agent/client";
import { encodeSse, type StreamEvent } from "@/lib/agent/sse";

afterEach(() => vi.unstubAllGlobals());

const usage = { inputTokens: 1, outputTokens: 1, thinkingTokens: 0, cachedTokens: 0 };
const events: StreamEvent[] = [
  { type: "thinking", label: "Understanding your question…" },
  { type: "step", tool: "get_wedding", ok: true, label: "Checking the wedding date and budget…" },
  { type: "answer", text: "Done.", proposals: [], model: "m1", iterations: 2, truncated: false, usage, sources: [] },
  { type: "done" },
];

/** A streaming Response that delivers `text` in pieces of `size` characters. */
function streamOf(text: string, size = 7, status = 200) {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= text.length) return controller.close();
      controller.enqueue(encoder.encode(text.slice(i, i + size)));
      i += size;
    },
  });
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}
const sse = (list: StreamEvent[]) => list.map(encodeSse).join("");

async function run(over: { text?: string; size?: number; signal?: AbortSignal; history?: Array<{ role: "user" | "assistant"; text: string }> } = {}) {
  const seen: StreamEvent[] = [];
  const outcome = await streamAgent({ question: "What do we owe?", history: over.history, signal: over.signal, onEvent: (e) => seen.push(e) });
  return { outcome, seen };
}

describe("streamAgent", () => {
  it("hands over each event as it arrives, however the network splits the stream", async () => {
    for (const size of [1, 5, 40, 10_000]) {
      vi.stubGlobal("fetch", vi.fn(async () => streamOf(sse(events), size)));
      const { outcome, seen } = await run();
      expect(outcome, `chunk ${size}`).toEqual({ ok: true });
      expect(seen).toEqual(events);
    }
  });

  it("posts the question, and the earlier turns only when there are some", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return streamOf(sse(events));
    });

    await run();
    await run({ history: [{ role: "user", text: "hi" }] });

    expect(calls.map((c) => c.url)).toEqual(["/api/agent", "/api/agent"]);
    expect(calls.map((c) => c.init.method)).toEqual(["POST", "POST"]);
    const bodies = calls.map((c) => JSON.parse(String(c.init.body)));
    expect(bodies[0]).toEqual({ question: "What do we owe?" });
    expect(bodies[1]).toEqual({ question: "What do we owe?", history: [{ role: "user", text: "hi" }] });
  });

  it.each([
    [429, { ok: false, error: { code: "too_many_requests", message: "The assistant is getting a lot of questions. Try again in 12 seconds." } }, "Try again in 12 seconds"],
    [503, { ok: false, error: { code: "not_configured", message: "The assistant isn't set up on this server yet." } }, "isn't set up"],
    [400, { ok: false, error: { code: "bad_request", message: "Ask a question." } }, "Ask a question."],
  ])("shows the server's own message for a %i", async (status, body, words) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
    const { outcome, seen } = await run();
    expect(outcome).toMatchObject({ ok: false });
    expect(outcome.ok === false && "message" in outcome ? outcome.message : "").toContain(words);
    expect(seen).toEqual([]);
  });

  it("gives a plain message for an error response it can't read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>oops</html>", { status: 500 })));
    const { outcome } = await run();
    expect(outcome).toEqual({ ok: false, message: "Something unexpected happened. Please try again." });
  });

  it("says so when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const { outcome } = await run();
    expect(outcome).toEqual({ ok: false, message: "Couldn't reach Vowlet. Check your connection and try again." });
  });

  it("reports a connection that drops before 'done' as interrupted, keeping what arrived", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamOf(sse(events.slice(0, 2)))));
    const { outcome, seen } = await run();
    expect(outcome).toMatchObject({ ok: false, message: expect.stringContaining("connection dropped") });
    expect(seen).toHaveLength(2);
  });

  it("reports a stream that breaks part way as interrupted", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(encodeSse(events[0])));
        controller.error(new TypeError("network error"));
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    const { outcome } = await run();
    expect(outcome).toMatchObject({ ok: false, message: expect.stringContaining("connection dropped") });
  });

  it("treats Stop as neither a success nor an error, whether before or during the stream", async () => {
    const early = new AbortController();
    early.abort();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })));
    expect((await run({ signal: early.signal })).outcome).toEqual({ ok: false, aborted: true });

    const mid = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(encodeSse(events[0])));
        mid.signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    const pending = run({ signal: mid.signal });
    await new Promise((r) => setTimeout(r, 10));
    mid.abort();
    const { outcome, seen } = await pending;
    expect(outcome).toEqual({ ok: false, aborted: true });
    expect(seen).toHaveLength(1);
  });

  it("copes with a response that has no body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, body: null }) as unknown as Response));
    expect((await run()).outcome).toEqual({ ok: false, message: "Something unexpected happened. Please try again." });
  });
});
