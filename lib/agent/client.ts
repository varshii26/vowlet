import { z } from "zod";
import { createSseParser, type StreamEvent } from "@/lib/agent/sse";
import type { ChatTurn } from "@/lib/agent/loop";

/**
 * Browser side of POST /api/agent: send a question and hand each streamed event
 * to `onEvent`. Nothing here throws. A failure, a refusal from the server, or a
 * connection that drops early comes back as a message the couple can read.
 */

const errorSchema = z.object({ error: z.object({ message: z.string() }) });

export type StreamOutcome =
  | { ok: true }
  /** `aborted` is the couple pressing Stop (or leaving): not an error to show. */
  | { ok: false; aborted: true }
  | { ok: false; aborted?: false; message: string };

const NETWORK = "Couldn't reach Vowlet. Check your connection and try again.";
const UNEXPECTED = "Something unexpected happened. Please try again.";
const INTERRUPTED = "The connection dropped before the assistant finished. Please ask again.";

export type StreamInput = {
  question: string;
  history?: ChatTurn[];
  signal?: AbortSignal;
  onEvent: (event: StreamEvent) => void;
};

export async function streamAgent({ question, history, signal, onEvent }: StreamInput): Promise<StreamOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, ...(history && history.length > 0 ? { history } : {}) }),
      signal,
    });
  } catch {
    return signal?.aborted ? { ok: false, aborted: true } : { ok: false, message: NETWORK };
  }

  if (!response.ok) {
    const body = errorSchema.safeParse(await response.json().catch(() => null));
    return { ok: false, message: body.success ? body.data.error.message : UNEXPECTED };
  }
  if (!response.body) return { ok: false, message: UNEXPECTED };

  let finished = false;
  const parser = createSseParser((event) => {
    if (event.type === "done") finished = true;
    onEvent(event);
  });

  try {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      parser.push(decoder.decode(chunk.value, { stream: true }));
    }
  } catch {
    return signal?.aborted ? { ok: false, aborted: true } : { ok: false, message: INTERRUPTED };
  }

  if (signal?.aborted) return { ok: false, aborted: true };
  return finished ? { ok: true } : { ok: false, message: INTERRUPTED };
}
