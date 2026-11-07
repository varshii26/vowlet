"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { streamAgent } from "@/lib/agent/client";
import type { ChatTurn } from "@/lib/agent/loop";
import { MAX_HISTORY_TURNS, MAX_QUESTION_CHARS, MAX_TURN_CHARS } from "@/lib/agent/limits";

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** An assistant message is either an answer or a problem to show in red. */
  tone: "answer" | "error";
  /** The answer is incomplete: the step limit, the time limit, or a failure part way. */
  truncated: boolean;
  /** Proposals the answer left waiting for approval. */
  proposalCount: number;
  /** What the assistant did to get this answer, in order. */
  steps: string[];
};

export type LiveStep = { label: string; ok: boolean };

const message = (id: number, role: ChatMessage["role"], text: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role,
  text,
  tone: "answer",
  truncated: false,
  proposalCount: 0,
  steps: [],
  ...over,
});

/**
 * The chat's state and the streaming behind it: the conversation, the live list
 * of what the assistant is doing, and Stop. `onProposals` is called when an
 * answer leaves proposals waiting, so the page can refresh them.
 */
export function useAgentChat({ onProposals }: { onProposals?: () => void } = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [steps, setSteps] = useState<LiveStep[]>([]);
  const [activity, setActivity] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(1);

  // Leaving the page stops the run, so a closed tab doesn't keep spending the free quota.
  useEffect(() => () => abort.current?.abort(), []);

  const send = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question || question.length > MAX_QUESTION_CHARS || running) return;

      // Earlier turns for follow-up questions: only questions that were answered, as pairs.
      // A question that ended in a red problem message has nothing for the model to learn from.
      const history: ChatTurn[] = [];
      messages.forEach((m, i) => {
        const reply = messages[i + 1];
        if (m.role === "user" && reply?.role === "assistant" && reply.tone === "answer") {
          history.push({ role: "user", text: m.text.slice(0, MAX_TURN_CHARS) }, { role: "assistant", text: reply.text.slice(0, MAX_TURN_CHARS) });
        }
      });
      history.splice(0, Math.max(0, history.length - MAX_HISTORY_TURNS)); // keep the most recent turns

      const controller = new AbortController();
      abort.current = controller;
      setMessages((prev) => [...prev, message(nextId.current++, "user", question)]);
      setSteps([]);
      setActivity(null);
      setRunning(true);

      const done: string[] = [];
      const outcome = await streamAgent({
        question,
        history,
        signal: controller.signal,
        onEvent: (event) => {
          switch (event.type) {
            case "thinking":
              setActivity(event.label);
              break;
            case "step":
              done.push(event.label);
              setSteps((prev) => [...prev, { label: event.label, ok: event.ok }]);
              setActivity(null);
              break;
            case "answer":
              setMessages((prev) => [
                ...prev,
                message(nextId.current++, "assistant", event.text, { truncated: event.truncated, proposalCount: event.proposals.length, steps: [...done] }),
              ]);
              if (event.proposals.length > 0) onProposals?.();
              break;
            case "error":
              setMessages((prev) => [...prev, message(nextId.current++, "assistant", event.message, { tone: "error" })]);
              break;
            case "done":
              break;
          }
        },
      });

      // A dropped connection or a refusal (too many questions, no key) arrives here, not as an event.
      if (!outcome.ok && !outcome.aborted) {
        setMessages((prev) => [...prev, message(nextId.current++, "assistant", outcome.message, { tone: "error" })]);
      }
      if (abort.current === controller) abort.current = null;
      setActivity(null);
      setSteps([]);
      setRunning(false);
    },
    [messages, running, onProposals],
  );

  const stop = useCallback(() => abort.current?.abort(), []);
  const clear = useCallback(() => {
    abort.current?.abort();
    setMessages([]);
  }, []);

  return { messages, steps, activity, running, send, stop, clear };
}
