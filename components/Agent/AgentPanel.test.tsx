// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPanel } from "@/components/Agent/AgentPanel";
import { encodeSse, type StreamEvent } from "@/lib/agent/sse";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const usage = { inputTokens: 1, outputTokens: 1, thinkingTokens: 0, cachedTokens: 0 };
const answer = (text: string, over: Partial<Extract<StreamEvent, { type: "answer" }>> = {}): StreamEvent => ({
  type: "answer",
  text,
  proposals: [],
  model: "m1",
  iterations: 1,
  truncated: false,
  usage,
  ...over,
});
const proposal = (id: string) => ({ id, kind: "reschedule", status: "pending", summary: "Move the wedding", clauseId: null, payload: {} });

/** A streaming response the test controls: push events as the "server" produces them. */
function liveStream() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => (controller = c) });
  return {
    response: new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    push: (...events: StreamEvent[]) => controller.enqueue(encoder.encode(events.map(encodeSse).join(""))),
    close: () => controller.close(),
    /** What a real browser does when a fetch is aborted: the response stream fails. */
    failOnAbort: (signal?: AbortSignal | null) =>
      signal?.addEventListener("abort", () => controller.error(new DOMException("The operation was aborted.", "AbortError"))),
  };
}

/** A whole stream that is already complete. */
const complete = (...events: StreamEvent[]) => {
  const s = liveStream();
  s.push(...events, { type: "done" });
  s.close();
  return s.response;
};

type FetchCall = { url: string; body: { question: string; history?: Array<{ role: string; text: string }> }; signal?: AbortSignal | null };
let calls: FetchCall[];

function stubFetch(...responses: Array<Response | Error>) {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), signal: init.signal });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
}

const box = () => screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const ask = async (text: string) => {
  type(text);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  });
};

beforeEach(() => refresh.mockClear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the panel", () => {
  it("offers the demo questions, and Ask is disabled until something is typed", () => {
    render(<AgentPanel />);
    expect(screen.getByRole("heading", { name: "Ask about your payments" })).toBeTruthy();
    expect(within(screen.getByLabelText("Suggested questions")).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "What do we owe in the next 30 days?",
      "What if we move the wedding to June 12?",
      "The florist cancelled, what now?",
    ]);
    expect((screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement).disabled).toBe(true);
    type("   ");
    expect((screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement).disabled).toBe(true);
    type("hello");
    expect((screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("caps the question at 500 characters and shows the count", () => {
    render(<AgentPanel />);
    expect(box().maxLength).toBe(500);
    type("12345");
    expect(screen.getByText("5/500")).toBeTruthy();
  });

  it("sends a suggested question when it is clicked", async () => {
    stubFetch(complete(answer("You owe $500.")));
    render(<AgentPanel />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "What do we owe in the next 30 days?" }));
    });

    expect(calls[0]).toMatchObject({ url: "/api/agent", body: { question: "What do we owe in the next 30 days?" } });
    expect(await screen.findByText("You owe $500.")).toBeTruthy();
    expect(screen.queryByLabelText("Suggested questions")).toBeNull();
  });
});

describe("asking and answering", () => {
  it("shows the question, then what the assistant is doing as it works, then the answer", async () => {
    const s = liveStream();
    stubFetch(s.response);
    render(<AgentPanel />);
    await ask("What if we move the wedding to June 12?");

    expect(screen.getByText("What if we move the wedding to June 12?")).toBeTruthy();
    expect(box().disabled).toBe(true);

    await act(async () => s.push({ type: "thinking", label: "Understanding your question…" }));
    const status = await screen.findByRole("status", { name: "The assistant is working" });
    expect(status.textContent).toContain("Understanding your question…");

    await act(async () => s.push({ type: "step", tool: "compute_date_change_cost", ok: true, label: "Calculating date-change fees for 14 vendors, moving to 2027-06-12…" }, { type: "thinking", label: "Putting the answer together…" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("✓ Calculating date-change fees for 14 vendors, moving to 2027-06-12…"));
    expect(screen.getByRole("status").textContent).toContain("Putting the answer together…");

    await act(async () => {
      s.push(answer("It would cost **$1,330**."), { type: "done" });
      s.close();
    });
    expect(await screen.findByText("$1,330", { selector: "strong" })).toBeTruthy();
    expect(screen.queryByRole("status", { name: "The assistant is working" })).toBeNull();
    expect(box().disabled).toBe(false);
  });

  it("keeps what the assistant did with the answer, to open later", async () => {
    stubFetch(
      complete(
        { type: "step", tool: "get_wedding", ok: true, label: "Checking the wedding date and budget…" },
        { type: "step", tool: "get_vendors", ok: true, label: "Looking up your vendors…" },
        answer("Done."),
      ),
    );
    render(<AgentPanel />);
    await ask("Tell me everything");

    const summary = await screen.findByText("How I worked this out (2 steps)");
    fireEvent.click(summary);
    expect(screen.getByText("Checking the wedding date and budget…")).toBeTruthy();
    expect(screen.getByText("Looking up your vendors…")).toBeTruthy();
  });

  it("shows a table in an answer as a table", async () => {
    stubFetch(complete(answer("| Vendor | Fee |\n|---|---|\n| Grand Oak Estate | $450 |")));
    render(<AgentPanel />);
    await ask("fees?");
    expect(await screen.findByRole("table")).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Grand Oak Estate" })).toBeTruthy();
  });

  it("never runs HTML in an answer", async () => {
    stubFetch(complete(answer('Careful <script>alert(1)</script> <img src=x onerror="alert(2)"> [pay now](https://evil.example)')));
    const { container } = render(<AgentPanel />);
    await ask("hi");
    await screen.findByText(/Careful/);
    expect(container.querySelector("script, img, a")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
  });

  it("flags an answer that may be incomplete", async () => {
    stubFetch(complete(answer("Here is what I found.\n\n(I reached my step limit before I could finish.)", { truncated: true })));
    render(<AgentPanel />);
    await ask("everything");
    expect(await screen.findByText("This answer may be incomplete.")).toBeTruthy();
  });

  describe("proposals", () => {
    it("tells the couple a proposal is waiting and refreshes the page so it appears", async () => {
      stubFetch(complete(answer("I've prepared a proposal.", { proposals: [proposal("p1")] })));
      render(<AgentPanel />);
      await ask("move it");
      expect(await screen.findByText("1 proposal is waiting for your approval below.")).toBeTruthy();
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("pluralises, and does not refresh when there are none", async () => {
      stubFetch(complete(answer("Two things.", { proposals: [proposal("a"), proposal("b")] })), complete(answer("Nothing to propose.")));
      render(<AgentPanel />);
      await ask("one");
      expect(await screen.findByText("2 proposals are waiting for your approval below.")).toBeTruthy();
      expect(refresh).toHaveBeenCalledTimes(1);

      await ask("two");
      await screen.findByText("Nothing to propose.");
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });
});

describe("when something goes wrong", () => {
  it("shows an error event in red, in the assistant's own words", async () => {
    stubFetch(complete({ type: "error", message: "The assistant has used up its free allowance for today. Please try again tomorrow." }));
    render(<AgentPanel />);
    await ask("hi");
    expect((await screen.findByRole("alert")).textContent).toBe("The assistant has used up its free allowance for today. Please try again tomorrow.");
    expect(box().disabled).toBe(false);
  });

  it("shows the server's message when it refuses the question", async () => {
    stubFetch(new Response(JSON.stringify({ ok: false, error: { code: "too_many_requests", message: "The assistant is getting a lot of questions. Try again in 12 seconds." } }), { status: 429 }));
    render(<AgentPanel />);
    await ask("hi");
    expect((await screen.findByRole("alert")).textContent).toContain("Try again in 12 seconds.");
  });

  it("says so when the network fails", async () => {
    stubFetch(new TypeError("offline"));
    render(<AgentPanel />);
    await ask("hi");
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't reach Vowlet");
  });

  it("says so when the connection drops before the answer", async () => {
    const s = liveStream();
    stubFetch(s.response);
    render(<AgentPanel />);
    await ask("hi");
    await act(async () => {
      s.push({ type: "thinking", label: "Understanding your question…" });
      s.close(); // ended without 'done'
    });
    expect((await screen.findByRole("alert")).textContent).toContain("connection dropped");
    expect(screen.queryByRole("status", { name: "The assistant is working" })).toBeNull();
  });

  it("shows one problem message, not two, when the stream reports an error and ends normally", async () => {
    stubFetch(complete({ type: "error", message: "The assistant is busy right now. Please try again in a moment." }));
    render(<AgentPanel />);
    await ask("hi");
    await screen.findByRole("alert");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});

describe("stopping", () => {
  it("cancels the request, with no error shown, and lets the couple ask again", async () => {
    const s = liveStream();
    stubFetch(s.response);
    render(<AgentPanel />);
    await ask("a slow question");
    s.failOnAbort(calls[0].signal);
    await act(async () => s.push({ type: "thinking", label: "Understanding your question…" }));
    expect(calls[0].signal?.aborted).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    });
    expect(calls[0].signal?.aborted).toBe(true);
    await waitFor(() => expect(screen.getByRole("button", { name: "Ask" })).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(box().disabled).toBe(false);
  });

  it("stops the run when the panel is removed from the page", async () => {
    const s = liveStream();
    stubFetch(s.response);
    const { unmount } = render(<AgentPanel />);
    await ask("hi");
    unmount();
    expect(calls[0].signal?.aborted).toBe(true);
  });
});

describe("keyboard and follow-ups", () => {
  it("sends on Enter but not on Shift+Enter", async () => {
    stubFetch(complete(answer("ok")));
    render(<AgentPanel />);
    type("first line");
    fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
    expect(calls).toHaveLength(0);

    await act(async () => {
      fireEvent.keyDown(box(), { key: "Enter" });
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].body.question).toBe("first line");
  });

  it("clears the box after sending, and sends a question once however it is submitted", async () => {
    stubFetch(complete(answer("ok")));
    render(<AgentPanel />);
    await ask("What do we owe?");
    expect(box().value).toBe("");
    expect(calls).toHaveLength(1);
  });

  it("sends the earlier answers with a follow-up, but not the problem messages", async () => {
    stubFetch(complete({ type: "error", message: "The assistant is busy right now. Please try again in a moment." }), complete(answer("You owe $500.")), complete(answer("The florist is Bloom & Thistle.")));
    render(<AgentPanel />);
    await ask("one");
    await screen.findByRole("alert");
    await ask("What do we owe?");
    await screen.findByText("You owe $500.");
    await ask("And the florist?");
    await screen.findByText("The florist is Bloom & Thistle.");

    expect(calls[0].body.history).toBeUndefined();
    expect(calls[1].body.history).toBeUndefined(); // "one" was never answered, so there is nothing to send back
    expect(calls[2].body.history).toEqual([
      { role: "user", text: "What do we owe?" },
      { role: "assistant", text: "You owe $500." },
    ]);
  });

  it("ignores a second question while one is running", async () => {
    const s = liveStream();
    stubFetch(s.response);
    render(<AgentPanel />);
    await ask("first");
    expect(box().disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull(); // replaced by Stop
    expect(calls).toHaveLength(1);
  });

  it("clears the conversation and brings the suggestions back", async () => {
    stubFetch(complete(answer("You owe $500.")));
    render(<AgentPanel />);
    await ask("What do we owe?");
    await screen.findByText("You owe $500.");

    fireEvent.click(screen.getByRole("button", { name: "Clear conversation" }));
    expect(screen.queryByText("You owe $500.")).toBeNull();
    expect(screen.getByLabelText("Suggested questions")).toBeTruthy();
  });
});
