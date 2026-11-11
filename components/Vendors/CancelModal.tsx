"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { ClauseChip } from "@/components/Clauses/ClauseChip";
import { formatCents } from "@/lib/money";
import {
  requestCancelConfirm,
  requestCancelPreview,
  type CancelConfirmView,
  type CancelPreviewView,
  type CancelledBy,
} from "@/lib/vendors/cancel-client";
import { clauseHref } from "@/lib/vendors/links";

type Props = { vendorId: string; vendorName: string };

type State =
  | { step: "closed" }
  | { step: "loading"; cancelledBy: CancelledBy }
  | { step: "preview"; cancelledBy: CancelledBy; preview: CancelPreviewView; busy: boolean; error: string | null }
  | { step: "done"; result: CancelConfirmView }
  | { step: "error"; cancelledBy: CancelledBy; message: string };

/**
 * "Cancel this vendor": who cancelled, what is owed back (computed in code from
 * the contract), the clause it comes from, and a drafted refund request to copy.
 * Confirming marks the vendor cancelled; nothing is sent and no refund is issued.
 */
export function CancelModal({ vendorId, vendorName }: Props) {
  const router = useRouter();
  const titleId = useId();
  const [state, setState] = useState<State>({ step: "closed" });
  const [copied, setCopied] = useState(false);

  const open = state.step !== "closed";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function load(cancelledBy: CancelledBy) {
    setCopied(false);
    setState({ step: "loading", cancelledBy });
    const res = await requestCancelPreview(vendorId, cancelledBy);
    setState(res.ok ? { step: "preview", cancelledBy, preview: res.preview, busy: false, error: null } : { step: "error", cancelledBy, message: res.message });
  }

  async function confirm() {
    if (state.step !== "preview") return;
    setState({ ...state, busy: true, error: null });
    const res = await requestCancelConfirm(vendorId, state.cancelledBy);
    if (!res.ok) {
      setState({ ...state, busy: false, error: res.message });
      return;
    }
    setState({ step: "done", result: res.result });
    router.refresh(); // the page, Gantt and totals re-render with the vendor cancelled
  }

  function close() {
    if (state.step === "preview" && state.busy) return;
    setState({ step: "closed" });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const cancelledBy = state.step === "loading" || state.step === "preview" || state.step === "error" ? state.cancelledBy : null;

  return (
    <>
      <button
        type="button"
        onClick={() => load("vendor")}
        className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
      >
        Cancel vendor&hellip;
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
          >
            <h2 id={titleId} className="text-xl font-semibold">
              Cancel {vendorName}
            </h2>

            {state.step === "done" ? (
              <Done result={state.result} copied={copied} onCopy={copy} onClose={close} />
            ) : (
              <>
                <fieldset className="space-y-1">
                  <legend className="text-sm font-medium text-ink">Who is cancelling?</legend>
                  <div role="radiogroup" className="inline-flex rounded-lg bg-canvas p-1">
                    {(
                      [
                        ["vendor", "The vendor cancelled"],
                        ["couple", "We are cancelling"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={cancelledBy === value}
                        disabled={state.step === "preview" && state.busy}
                        onClick={() => cancelledBy !== value && load(value)}
                        className={`rounded-md px-3 py-1 text-sm font-medium ${cancelledBy === value ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                {state.step === "loading" && <p className="text-sm text-muted">Working out what is owed back&hellip;</p>}
                {state.step === "error" && (
                  <p role="alert" className="text-sm text-red-700">
                    {state.message}
                  </p>
                )}
                {state.step === "preview" && <Preview vendorId={vendorId} preview={state.preview} copied={copied} onCopy={copy} />}

                {state.step === "preview" && state.error && (
                  <p role="alert" className="text-sm text-red-700">
                    {state.error}
                  </p>
                )}

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    disabled={state.step === "preview" && state.busy}
                    className="rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-canvas disabled:opacity-60"
                  >
                    Keep vendor
                  </button>
                  <button
                    type="button"
                    onClick={confirm}
                    disabled={state.step !== "preview" || state.busy}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {state.step === "preview" && state.busy ? "Cancelling..." : "Confirm cancellation"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Preview({ vendorId, preview, copied, onCopy }: { vendorId: string; preview: CancelPreviewView; copied: boolean; onCopy: (text: string) => void }) {
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-3 gap-2 text-center">
        <Figure label="Paid so far" cents={preview.paidCents} />
        <Figure label="Owed back to you" cents={preview.owedCents} strong />
        <Figure label="Vendor keeps" cents={preview.retainedCents} />
      </dl>
      <p className="text-sm text-ink">
        {preview.reason}{" "}
        {preview.citation && <ClauseChip label={preview.citation} clause={preview.clause} href={clauseHref(vendorId, preview.clauseId)} />}
      </p>
      {preview.draft ? (
        <DraftBox draft={preview.draft} copied={copied} onCopy={onCopy} heading="Drafted refund request (not sent)" />
      ) : (
        <p className="rounded-lg bg-canvas p-3 text-sm text-ink">Nothing is owed back, so there is no refund to request.</p>
      )}
      <p className="text-xs text-muted">Confirming marks the vendor cancelled{preview.draft ? " and its paid payments refund requested" : ""}. Nothing is sent and no money moves.</p>
    </div>
  );
}

function Done({ result, copied, onCopy, onClose }: { result: CancelConfirmView; copied: boolean; onCopy: (text: string) => void; onClose: () => void }) {
  return (
    <div className="space-y-3">
      <p role="status" className="text-sm text-ink">
        {result.message}
      </p>
      {result.draft && <DraftBox draft={result.draft} copied={copied} onCopy={onCopy} heading="Refund request to send" />}
      <div className="flex justify-end">
        <button type="button" onClick={onClose} className="rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-canvas">
          Close
        </button>
      </div>
    </div>
  );
}

function Figure({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div className={`rounded-lg p-2 ${strong ? "bg-accent-soft" : "bg-canvas"}`}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`text-lg ${strong ? "font-semibold text-accent-strong" : "font-medium"}`}>{formatCents(cents)}</dd>
    </div>
  );
}

function DraftBox({ draft, copied, onCopy, heading }: { draft: string; copied: boolean; onCopy: (text: string) => void; heading: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink">{heading}</h3>
        <button type="button" onClick={() => onCopy(draft)} className="text-sm font-medium text-accent underline underline-offset-2 hover:text-accent-strong">
          {copied ? "Copied" : "Copy message"}
        </button>
      </div>
      <p className="whitespace-pre-wrap rounded-lg border border-line bg-canvas p-3 text-sm text-ink">{draft}</p>
    </div>
  );
}
