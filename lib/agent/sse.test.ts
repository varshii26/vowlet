import { describe, expect, it } from "vitest";
import { createSseParser, encodeSse, type StreamEvent } from "@/lib/agent/sse";

const usage = { inputTokens: 1, outputTokens: 2, thinkingTokens: 3, cachedTokens: 0 };
const answer: StreamEvent = { type: "answer", text: "Line one\nLine two, café ☕ and \"quotes\"", proposals: [], model: "m1", iterations: 2, truncated: false, usage, sources: [], focus: null };
const events: StreamEvent[] = [
  { type: "thinking", label: "Understanding your question…" },
  { type: "step", tool: "get_wedding", ok: true, label: "Checking the wedding date and budget…" },
  answer,
  { type: "error", message: "The assistant is busy right now." },
  { type: "done" },
];

function parse(text: string, chunk = text.length): StreamEvent[] {
  const out: StreamEvent[] = [];
  const parser = createSseParser((e) => out.push(e));
  for (let i = 0; i < text.length; i += chunk) parser.push(text.slice(i, i + chunk));
  return out;
}

describe("encodeSse", () => {
  it("writes the event name and one line of JSON, then a blank line", () => {
    expect(encodeSse({ type: "done" })).toBe('event: done\ndata: {"type":"done"}\n\n');
  });

  it("keeps newlines inside the text from breaking the format", () => {
    const text = encodeSse(answer);
    expect(text.split("\n")).toHaveLength(4); // event line, data line, then the two that end the block
    expect(text.endsWith("\n\n")).toBe(true);
  });
});

describe("createSseParser", () => {
  const stream = events.map(encodeSse).join("");

  it("round-trips every kind of event, including unicode and newlines in text", () => {
    expect(parse(stream)).toEqual(events);
  });

  it("gives the same events however the network splits the stream, even one character at a time", () => {
    for (const size of [1, 2, 3, 7, 13, 50, 1000]) expect(parse(stream, size), `chunk ${size}`).toEqual(events);
  });

  it("waits for the end of an event before reporting it", () => {
    const seen: StreamEvent[] = [];
    const parser = createSseParser((e) => seen.push(e));
    const text = encodeSse({ type: "done" });
    parser.push(text.slice(0, -1)); // missing the final newline
    expect(seen).toHaveLength(0);
    parser.push("\n");
    expect(seen).toHaveLength(1);
  });

  it("handles Windows line endings", () => {
    expect(parse(stream.replace(/\n/g, "\r\n"))).toEqual(events);
  });

  it("skips comments such as keep-alives", () => {
    expect(parse(`: keep-alive\n\n${encodeSse({ type: "done" })}`)).toEqual([{ type: "done" }]);
  });

  it("skips malformed events instead of failing, and carries on", () => {
    const text = `event: step\ndata: {not json\n\ndata: [1,2]\n\ndata: {"no":"type"}\n\ndata: "just a string"\n\nevent: x\n\n${encodeSse({ type: "done" })}`;
    expect(parse(text)).toEqual([{ type: "done" }]);
  });

  it("accepts a data line without the space after the colon", () => {
    expect(parse('data:{"type":"done"}\n\n')).toEqual([{ type: "done" }]);
  });

  it("reports nothing for an empty stream", () => {
    expect(parse("")).toEqual([]);
  });
});
