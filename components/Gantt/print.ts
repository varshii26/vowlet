import { escapeHtml } from "@/components/Gantt/tooltip";

/**
 * Printing the payment schedule (Enterprise Print feature: the browser's print
 * dialog, no export server). Bryntum renders the chart into its own iframe, so
 * nothing else on the page (agent panel, drawer) ends up on paper. Plain
 * functions, tested without Bryntum.
 */

/** What `features.print.print()` is called with. */
export const PRINT_OPTIONS = {
  // Fit the full width of the chart to the page, and run onto as many pages
  // as the rows need: a long list prints, nothing is cut off on the right.
  exporterType: "multipagevertical",
  orientation: "landscape",
  paperFormat: "Letter",
  // Every date from the first payment to after the wedding, every row.
  scheduleRange: "completeview",
  rowsRange: "all",
  repeatHeader: true,
  // Start each page on a whole row, so no row is cut in half at a page break.
  alignRows: true,
} as const;

const longDay = (iso: string) =>
  new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });

/**
 * The header on every printed page. Bryntum takes an HTML string; the couple's
 * names come from the database, so everything is escaped.
 */
export function renderPrintHeader(coupleNames: string, weddingIso: string, todayIso: string): string {
  return [
    `<div class="vw-print-header" style="display:flex;justify-content:space-between;align-items:baseline;padding:8px 0;font-family:system-ui,sans-serif">`,
    `<div><div style="font-size:18px;font-weight:600">${escapeHtml(coupleNames)}: payment schedule</div>`,
    `<div style="font-size:12px;color:#6b5f57">Wedding day ${escapeHtml(longDay(weddingIso))}</div></div>`,
    `<div style="font-size:12px;color:#6b5f57">As of ${escapeHtml(longDay(todayIso))}</div>`,
    `</div>`,
  ].join("");
}

/** The footer on every printed page. */
export function renderPrintFooter(currentPage: number, totalPages: number): string {
  return `<div class="vw-print-footer" style="text-align:center;font-size:11px;color:#6b5f57;font-family:system-ui,sans-serif;padding:6px 0">Vowlet · Page ${currentPage + 1} of ${totalPages}</div>`;
}
