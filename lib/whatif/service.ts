import type { PrismaClient } from "@/generated/prisma/client";
import { computeDateChange } from "@/lib/agent/tools/compute";
import { proposeAction } from "@/lib/agent/tools/propose";
import { ToolError, parseIsoDate } from "@/lib/agent/tools/types";
import { formatCents } from "@/lib/money";
import { resolveProposal } from "@/lib/proposals/service";
import type { DateChangeRule } from "@/lib/rules";
import { daysBetweenUtc, startOfUtcDay, toIsoDate } from "@/lib/schedule";

/**
 * The drag-the-wedding-day what-if. Previewing is read-only and pure code
 * (`dateChangeCost()` in lib/terms.ts via computeDateChange), so no LLM sits in
 * the hot path. Applying is the couple's explicit confirmation: it records a
 * `reschedule` proposal and approves it through the same path as an agent
 * proposal card, so the stale-date and past-date checks and the activity log
 * are shared.
 */

/**
 * - fee: the contract charges for this move
 * - free: the contract's terms make this move free
 * - check: no date-change terms apply, so the couple should read the contract (never shown as free)
 * - cancelled: the vendor is cancelled, so nothing is owed
 */
export type WhatIfRowKind = "fee" | "free" | "check" | "cancelled";

export type WhatIfRow = {
  vendorId: string;
  kind: WhatIfRowKind;
  vendorName: string;
  costCents: number;
  /** The full computed explanation, including the notice ("... with 161 days' notice."). Used by the summary. */
  reason: string;
  /**
   * The same, without the notice, which is the same for every row and is shown
   * once in the panel: "15% of the contract plus a $150 flat fee",
   * "Free with at least 60 days' notice".
   */
  basis: string;
  clauseId: string | null;
  /** "Grand Oak Estate contract, page 2", or null when there is no date-change clause. */
  citation: string | null;
  /** The date-change clause, quoted from the contract, so the couple can read the source of the number. */
  clause: { text: string; page: number } | null;
};

export type WhatIfPreview = {
  currentDate: string;
  newDate: string;
  /** Days the wedding moves: positive is later. */
  shiftDays: number;
  /**
   * Days from today to the CURRENT wedding date: the notice the vendors get.
   * Every contract prices a date change by this, so it is the same whatever
   * new date is picked.
   */
  noticeDays: number;
  totalCents: number;
  /** The wedding's total cost after the move, against the budget (lib/budget.ts budgetImpact). */
  budget: { budgetCents: number; projectedCents: number; overByCents: number };
  rows: WhatIfRow[];
};

export type WhatIfFailureCode = "no_wedding" | "in_past" | "unchanged" | "stale";

export type WhatIfFailure = { ok: false; code: WhatIfFailureCode; message: string; status: number };

const failure = (code: WhatIfFailureCode, message: string, status = 400): WhatIfFailure => ({ ok: false, code, message, status });

/** What the fee is made of, from the tier that applied. Without a tier, the computed reason as is. */
export function feeBasis(rule: DateChangeRule | null, costCents: number, reason: string): string {
  if (!rule) return reason;
  if (costCents === 0) return `Free with at least ${rule.minNoticeDays} days' notice`;
  const parts: string[] = [];
  if (rule.feePercent > 0) parts.push(`${rule.feePercent}% of the contract`);
  if (rule.flatFee > 0) parts.push(`a ${formatCents(rule.flatFee)} flat fee`);
  return parts.join(" plus ");
}

async function currentWedding(prisma: PrismaClient) {
  return prisma.wedding.findFirst();
}

/** Per-vendor date-change costs if the wedding moved to `newDate` (YYYY-MM-DD). Changes nothing. */
export async function previewDateChange(
  prisma: PrismaClient,
  newDate: string,
  now: Date,
): Promise<({ ok: true } & WhatIfPreview) | WhatIfFailure> {
  const today = startOfUtcDay(now);
  const target = parseIsoDate(newDate);
  const wedding = await currentWedding(prisma);
  if (!wedding) return failure("no_wedding", "There is no wedding set up yet.", 404);
  if (daysBetweenUtc(today, target) < 0) return failure("in_past", `${newDate} has already passed. Pick a date from today on.`);

  const { result, citations, vendors, budget } = await computeDateChange(prisma, target, today);
  const clauses = new Map(vendors.flatMap((v) => (v.clauses[0] ? [[v.id, { text: v.clauses[0].text, page: v.clauses[0].page }] as const] : [])));
  const cancelled = new Set(vendors.filter((v) => v.status === "cancelled").map((v) => v.id));
  const kindOf = (row: (typeof result.rows)[number]): WhatIfRowKind =>
    cancelled.has(row.vendorId) ? "cancelled" : row.costCents > 0 ? "fee" : row.appliedRule ? "free" : "check";
  return {
    ok: true,
    currentDate: toIsoDate(wedding.date),
    newDate,
    shiftDays: daysBetweenUtc(wedding.date, target),
    noticeDays: Math.max(0, daysBetweenUtc(today, wedding.date)),
    totalCents: result.totalCents,
    budget: { budgetCents: budget.budgetCents, projectedCents: budget.projectedCents, overByCents: budget.overByCents },
    rows: result.rows.map((row) => ({
      vendorId: row.vendorId,
      kind: kindOf(row),
      vendorName: row.vendorName,
      costCents: row.costCents,
      reason: row.reason,
      basis: feeBasis(row.appliedRule, row.costCents, row.reason),
      clauseId: row.clauseId,
      citation: citations.get(row.vendorId) ?? null,
      clause: clauses.get(row.vendorId) ?? null,
    })),
  };
}

export const DRAG_REASON = "Moved by dragging the wedding day on the timeline.";

/**
 * Move the wedding to `newDate`, as the couple just confirmed. `previousDate`
 * is the date the couple was looking at: if the wedding has moved since (another
 * tab, an agent proposal), nothing is changed.
 */
export async function applyDateChange(
  prisma: PrismaClient,
  input: { newDate: string; previousDate: string },
  now: Date,
): Promise<{ ok: true; message: string; proposalId: string } | WhatIfFailure> {
  const today = startOfUtcDay(now);
  const wedding = await currentWedding(prisma);
  if (!wedding) return failure("no_wedding", "There is no wedding set up yet.", 404);

  const current = toIsoDate(wedding.date);
  if (current !== input.previousDate) {
    return failure("stale", `The wedding date has changed since you started (it is now ${current}). Nothing was changed.`, 409);
  }
  if (current === input.newDate) return failure("unchanged", `${input.newDate} is already the wedding date.`);
  if (daysBetweenUtc(today, parseIsoDate(input.newDate)) < 0) {
    return failure("in_past", `${input.newDate} has already passed. Pick a date from today on.`);
  }

  let proposalId: string;
  try {
    const recorded = (await proposeAction.execute({ kind: "reschedule", newDate: input.newDate, reason: DRAG_REASON }, { prisma, today })) as {
      proposalId: string;
    };
    proposalId = recorded.proposalId;
  } catch (error) {
    if (error instanceof ToolError) return failure("unchanged", error.message);
    throw error;
  }

  const resolved = await resolveProposal(prisma, proposalId, "approve", now);
  if (!resolved.ok) {
    return failure(resolved.code === "in_past" ? "in_past" : "stale", resolved.message, resolved.status);
  }
  return { ok: true, message: resolved.message, proposalId };
}
