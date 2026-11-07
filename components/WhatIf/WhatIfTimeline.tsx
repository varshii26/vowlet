"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { PaymentGantt } from "@/components/Gantt/PaymentGantt";
import { WhatIfPanel, type ExplanationState, type WhatIfState } from "@/components/WhatIf/WhatIfPanel";
import { daysBetweenUtc, toIsoDate } from "@/lib/schedule";
import { buildTimeline, type TimelineInput } from "@/lib/timeline";
import { requestApply, requestExplanation, requestWhatIf } from "@/lib/whatif/client";

const utcDay = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

type Props = {
  input: TimelineInput;
  /** `YYYY-MM-DD`, from the server, so the browser and server agree on "today". */
  todayIso: string;
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
export function WhatIfTimeline({ input, todayIso }: Props) {
  const router = useRouter();
  const baseIso = toIsoDate(input.wedding.date);

  const [preview, setPreview] = useState<string | null>(null);
  const [whatIf, setWhatIf] = useState<WhatIfState>({ status: "loading" });
  const [explanation, setExplanation] = useState<ExplanationState>({ status: "none" });
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
  const timeline = useMemo(
    () => buildTimeline(preview ? { ...input, wedding: { ...input.wedding, date: utcDay(preview) } } : input, today),
    [input, preview, today],
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
    setNotice(null);

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
    setNotice(result.message);
    // The page re-renders from the database with the new date; the preview
    // stays on screen until it arrives, so nothing flickers back.
    router.refresh();
  }

  return (
    <section aria-label="Payment timeline" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-xl font-semibold">Payment timeline</h2>
        <p className="text-sm text-neutral-600">Drag the pink Wedding day milestone to see what moving the date would cost.</p>
      </div>

      {notice && (
        <div role="status" className="flex items-start justify-between gap-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {preview && (
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
      )}

      <PaymentGantt data={timeline} onWeddingDateChange={(iso) => void weddingDropped(iso)} minWeddingDate={todayIso} />
    </section>
  );
}
