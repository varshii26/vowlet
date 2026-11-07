import type { PrismaClient } from "@/generated/prisma/client";
import { computeRefund } from "@/lib/agent/tools/compute";
import { citation } from "@/lib/agent/tools/data";
import { proposeAction } from "@/lib/agent/tools/propose";
import { ToolError } from "@/lib/agent/tools/types";
import { formatCents } from "@/lib/money";
import { resolveProposal } from "@/lib/proposals/service";
import { startOfUtcDay, toIsoDate } from "@/lib/schedule";
import type { CancelledBy } from "@/lib/terms";

/**
 * Cancelling a vendor from the vendor page (the CancelModal). The amount owed
 * back is `refundOwed()` from lib/terms.ts, the same function the agent's
 * compute_refund_owed tool uses, and the drafted request is written here, in
 * code, from those numbers and the clause. Nothing is sent and no refund is
 * issued: confirming marks the vendor cancelled and, when money is owed back,
 * records a refund request and approves it through the same path as an agent
 * proposal card, so its paid payments become `refund_requested`.
 */

export type CancelPreview = {
  vendorId: string;
  vendorName: string;
  cancelledBy: CancelledBy;
  cancellationDate: string;
  owedCents: number;
  paidCents: number;
  retainedCents: number;
  noticeDays: number;
  /** The calculation in words, from lib/terms.ts. */
  reason: string;
  clauseId: string | null;
  /** "Bloom & Thistle Florals contract, page 2", or null when there is no cancellation clause. */
  citation: string | null;
  /** The cancellation clause as quoted in the contract. */
  clause: { text: string; page: number } | null;
  /** The refund request to copy and send; null when nothing is owed back. */
  draft: string | null;
};

export type CancelFailureCode = "not_found" | "already_cancelled" | "conflict";
export type CancelFailure = { ok: false; code: CancelFailureCode; message: string; status: number };

export type CancelConfirmed = {
  ok: true;
  message: string;
  /** The refund request to copy and send; null when nothing is owed back. */
  draft: string | null;
  owedCents: number;
};

type DraftInput = {
  vendorName: string;
  coupleNames: string;
  weddingDate: string;
  cancelledBy: CancelledBy;
  owedCents: number;
  paidCents: number;
  reason: string;
  citation: string | null;
};

/** The refund request, written from computed numbers only. */
export function draftRefundRequest(d: DraftInput): string {
  const opening =
    d.cancelledBy === "vendor"
      ? `Following your cancellation of our booking for our wedding on ${d.weddingDate}, we are writing to request a refund.`
      : `We are sorry to let you know that we need to cancel our booking for our wedding on ${d.weddingDate}, and we are writing to request the refund due.`;
  const terms = d.citation ? `Under the cancellation terms in our contract (${d.citation})` : "Under the cancellation terms in our contract";
  const basis =
    d.cancelledBy === "vendor"
      ? `${terms}, as the cancellation came from you, the full ${formatCents(d.paidCents)} we have paid is owed back.`
      : `${terms}, the refund due works out as ${d.reason}`;
  return [
    `Dear ${d.vendorName},`,
    "",
    opening,
    "",
    basis,
    "",
    `Please refund ${formatCents(d.owedCents)} to the PayPal account we paid from, and let us know when it has been sent.`,
    "",
    "Thank you,",
    d.coupleNames,
  ].join("\n");
}

/** What cancelling this vendor today would mean. Changes nothing. */
export async function previewCancellation(
  prisma: PrismaClient,
  vendorId: string,
  cancelledBy: CancelledBy,
  now: Date,
): Promise<({ ok: true } & CancelPreview) | CancelFailure> {
  const today = startOfUtcDay(now);
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) return { ok: false, code: "not_found", message: "That vendor doesn't exist.", status: 404 };
  if (vendor.status === "cancelled") return { ok: false, code: "already_cancelled", message: `${vendor.name} is already cancelled.`, status: 409 };

  const { wedding, result } = await computeRefund(prisma, vendor.id, cancelledBy, today);
  const clause = result.clauseId ? await prisma.clause.findUnique({ where: { id: result.clauseId } }) : null;
  const cite = clause ? citation(vendor.name, clause.page) : null;

  return {
    ok: true,
    vendorId: vendor.id,
    vendorName: vendor.name,
    cancelledBy,
    cancellationDate: toIsoDate(today),
    owedCents: result.owedCents,
    paidCents: result.paidCents,
    retainedCents: result.retainedCents,
    noticeDays: result.noticeDays,
    reason: result.reason,
    clauseId: result.clauseId,
    citation: cite,
    clause: clause ? { text: clause.text, page: clause.page } : null,
    draft:
      result.owedCents > 0
        ? draftRefundRequest({
            vendorName: vendor.name,
            coupleNames: wedding.coupleNames,
            weddingDate: toIsoDate(wedding.date),
            cancelledBy,
            owedCents: result.owedCents,
            paidCents: result.paidCents,
            reason: result.reason,
            citation: cite,
          })
        : null,
  };
}

export const CANCEL_REASON = "Cancelled from the vendor page.";

/** The couple confirmed the cancellation in the CancelModal. */
export async function confirmCancellation(
  prisma: PrismaClient,
  vendorId: string,
  cancelledBy: CancelledBy,
  now: Date,
): Promise<CancelConfirmed | CancelFailure> {
  const preview = await previewCancellation(prisma, vendorId, cancelledBy, now);
  if (!preview.ok) return preview;
  const who = cancelledBy === "vendor" ? `${preview.vendorName} cancelled` : `Cancelled ${preview.vendorName}`;

  if (preview.owedCents === 0 || preview.draft === null) {
    await prisma.$transaction(async (tx) => {
      const vendor = await tx.vendor.update({ where: { id: preview.vendorId }, data: { status: "cancelled" } });
      await tx.eventLog.create({ data: { weddingId: vendor.weddingId, type: "vendor_cancelled", message: `${who}. Nothing is owed back.` } });
    });
    return { ok: true, message: `${preview.vendorName} is marked cancelled. Nothing is owed back: ${preview.reason}`, draft: null, owedCents: 0 };
  }

  let proposalId: string;
  try {
    const recorded = (await proposeAction.execute(
      { kind: "refund_request", vendorId: preview.vendorId, cancelledBy, message: preview.draft, reason: CANCEL_REASON },
      { prisma, today: startOfUtcDay(now) },
    )) as { proposalId: string };
    proposalId = recorded.proposalId;
  } catch (error) {
    if (error instanceof ToolError) return { ok: false, code: "conflict", message: error.message, status: 409 };
    throw error;
  }

  const resolved = await resolveProposal(prisma, proposalId, "approve", now);
  if (!resolved.ok) return { ok: false, code: "conflict", message: resolved.message, status: resolved.status };
  return {
    ok: true,
    message: `${preview.vendorName} is marked cancelled and ${formatCents(preview.owedCents)} is owed back. Copy the request below and send it yourself: nothing has been sent.`,
    draft: preview.draft,
    owedCents: preview.owedCents,
  };
}
