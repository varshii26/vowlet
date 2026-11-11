"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { StatusLegend } from "@/components/Gantt/StatusLegend";
import { PaymentGantt } from "@/components/Gantt/PaymentGantt";
import { usePaymentDrawer } from "@/components/Payments/PaymentDrawer";
import { useToast } from "@/components/ui/Toast";
import { WhatIfPanel, type ExplanationState, type WhatIfState } from "@/components/WhatIf/WhatIfPanel";
import { daysBetweenUtc, toIsoDate } from "@/lib/schedule";
import { buildTimeline, withBaseline, type TimelineInput } from "@/lib/timeline";
import { requestApply, requestExplanation, requestWhatIf } from "@/lib/whatif/client";

const utcDay = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

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

  const payments = input.vendors.flatMap((vendor) => vendor.payments);
  const movedCount = payments.filter((p) => p.anchor === "wedding_date").length;

  function cancel() {
    latestRequest.current += 1;
    setPreview(null);
    setApplyError(null);
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
    // The page re-renders from the database with the new date; the preview
    // stays on screen until it arrives, so nothing flickers back.
    router.refresh();
  }

  return (
    <section aria-label="Payment timeline" className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl text-ink">Payment timeline</h2>
        <p className="text-sm text-muted">
          Click a payment for its clause and Pay button. Drag the <span className="font-medium text-accent">Wedding day</span> to see what moving
          the date would cost.
        </p>
      </div>
      <StatusLegend />

      <div className="relative min-h-0 flex-1">
        <PaymentGantt
          className={className ?? "h-[680px]"}
          data={timeline}
          onPaymentSelect={drawer ? (payment) => drawer.openPayment(payment) : undefined}
          onWeddingDateChange={(iso) => void weddingDropped(iso)}
          minWeddingDate={todayIso}
          todayIso={todayIso}
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
