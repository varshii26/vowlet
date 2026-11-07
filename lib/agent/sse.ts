import type { AgentEvent } from "@/lib/agent/loop";

/**
 * Server-Sent Events for the agent stream. The server writes one event per step
 * and the browser (the chat panel, #19) reads them as they arrive. The parser
 * copes with events split across network chunks, which fetch streaming does.
 */

export type StreamEvent = AgentEvent | { type: "done" };

/** One event as SSE text: `event: step` then a single line of JSON. */
export function encodeSse(event: StreamEvent): string {
  // JSON.stringify never emits a raw newline, so the data always fits on one line.
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * An incremental SSE parser: `push` each chunk of text as it arrives and
 * `onEvent` is called once per complete event. Comments and malformed events are skipped.
 */
export function createSseParser(onEvent: (event: StreamEvent) => void) {
  let buffer = "";

  function dispatch(block: string) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) return;
    try {
      const parsed: unknown = JSON.parse(data);
      if (typeof parsed === "object" && parsed !== null && typeof (parsed as { type?: unknown }).type === "string") {
        onEvent(parsed as StreamEvent); // the server wrote it; the type tag is the only thing the UI switches on
      }
    } catch {
      // not JSON: ignore
    }
  }

  return {
    push(chunk: string) {
      buffer += chunk.replace(/\r\n/g, "\n");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        dispatch(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
    },
  };
}
