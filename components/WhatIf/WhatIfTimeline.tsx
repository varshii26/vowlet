"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PAYMENT_LISTS_ID } from "@/components/Dashboard/anchors";
import { useGanttFocus } from "@/components/Gantt/FocusContext";
import { StatusLegend } from "@/components/Gantt/StatusLegend";
import { PaymentGantt } from "@/components/Gantt/PaymentGantt";
import { usePaymentDrawer } from "@/components/Payments/PaymentDrawer";
import { useToast } from "@/components/ui/Toast";
import { WhatIfPanel, type ExplanationState, type WhatIfState } from "@/components/WhatIf/WhatIfPanel";
import { daysBetweenUtc, toIsoDate } from "@/lib/schedule";
import { describeFocus } from "@/lib/agent/focus";
import { buildTimeline, withBaseline, type TimelineInput } from "@/lib/timeline";
import { applyFocus } from "@/lib/timeline-focus";
import { requestApply, requestExplanation, requestWhatIf } from "@/lib/whatif/client";

const utcDay = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const NO_PROPOSALS: ReadonlySet<string> = new Set();

type Props = {
  input: TimelineInput;
  /** `YYYY-MM-DD`, from the server, so the browser and server agree on "today". */
  todayIso: string;
  /** Size of the chart box (the dashboard makes it fill the hero area). */
  className?: string;
};

/**
 * The payment timeline plus the drag-the-wedding-day what-if.
 *
 * Dropping the "Wedding day" milestone sets a preview date. The timeline is
 * rebuilt right here from lib/timeline (which uses lib/schedule), so every
 * wedding-anchored payment reflows instantly, with no server round trip and no
 * LLM. In parallel the server works out each vendor's fee with `dateChangeCost()`.
 * Nothing is saved until the couple confirms; Cancel snaps everything back.
 */
export function WhatIfTimeline({ input, todayIso, className }: Props) {
  const router = useRouter();
  const drawer = usePaymentDrawer();
  const { toast } = useToast();
  const baseIso = toIsoDate(input.wedding.date);

  const [preview, setPreview] = useState<string | null>(null);
  // Contract deadlines are noise most of the time; they show on request, and
  // on their own while a what-if preview is up (that's when they matter).
  const [deadlinesOn, setDeadlinesOn] = useState(false);
  const showDeadlines = deadlinesOn || Boolean(preview);
  // The chart hands over its print function once Bryntum has loaded.
  const printRef = useRef<(() => Promise<void>) | null>(null);
  const [canPrint, setCanPrint] = useState(false);
  const [printing, setPrinting] = useState(false);
  const onPrintReady = useCallback((print: (() => Promise<void>) | null) => {
    printRef.current = print;
    setCanPrint(Boolean(print));
  }, []);

  async function printSchedule() {
    if (!printRef.current || printing) return;
    setPrinting(true);
    try {
      await printRef.current();
    } catch {
      toast("Couldn't open the print dialog. Try again, or use your browser's Print.");
    } finally {
      setPrinting(false);
    }
  }
  const [whatIf, setWhatIf] = useState<WhatIfState>({ status: "loading" });
  const [explanation, setExplanation] = useState<ExplanationState>({ status: "none" });
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  // Answers to earlier drops are ignored once the wedding has been dropped again.
  const latestRequest = useRef(0);

  // When the saved wedding date changes (confirmed here, approved elsewhere, demo
  // reset), the preview is either now real or out of date: drop it.
  const [seenBase, setSeenBase] = useState(baseIso);
  if (seenBase !== baseIso) {
    setSeenBase(baseIso);
    setPreview(null);
    setApplying(false);
    setApplyError(null);
  }

  const today = useMemo(() => utcDay(todayIso), [todayIso]);
  // While a preview shows, the saved schedule rides along as Bryntum baselines:
  // a faded ghost where each moved payment was. Cancel or confirm drops them.
  const base = useMemo(() => buildTimeline(input, today), [input, today]);
  const timeline = useMemo(
    () => (preview ? withBaseline(buildTimeline({ ...input, wedding: { ...input.wedding, date: utcDay(preview) } }, today), base) : base),
    [input, preview, today, base],
  );

  // What the latest agent answer is about: highlighted, shaded and opened on
  // the timeline (lib/timeline-focus.ts). Without an answer, the plain schedule.
  const ganttFocus = useGanttFocus();
  const focus = ganttFocus?.focus ?? null;
  const pendingProposalIds = ganttFocus?.pendingProposalIds ?? NO_PROPOSALS;
  const shown = useMemo(() => applyFocus(timeline, focus, pendingProposalIds), [timeline, focus, pendingProposalIds]);

  // An answer about a new date previews it exactly like dragging the wedding day there.
  const dropRef = useRef<(isoDate: string) => void>(() => {});
  useEffect(() => {
    dropRef.current = (isoDate) => void weddingDropped(isoDate);
  });
  const registerPreview = ganttFocus?.registerPreview;
  useEffect(() => {
    if (!registerPreview) return;
    registerPreview((isoDate) => dropRef.current(isoDate));
    return () => registerPreview(null);
  }, [registerPreview]);

  const payments = input.vendors.flatMap((vendor) => vendor.payments);
  const presentStatuses = useMemo(
    () => new Set(Object.values(timeline.details).flatMap((detail) => (detail.kind === "payment" ? [detail.status] : []))),
    [timeline.details],
  );
  const movedCount = payments.filter((p) => p.anchor === "wedding_date").length;

  /** An agent answer's what-if is over once its preview is cancelled or confirmed: drop its banner too. */
  function endAgentPreview() {
    if (ganttFocus?.focus?.previewDate) ganttFocus.setFocus(null);
  }

  function cancel() {
    latestRequest.current += 1;
    setPreview(null);
    setApplyError(null);
    endAgentPreview();
  }

  async function weddingDropped(isoDate: string) {
    if (isoDate === baseIso) return cancel(); // dragged back where it was
    if (isoDate === preview) return;

    const request = ++latestRequest.current;
    setPreview(isoDate);
    setWhatIf({ status: "loading" });
    setExplanation({ status: "none" });
    setApplyError(null);

    const result = await requestWhatIf(isoDate);
    if (request !== latestRequest.current) return;
    setWhatIf(result.ok ? { status: "ready", preview: result.preview } : { status: "error", message: result.message });
    if (!result.ok) return;

    // The table is already on screen; the written summary fills in after it.
    setExplanation({ status: "loading" });
    const summary = await requestExplanation(isoDate);
    if (request !== latestRequest.current) return;
    setExplanation(summary.ok ? { status: "ready", text: summary.text } : { status: "none" });
  }

  async function confirm() {
    if (!preview) return;
    setApplying(true);
    setApplyError(null);
    const result = await requestApply(preview, baseIso);
    if (!result.ok) {
      setApplying(false);
      setApplyError(result.message);
      return;
    }
    toast(result.message);
    endAgentPreview();
    // The page re-renders from the database with the new date; the preview
    // stays on screen until it arrives, so nothing flickers back.
    router.refresh();
  }

  return (
    <section aria-label="Payment timeline" className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl text-ink">Payment timeline</h2>
        {/* The hint and the Print button share the right of the heading, so the legend below gets the whole row. */}
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <p className="text-sm text-muted">
            Click a payment for its clause and Pay button. Drag the <span className="font-medium text-accent">Wedding day</span> to see what moving it
            costs.
          </p>
          <button
            type="button"
            className="btn btn-secondary vw-no-print px-3 py-1 text-xs"
            onClick={() => void printSchedule()}
            disabled={!canPrint || printing}
            title="Print the timeline, or save it as a PDF, for a planner or family"
          >
            {printing ? "Preparing…" : "Print schedule"}
          </button>
        </div>
      </div>
      {focus && ganttFocus && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-1.5 text-sm">
          <span className="text-muted">From your question:</span>
          <span className="font-medium text-ink">{describeFocus(focus)}</span>
          <button
            type="button"
            className="vw-no-print ml-auto text-xs font-medium text-accent-strong underline underline-offset-2 hover:text-ink"
            onClick={() => ganttFocus.setFocus(null)}
          >
            Clear highlight
          </button>
        </div>
      )}
      {/* The chart's payments aren't reachable one by one with Tab (the grid is a single stop), but the Upcoming list below has every one. */}
      <a
        href={`#${PAYMENT_LISTS_ID}`}
        className="vw-skip-link vw-no-print rounded-md bg-surface px-3 py-1 text-sm font-medium text-accent-strong shadow-card"
      >
        Skip the timeline: go to the list of payments
      </a>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <StatusLegend present={presentStatuses} showDeadlines={showDeadlines} />
        <label
          className="vw-no-print flex cursor-pointer items-center gap-2 text-xs font-medium text-muted"
          title={preview ? "Shown while you try a new date, so you can see which deadlines it crosses" : "Each vendor's last day to change the date or cancel at the current terms"}
        >
          <input
            type="checkbox"
            role="switch"
            className="size-3.5 accent-accent"
            checked={showDeadlines}
            disabled={Boolean(preview)}
            onChange={(event) => setDeadlinesOn(event.target.checked)}
          />
          Contract deadlines
        </label>
      </div>

      <div className="relative min-h-0 flex-1">
        <PaymentGantt
          className={className ?? "h-[680px]"}
          data={shown}
          timeRanges={shown.timeRanges}
          focusTaskId={shown.focusTaskId}
          onPaymentSelect={drawer ? (payment) => drawer.openPayment(payment) : undefined}
          onWeddingDateChange={(iso) => void weddingDropped(iso)}
          minWeddingDate={todayIso}
          todayIso={todayIso}
          onPrintReady={onPrintReady}
          coupleNames={input.wedding.coupleNames}
          showDeadlines={showDeadlines}
        />

        {preview && (
          // Floats over the chart, so the reflowed timeline stays in view beside it.
          <div className="animate-fade-up absolute bottom-4 right-4 z-10 max-h-[58%] w-[27rem] max-w-[calc(100%-2rem)] overflow-y-auto rounded-card shadow-float">
            <WhatIfPanel
              currentDate={baseIso}
              newDate={preview}
              shiftDays={daysBetweenUtc(input.wedding.date, utcDay(preview))}
              movedCount={movedCount}
              fixedCount={payments.length - movedCount}
              state={whatIf}
              explanation={explanation}
              applying={applying}
              applyError={applyError}
              onConfirm={() => void confirm()}
              onCancel={cancel}
            />
          </div>
        )}
      </div>
    </section>
  );
}
