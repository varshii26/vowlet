"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type KeyboardEvent } from "react";
import { AnswerText } from "@/components/Agent/AnswerText";
import { useAgentChat } from "@/components/Agent/useAgentChat";
import { MAX_QUESTION_CHARS } from "@/lib/agent/limits";

const SUGGESTIONS = ["What do we owe in the next 30 days?", "What if we move the wedding to June 12?", "The florist cancelled, what now?"];

/**
 * Ask the assistant about payments in plain language. It shows what it is doing
 * as it works, then the answer; anything it proposes appears under "Waiting for
 * your approval" for the couple to approve or dismiss. It cannot pay or change
 * anything itself.
 */
export function AgentPanel() {
  const router = useRouter();
  const { messages, steps, activity, running, send, stop, clear } = useAgentChat({ onProposals: () => router.refresh() });
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  function submit(question: string) {
    if (!question.trim() || running) return;
    setDraft("");
    void send(question);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit(draft);
    }
  }

  return (
    <section aria-labelledby="agent-heading" className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5">
      <div className="flex items-center justify-between gap-4">
        <h2 id="agent-heading" className="text-xl font-semibold">
          Ask about your payments
        </h2>
        {messages.length > 0 && (
          <button type="button" onClick={clear} className="text-sm text-neutral-600 underline">
            Clear conversation
          </button>
        )}
      </div>

      {messages.length === 0 && !running && (
        <div className="flex flex-wrap gap-2" aria-label="Suggested questions">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => submit(suggestion)}
              className="rounded-full border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <div role="log" aria-live="polite" className="space-y-3">
        {messages.map((m) =>
          m.role === "user" ? (
            <p key={m.id} className="ml-auto w-fit max-w-[85%] rounded-lg bg-neutral-900 px-3 py-2 text-sm text-white">
              {m.text}
            </p>
          ) : m.tone === "error" ? (
            <p key={m.id} role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {m.text}
            </p>
          ) : (
            <div key={m.id} className="space-y-2 rounded-lg bg-neutral-50 px-3 py-2">
              <AnswerText text={m.text} />
              {m.truncated && <p className="text-xs font-medium text-amber-700">This answer may be incomplete.</p>}
              {m.proposalCount > 0 && (
                <p className="text-xs font-medium text-neutral-700">
                  {m.proposalCount === 1 ? "1 proposal is" : `${m.proposalCount} proposals are`} waiting for your approval below.
                </p>
              )}
              {m.steps.length > 0 && (
                <details className="text-xs text-neutral-600">
                  <summary className="cursor-pointer">How I worked this out ({m.steps.length} {m.steps.length === 1 ? "step" : "steps"})</summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {m.steps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ),
        )}
      </div>

      {running && (
        <div role="status" aria-label="The assistant is working" className="space-y-1 text-sm text-neutral-600">
          {steps.map((step, i) => (
            <p key={i} className={step.ok ? "" : "text-neutral-400"}>
              {step.ok ? "✓" : "↻"} {step.label}
            </p>
          ))}
          <p className="animate-pulse">{activity ?? "Working…"}</p>
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft);
        }}
        className="space-y-2"
      >
        <label htmlFor="agent-question" className="sr-only">
          Your question
        </label>
        <textarea
          id="agent-question"
          ref={input}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          maxLength={MAX_QUESTION_CHARS}
          rows={2}
          placeholder="Ask something, for example: what if we postpone by two months?"
          disabled={running}
          className="w-full resize-none rounded-lg border border-neutral-300 p-2 text-sm disabled:bg-neutral-100"
        />
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-neutral-500">
            {draft.length}/{MAX_QUESTION_CHARS}
          </span>
          {running ? (
            <button type="button" onClick={stop} className="rounded-lg border border-neutral-300 px-4 py-1.5 text-sm font-medium hover:bg-neutral-50">
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!draft.trim()} className="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:bg-neutral-300">
              Ask
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
