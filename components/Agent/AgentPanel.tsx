"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AnswerText } from "@/components/Agent/AnswerText";
import { useAgentChat } from "@/components/Agent/useAgentChat";
import { useGanttFocus } from "@/components/Gantt/FocusContext";
import { PendingProposals } from "@/components/Proposals/PendingProposals";
import type { AgentFocus } from "@/lib/agent/focus";
import { MAX_QUESTION_CHARS } from "@/lib/agent/limits";
import type { ProposalView } from "@/lib/proposals/view";

const SUGGESTIONS = ["What do we owe in the next 30 days?", "What if we move the wedding to June 12?", "The florist cancelled, what now?"];

/** Before any contract is added there is nothing to calculate, so the first questions are about getting started. */
const STARTER_SUGGESTIONS = ["How do I add my vendor contracts?", "What does Vowlet do with a contract?", "What can I ask you once my contracts are in?"];

type Props = {
  /** True when the wedding has no vendors yet: the suggestions then help the couple get started. */
  empty?: boolean;
  /** Proposals waiting for the couple, from the database. Each shows under the answer that made it. */
  proposals?: ProposalView[];
};

/**
 * "Ask Vowlet": the side panel where the couple asks about payments in plain
 * language. It shows what the assistant is doing as it works, then the answer,
 * with any proposal cards right under it to approve or dismiss. Proposals from
 * earlier visits wait at the top. The assistant cannot pay or change anything
 * itself.
 */
export function AgentPanel({ proposals = [], empty = false }: Props) {
  const router = useRouter();
  const ganttFocus = useGanttFocus();
  const { messages, steps, activity, running, send, stop, clear } = useAgentChat({
    onProposals: () => router.refresh(),
    onFocus: ganttFocus?.setFocus,
  });
  const [draft, setDraft] = useState("");
  const log = useRef<HTMLDivElement>(null);

  const pendingById = useMemo(() => new Map(proposals.map((p) => [p.id, p])), [proposals]);
  // A repeated question can return the same proposal again: show each card only
  // under the latest answer that mentions it, never twice.
  const ownerOf = new Map<string, number>();
  for (const m of messages) for (const id of m.proposalIds) ownerOf.set(id, m.id);
  const shownInline = new Set(ownerOf.keys());
  const earlier = proposals.filter((p) => !shownInline.has(p.id));

  // Keep the newest message (and the live steps) in view.
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTo?.({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, steps.length, running, proposals.length]);

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
    <section aria-labelledby="agent-heading" className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 id="agent-heading" className="text-xl text-ink">
            Ask Vowlet
          </h2>
          <p className="text-xs text-muted">Answers cite your contracts. Nothing happens until you approve it.</p>
        </div>
        {messages.length > 0 && (
          <button type="button" onClick={clear} className="shrink-0 rounded text-xs font-medium text-muted underline underline-offset-2 hover:text-ink">
            Clear conversation
          </button>
        )}
      </div>

      <div ref={log} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {/* Always mounted: after the last card is approved it still shows what happened (and a refund's draft to copy). */}
        <PendingProposals proposals={earlier} />

        {messages.length === 0 && !running && (
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted">Try one of these:</p>
            <div className="flex flex-col items-start gap-2" aria-label="Suggested questions">
              {(empty ? STARTER_SUGGESTIONS : SUGGESTIONS).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => submit(suggestion)}
                  className="rounded-full border border-line bg-surface px-3 py-1.5 text-left text-sm text-ink transition-colors hover:border-accent/40 hover:bg-accent-soft"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        <div role="log" aria-live="polite" className="space-y-4">
          {messages.map((m) =>
            m.role === "user" ? (
              <p key={m.id} className="animate-fade-up ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm text-white">
                {m.text}
              </p>
            ) : m.tone === "error" ? (
              <p key={m.id} role="alert" className="animate-fade-up rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-sm text-red-800">
                {m.text}
              </p>
            ) : (
              <div key={m.id} className="animate-fade-up space-y-3">
                <div className="space-y-2 rounded-2xl rounded-bl-md border border-line bg-surface px-3.5 py-2.5 shadow-card">
                  <AnswerText text={m.text} sources={m.sources} />
                  {m.truncated && <p className="text-xs font-medium text-amber-700">This answer may be incomplete.</p>}
                  {m.proposalCount > 0 && (
                    <p className="text-xs font-medium text-accent-strong">
                      {m.proposalCount === 1 ? "1 proposal is" : `${m.proposalCount} proposals are`} waiting for your approval below.
                    </p>
                  )}
                  {m.focus && ganttFocus && <TimelineLinks focus={m.focus} show={ganttFocus.setFocus} />}
                  {m.steps.length > 0 && (
                    <details className="text-xs text-muted">
                      <summary className="cursor-pointer rounded">
                        How I worked this out ({m.steps.length} {m.steps.length === 1 ? "step" : "steps"})
                      </summary>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5">
                        {m.steps.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
                <InlineProposals ids={m.proposalIds.filter((id) => ownerOf.get(id) === m.id)} pending={pendingById} />
              </div>
            ),
          )}
        </div>

        {running && (
          <div role="status" aria-label="The assistant is working" className="space-y-1.5 rounded-2xl border border-dashed border-line bg-surface/60 px-3.5 py-3 text-sm text-muted">
            {steps.map((step, i) => (
              <p key={i} className={`animate-fade-up ${step.ok ? "text-ink" : "text-muted"}`}>
                <span aria-hidden className={step.ok ? "text-emerald-600" : ""}>
                  {step.ok ? "✓" : "↻"}
                </span>{" "}
                {step.label}
              </p>
            ))}
            <p className="flex items-center gap-2">
              <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
              <span className="animate-pulse">{activity ?? "Working…"}</span>
            </p>
          </div>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft);
        }}
        className="space-y-2 border-t border-line bg-surface px-5 py-4"
      >
        <label htmlFor="agent-question" className="sr-only">
          Your question
        </label>
        <textarea
          id="agent-question"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          maxLength={MAX_QUESTION_CHARS}
          rows={2}
          placeholder="Ask something, for example: what if we postpone by two months?"
          disabled={running}
          className="w-full resize-none rounded-control border border-line bg-canvas p-2.5 text-sm text-ink placeholder:text-muted/70 focus:border-accent/50 focus:outline-none focus-visible:outline-2 disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs tabular-nums text-muted">
            {draft.length}/{MAX_QUESTION_CHARS}
          </span>
          {running ? (
            <button type="button" onClick={stop} className="btn btn-secondary">
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!draft.trim()} className="btn btn-primary">
              Ask
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

/** The cards an answer proposed that are still waiting. Resolved ones leave once the page refreshes. */
function InlineProposals({ ids, pending }: { ids: string[]; pending: Map<string, ProposalView> }) {
  if (ids.length === 0) return null;
  const waiting = ids.flatMap((id) => pending.get(id) ?? []);
  return <PendingProposals proposals={waiting} heading={null} />;
}

/**
 * Under an answer: put what it is about back on the timeline, or just one of
 * the vendors it mentions. The names come from the tools' output, not the
 * model's text (lib/agent/focus.ts).
 */
function TimelineLinks({ focus, show }: { focus: AgentFocus; show: (focus: AgentFocus) => void }) {
  const link = "rounded-full border border-line px-2 py-0.5 text-xs font-medium text-ink hover:border-accent hover:text-accent-strong";
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="On the timeline">
      <button type="button" className={link} onClick={() => show(focus)}>
        Show on timeline
      </button>
      {focus.vendors.length > 1 &&
        focus.vendors.map((vendor) => (
          <button
            key={vendor.id}
            type="button"
            className={link}
            onClick={() =>
              show({
                vendors: [vendor],
                paymentIds: [],
                range: null,
                previewDate: null,
                refund: focus.refund?.vendorId === vendor.id ? focus.refund : null,
              })
            }
          >
            {vendor.name}
          </button>
        ))}
    </div>
  );
}
