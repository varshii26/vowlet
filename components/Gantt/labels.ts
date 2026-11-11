import type { TaskDetail } from "@/lib/timeline";

/**
 * Amount labels next to payment milestones, so the timeline reads as a cash
 * plan without hovering. Only money still to pay gets a label: paid, refunded
 * and void payments stay quiet. Plain functions, tested without Bryntum.
 */

const OPEN = new Set(["scheduled", "due_soon", "overdue"]);

/** "$3,000" for a payment still to pay; "" for anything else. */
export function amountLabelFor(detail: TaskDetail | undefined): string {
  return detail?.kind === "payment" && OPEN.has(detail.status) ? detail.amountLabel : "";
}

/** Labels closer than this (px) to the previous one are dropped, so they never overlap. */
export const MIN_LABEL_GAP_PX = 44;

export type RollupLabel = { text: string; x: number; status: string };

/**
 * Labels for the payment diamonds rolled up into a collapsed vendor row.
 * `payments` are the vendor's payments with their x offset (px) from the
 * start of the vendor's bar. Left to right; a label that would crowd the one
 * before it is left out (its diamond still has a tooltip).
 */
export function rollupLabels(payments: { detail: TaskDetail | undefined; x: number }[]): RollupLabel[] {
  const labels: RollupLabel[] = [];
  for (const { detail, x } of [...payments].sort((a, b) => a.x - b.x)) {
    const text = amountLabelFor(detail);
    if (!text || detail?.kind !== "payment") continue;
    const previous = labels.at(-1);
    if (previous && x - previous.x < MIN_LABEL_GAP_PX) continue;
    labels.push({ text, x, status: detail.status });
  }
  return labels;
}
