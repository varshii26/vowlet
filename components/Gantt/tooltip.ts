import type { TaskDetail } from "@/lib/timeline";

/** Escape text for use inside HTML. Names and clause text come from contracts. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * HTML for the hover tooltip of a Gantt task. Bryntum tooltips take an HTML
 * string, so every value is escaped here.
 */
export function renderTaskTooltip(detail: TaskDetail | undefined): string {
  if (!detail) return "";

  switch (detail.kind) {
    case "wedding":
      return `<div class="vw-tip"><div class="vw-tip-title">${escapeHtml(detail.title)}</div><div>${escapeHtml(detail.dateLabel)}</div></div>`;

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
          (detail.clausePage ? `<div class="vw-tip-muted">Contract, page ${detail.clausePage}</div>` : "")
        : `<div class="vw-tip-muted">No contract clause linked</div>`;
      return [
        `<div class="vw-tip">`,
        `<div class="vw-tip-title">${escapeHtml(detail.title)}</div>`,
        `<div>${escapeHtml(detail.vendorName)}</div>`,
        `<div class="vw-tip-amount">${escapeHtml(detail.amountLabel)}</div>`,
        `<div>Due ${escapeHtml(detail.dateLabel)}</div>`,
        `<div><span class="vw-tip-status vw-status-${detail.status}">${escapeHtml(detail.statusLabel)}</span></div>`,
        clause,
        `</div>`,
      ].join("");
    }
  }
}
