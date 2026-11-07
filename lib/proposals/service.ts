import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { formatCents } from "@/lib/money";
import { parsePayload, type ProposalKind } from "@/lib/proposals/payloads";
import { toProposalView } from "@/lib/proposals/view";
import { daysBetweenUtc, toIsoDate } from "@/lib/schedule";

/**
 * Approve or dismiss a proposal the agent recorded. This is the only place a
 * proposal turns into anything, and only a human click gets here.
 *
 * Each kind does what the spec says and no more:
 * - pay: approving never pays. The PayPal popup is the approval, so this only
 *   records the approval once the payment really is paid.
 * - reschedule: moves the wedding date; every payment date follows, because due
 *   dates are computed from it.
 * - refund_request: marks the vendor cancelled and its paid payments
 *   `refund_requested`, and hands back the drafted message. Nothing is sent and
 *   no refund is issued.
 * - message: just acknowledged.
 *
 * A proposal is resolved exactly once: repeating the same action is a no-op and
 * the opposite action is refused. A failed approval leaves everything unchanged.
 */

export type ResolveAction = "approve" | "dismiss";

export type ResolveFailureCode = "not_found" | "conflict" | "not_paid" | "stale" | "in_past" | "nothing_paid" | "invalid_payload";

export type ResolveResult =
  | {
      ok: true;
      status: "approved" | "dismissed";
      /** Plain words for the couple. */
      message: string;
      /** For an approved refund request: the drafted message to copy and send. */
      draft?: string;
      /** True when this action had already been done: nothing changed. */
      alreadyResolved?: boolean;
    }
  | { ok: false; code: ResolveFailureCode; message: string; status: number };

/** Thrown inside the transaction to undo it and report why. */
class Refusal extends Error {
  constructor(
    readonly code: ResolveFailureCode,
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

const refusal = (r: Refusal): ResolveResult => ({ ok: false, code: r.code, message: r.message, status: r.status });

type Effect = { message: string; draft?: string };

export async function resolveProposal(
  prisma: PrismaClient,
  proposalId: string,
  action: ResolveAction,
  now: Date = new Date(),
): Promise<ResolveResult> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) return { ok: false, code: "not_found", message: "That proposal doesn't exist.", status: 404 };

  const target = action === "approve" ? "approved" : "dismissed";
  if (proposal.status !== "pending") {
    return proposal.status === target
      ? { ok: true, status: target, message: `This proposal was already ${target}.`, alreadyResolved: true }
      : { ok: false, code: "conflict", message: `This proposal was already ${proposal.status}.`, status: 409 };
  }

  try {
    return await prisma.$transaction(async (tx): Promise<ResolveResult> => {
      // Claim it first: of two simultaneous clicks, exactly one gets past here.
      const claimed = await tx.proposal.updateMany({ where: { id: proposalId, status: "pending" }, data: { status: target } });
      if (claimed.count === 0) {
        const now2 = await tx.proposal.findUniqueOrThrow({ where: { id: proposalId } });
        return now2.status === target
          ? { ok: true, status: target, message: `This proposal was already ${target}.`, alreadyResolved: true }
          : { ok: false, code: "conflict", message: `This proposal was already ${now2.status}.`, status: 409 };
      }

      if (action === "dismiss") {
        await tx.eventLog.create({ data: { weddingId: proposal.weddingId, type: "proposal_dismissed", message: `Dismissed: ${toProposalView({ ...proposal, clause: null }).title}` } });
        return { ok: true, status: "dismissed", message: "Dismissed. Nothing was changed." };
      }

      const effect = await applyApproval(tx, proposal.weddingId, proposal.kind, proposal.payload, now);
      await tx.eventLog.create({ data: { weddingId: proposal.weddingId, type: "proposal_approved", message: effect.message } });
      return { ok: true, status: "approved", message: effect.message, ...(effect.draft ? { draft: effect.draft } : {}) };
    });
  } catch (error) {
    if (error instanceof Refusal) return refusal(error); // the transaction was rolled back: the proposal is still pending
    throw error;
  }
}

async function applyApproval(tx: Prisma.TransactionClient, weddingId: string, kind: ProposalKind, raw: unknown, now: Date): Promise<Effect> {
  const parsed = parsePayload(kind, raw);
  if (!parsed) throw new Refusal("invalid_payload", "This proposal's details are unreadable, so it can't be approved.", 422);

  switch (parsed.kind) {
    case "pay": {
      const p = parsed.payload;
      const payment = await tx.payment.findUnique({ where: { id: p.paymentId } });
      // Approving must never pay. The payment has to have gone through PayPal already.
      if (!payment || payment.status !== "paid") {
        throw new Refusal("not_paid", "This payment hasn't been made yet. Pay with PayPal, and the proposal is approved once it goes through.");
      }
      return { message: `Approved. ${formatCents(p.amountCents)} was paid to ${p.vendorName} (${p.label}).` };
    }

    case "reschedule": {
      const p = parsed.payload;
      const wedding = await tx.wedding.findUniqueOrThrow({ where: { id: weddingId } });
      if (toIsoDate(wedding.date) !== p.previousDate) {
        throw new Refusal("stale", `The wedding date has changed since this was proposed (it is now ${toIsoDate(wedding.date)}), so it can't be applied.`);
      }
      const newDate = new Date(`${p.newDate}T00:00:00.000Z`);
      if (Number.isNaN(newDate.getTime())) throw new Refusal("invalid_payload", "The proposed date is unreadable.", 422);
      if (daysBetweenUtc(now, newDate) < 0) throw new Refusal("in_past", `${p.newDate} has passed, so the wedding can't be moved there.`);

      await tx.wedding.update({ where: { id: weddingId }, data: { date: newDate } });
      // Other pending date changes were worked out against the old date, so they no longer apply.
      await tx.proposal.updateMany({ where: { weddingId, kind: "reschedule", status: "pending" }, data: { status: "dismissed" } });
      return {
        message: `Approved. The wedding is now on ${p.newDate} and every payment date has moved with it${p.totalCostCents > 0 ? `. Vendor change fees come to ${formatCents(p.totalCostCents)}` : ""}.`,
      };
    }

    case "refund_request": {
      const p = parsed.payload;
      const paid = await tx.payment.findMany({ where: { vendorId: p.vendorId, status: "paid" } });
      if (paid.length === 0) throw new Refusal("nothing_paid", `Nothing has been paid to ${p.vendorName}, so there is nothing to ask for back.`);

      await tx.payment.updateMany({ where: { vendorId: p.vendorId, status: "paid" }, data: { status: "refund_requested" } });
      await tx.vendor.update({ where: { id: p.vendorId }, data: { status: "cancelled" } });
      return {
        message: `Approved. ${p.vendorName} is marked cancelled, and ${paid.length === 1 ? "the payment" : `${paid.length} payments`} to them ${paid.length === 1 ? "is" : "are"} now marked refund requested. Copy the message below and send it to the vendor: nothing has been sent for you.`,
        draft: p.message,
      };
    }

    case "message":
      return { message: "Noted." };
  }
}
