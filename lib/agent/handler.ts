import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { MAX_HISTORY_TURNS, MAX_QUESTION_CHARS, MAX_TURN_CHARS } from "@/lib/agent/limits";
import { runAgent } from "@/lib/agent/loop";
import { encodeSse, type StreamEvent } from "@/lib/agent/sse";
import type { OrderLookup } from "@/lib/agent/tools/types";
import type { GeminiClient } from "@/lib/llm/gemini";
import type { RateLimiter } from "@/lib/rate-limit";

export { MAX_HISTORY_TURNS, MAX_QUESTION_CHARS, MAX_TURN_CHARS };

const bodySchema = z.object({
  question: z
    .string({ error: "Ask a question." })
    .trim()
    .min(1, "Ask a question.").max(MAX_QUESTION_CHARS, `Keep the question under ${MAX_QUESTION_CHARS} characters.`),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1).max(MAX_TURN_CHARS) }))
    .max(MAX_HISTORY_TURNS)
    .optional(),
});

export type AgentHandlerDeps = {
  client: GeminiClient;
  models: string[];
  prisma: PrismaClient;
  /** Read-only PayPal order lookup, or null when PayPal isn't configured. */
  paypal?: OrderLookup | null;
  limiter: RateLimiter;
  /** The wedding the signed-in caller is working on, from their session; null if they have none yet. */
  resolveWeddingId: () => Promise<string | null>;
  /** False when GEMINI_API_KEY is not set. */
  configured: boolean;
  today?: () => Date;
};

const fail = (status: number, code: string, message: string, headers?: HeadersInit) =>
  Response.json({ ok: false, error: { code, message } }, { status, headers });

/**
 * POST /api/agent with `{ question, history? }`. Answers as a Server-Sent Events
 * stream: a `thinking` or `step` event as the assistant works, then one `answer`
 * (with any proposals) or `error`, then `done`.
 *
 * Every question spends free-tier quota and the endpoint is public, so it is
 * rate limited, and the run is cancelled if the browser disconnects.
 */
export async function agentHandler(request: Request, deps: AgentHandlerDeps): Promise<Response> {
  if (!deps.configured) return fail(503, "not_configured", "The assistant isn't set up on this server yet.");

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail(400, "bad_request", "Send a JSON body like { \"question\": \"...\" }.");
  }
  const body = bodySchema.safeParse(raw);
  if (!body.success) return fail(400, "bad_request", body.error.issues[0]?.message ?? "That request wasn't understood.");

  // The assistant answers about the caller's own wedding. Without one there is nothing to ask about, and no quota is spent.
  const weddingId = await deps.resolveWeddingId();
  if (!weddingId) return fail(409, "no_wedding", "Set up your wedding first, then ask away.");

  // Only a valid question counts: a malformed request costs no quota, so it must not use up
  // the shared allowance and lock real users out.
  // Counted per wedding (one per user), so one couple using up their questions never locks out another.
  const limit = deps.limiter.check(weddingId);
  if (!limit.allowed) {
    const seconds = Math.ceil(limit.retryAfterMs / 1000);
    return fail(429, "too_many_requests", `The assistant is getting a lot of questions. Try again in ${seconds} seconds.`, { "Retry-After": String(seconds) });
  }

  // Cancelled when the browser goes away, so a closed tab stops spending the free quota.
  const stop = new AbortController();
  request.signal.addEventListener("abort", () => stop.abort());

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        if (!stop.signal.aborted) controller.enqueue(encoder.encode(encodeSse(event)));
      };
      try {
        for await (const event of runAgent({
          question: body.data.question,
          history: body.data.history,
          client: deps.client,
          models: deps.models,
          prisma: deps.prisma,
          weddingId,
          paypal: deps.paypal ?? null,
          today: deps.today?.() ?? new Date(),
          signal: stop.signal,
        })) {
          send(event);
        }
        send({ type: "done" });
      } catch (error) {
        console.error("[agent] run failed:", error instanceof Error ? error.message : error);
        send({ type: "error", message: "Something went wrong. Please try again." });
        send({ type: "done" });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed because the browser cancelled
        }
      }
    },
    cancel() {
      stop.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no", // tell proxies not to buffer the stream
    },
  });
}
