import { daysBetweenUtc } from "@/lib/schedule";
import type { PreviousDate, TaskDetail } from "@/lib/timeline";

const utcDay = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Escape text for use inside HTML. Names and clause text come from contracts. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "Was Mar 18, now May 13 (+56 days)": a what-if move, from the old date to the new one. */
export function describeMove(was: PreviousDate, nowIso: string): string {
  const n = Math.abs(was.shiftDays);
  const sign = was.shiftDays > 0 ? "+" : "−";
  const now = utcDay(nowIso).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  return `Was ${was.dateLabel}, now ${now} (${sign}${n} day${n === 1 ? "" : "s"})`;
}

const moveLine = (was: PreviousDate | undefined, nowIso: string | undefined) =>
  was && nowIso ? `<div class="vw-tip-move">${escapeHtml(describeMove(was, nowIso))}</div>` : "";

/**
 * HTML for the hover tooltip of a Gantt task. Bryntum tooltips take an HTML
 * string, so every value is escaped here.
 */
export function renderTaskTooltip(detail: TaskDetail | undefined, isoDate?: string): string {
  if (!detail) return "";

  switch (detail.kind) {
    case "wedding":
      return `<div class="vw-tip"><div class="vw-tip-title">${escapeHtml(detail.title)}</div><div>${escapeHtml(detail.dateLabel)}</div>${moveLine(detail.was, detail.isoDate)}</div>`;

    case "vendor":
      return [
        `<div class="vw-tip">`,
        `<div class="vw-tip-title">${escapeHtml(detail.title)}</div>`,
        `<div>Contract total ${escapeHtml(detail.amountLabel)}</div>`,
        `<div class="vw-tip-muted">${escapeHtml(detail.summary)}</div>`,
        `</div>`,
      ].join("");

    case "payment": {
      const clause = detail.clauseSummary
        ? `<div class="vw-tip-clause">${escapeHtml(detail.clauseSummary)}</div>` +
          (detail.clausePage ? `<div class="vw-tip-muted">Contract, page ${detail.clausePage}</div>` : "") +
          (detail.clauseId ? `<div class="vw-tip-muted">Click to see the clause and pay</div>` : "")
        : `<div class="vw-tip-muted">No contract clause linked</div>`;
      return [
        `<div class="vw-tip">`,
        `<div class="vw-tip-title">${escapeHtml(detail.title)}</div>`,
        `<div>${escapeHtml(detail.vendorName)}</div>`,
        `<div class="vw-tip-amount">${escapeHtml(detail.amountLabel)}</div>`,
        `<div>Due ${escapeHtml(detail.dateLabel)}</div>`,
        moveLine(detail.was, isoDate),
        `<div><span class="vw-tip-status vw-status-${detail.status}">${escapeHtml(detail.statusLabel)}</span></div>`,
        clause,
        `</div>`,
      ].join("");
    }
  }
}

/** HTML for the tooltip on a what-if ghost: where the milestone sat before the preview. */
export function renderBaselineTip(detail: TaskDetail | undefined): string {
  if (!detail || detail.kind === "vendor" || !detail.was) return "";
  return [
    `<div class="vw-tip">`,
    `<div class="vw-tip-title">${escapeHtml(detail.title)}</div>`,
    `<div>Before this what-if: ${escapeHtml(detail.was.dateLabel)}</div>`,
    `<div class="vw-tip-muted">Cancel puts it back here; confirm makes the new date stick.</div>`,
    `</div>`,
  ].join("");
}

const longDay = (iso: string) =>
  utcDay(iso).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

/** "56 days later", "3 days earlier", "Same day". */
export function describeShift(days: number): string {
  if (days === 0) return "Same day";
  const n = Math.abs(days);
  return `${n} day${n === 1 ? "" : "s"} ${days > 0 ? "later" : "earlier"}`;
}

/** HTML for the tooltip that follows the "Wedding day" milestone while it is dragged. */
export function renderWeddingDragTip(detail: TaskDetail | undefined, newIsoDate: string, valid: boolean): string {
  const shift = detail?.kind === "wedding" ? describeShift(daysBetweenUtc(utcDay(detail.isoDate), utcDay(newIsoDate))) : "";
  return [
    `<div class="vw-tip">`,
    `<div class="vw-tip-title">Move the wedding to ${escapeHtml(longDay(newIsoDate))}</div>`,
    shift ? `<div>${escapeHtml(shift)}</div>` : "",
    `<div class="vw-tip-muted">${valid ? "Drop to see every payment move and what each vendor charges." : "The wedding can't move into the past."}</div>`,
    `</div>`,
  ].join("");
}
