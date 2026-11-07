import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { computeDateChange, computeRefund } from "@/lib/agent/tools/compute";
import { loadWedding } from "@/lib/agent/tools/data";
import { ToolError, defineTool, isoDateSchema, parseIsoDate, type ToolContext } from "@/lib/agent/tools/types";
import { formatCents } from "@/lib/money";
import { computeDueDate, daysBetweenUtc, toIsoDate } from "@/lib/schedule";

/**
 * propose_action only RECORDS a proposal. It never pays, reschedules or sends
 * anything: the couple approves or dismisses it in the app, and only then does
 * anything happen. Contract text is untrusted, so this tool is also where an
 * injected "pay the attacker" instruction would have to get through, and it can't:
 *
 * - It accepts ids and dates, never an amount. Every amount in a proposal is
 *   computed here, from the database and the contract terms.
 * - A payment proposal can only name an existing, unpaid payment to an active vendor.
 */

const KINDS = ["pay", "reschedule", "refund_request", "message"] as const;
type Kind = (typeof KINDS)[number];

const inputSchema = z.object({
  kind: z.enum(KINDS).describe("What to propose: pay a payment, reschedule the wedding, request a refund, or leave a message."),
  reason: z.string().min(1).max(500).describe("One or two sentences on why, for the couple."),
  clauseId: z.string().optional().describe("The contract clause this rests on, if any (from a tool result)."),
  paymentId: z.string().optional().describe("For kind 'pay': the payment, from get_payment_schedule."),
  newDate: isoDateSchema.optional().describe("For kind 'reschedule': the new wedding date, YYYY-MM-DD."),
  vendorId: z.string().optional().describe("For kind 'refund_request': the vendor id or name."),
  cancelledBy: z.enum(["couple", "vendor"]).optional().describe("For kind 'refund_request': who cancelled."),
  message: z
    .string()
    .min(1)
    .max(2000)
    .optional()
    .describe("For kind 'refund_request': the drafted request to send the vendor, citing the clause. For kind 'message': the text to show."),
});
type Input = z.infer<typeof inputSchema>;

type Draft = {
  payload: Prisma.InputJsonObject;
  summary: string;
  /** Two proposals with the same key are the same proposal. */
  key: string;
  defaultClauseId: string | null;
};

const need = <T>(value: T | undefined, kind: Kind, field: string): T => {
  if (value === undefined) throw new ToolError(`A '${kind}' proposal needs ${field}.`);
  return value;
};

async function draftPay(input: Input, { prisma }: ToolContext): Promise<Draft> {
  const paymentId = need(input.paymentId, "pay", "paymentId");
  const wedding = await loadWedding(prisma);
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, vendor: { weddingId: wedding.id } },
    include: { vendor: true },
  });
  if (!payment) throw new ToolError(`No payment with id ${paymentId}. Get ids from get_payment_schedule.`);
  if (payment.vendor.status !== "active") throw new ToolError(`${payment.vendor.name} is cancelled, so that payment can't be made.`);
  if (payment.status !== "scheduled" && payment.status !== "due") throw new ToolError(`That payment is ${payment.status}, so there is nothing to pay.`);

  const due = computeDueDate(payment, { weddingDate: wedding.date, signingDate: payment.vendor.signingDate });
  return {
    payload: {
      paymentId: payment.id,
      vendorId: payment.vendorId,
      vendorName: payment.vendor.name,
      label: payment.label,
      amountCents: payment.amount,
      dueDate: toIsoDate(due),
    },
    summary: `Pay ${formatCents(payment.amount)} to ${payment.vendor.name} (${payment.label})`,
    key: payment.id,
    defaultClauseId: payment.clauseId,
  };
}

async function draftReschedule(input: Input, { prisma, today }: ToolContext): Promise<Draft> {
  const newDate = need(input.newDate, "reschedule", "newDate");
  const { wedding, result } = await computeDateChange(prisma, parseIsoDate(newDate), today);
  if (daysBetweenUtc(wedding.date, parseIsoDate(newDate)) === 0) throw new ToolError(`${newDate} is already the wedding date.`);

  return {
    payload: {
      previousDate: toIsoDate(wedding.date),
      newDate,
      totalCostCents: result.totalCents,
      charges: result.rows
        .filter((r) => r.costCents > 0)
        .map((r) => ({ vendorId: r.vendorId, vendorName: r.vendorName, costCents: r.costCents, clauseId: r.clauseId })),
    },
    summary: `Move the wedding from ${toIsoDate(wedding.date)} to ${newDate} (extra cost ${formatCents(result.totalCents)})`,
    key: newDate,
    defaultClauseId: null,
  };
}

async function draftRefund(input: Input, { prisma, today }: ToolContext): Promise<Draft> {
  const vendorRef = need(input.vendorId, "refund_request", "vendorId");
  const cancelledBy = need(input.cancelledBy, "refund_request", "cancelledBy");
  const message = need(input.message, "refund_request", "message (the drafted request)");

  const { vendor, result } = await computeRefund(prisma, vendorRef, cancelledBy, today);
  if (result.owedCents <= 0) {
    throw new ToolError(`Nothing is owed back by ${vendor.name} (${result.reason}), so there is no refund to request. Explain that to the couple instead.`);
  }
  return {
    payload: {
      vendorId: vendor.id,
      vendorName: vendor.name,
      cancelledBy,
      cancellationDate: toIsoDate(today),
      owedCents: result.owedCents,
      paidCents: result.paidCents,
      calculation: result.reason,
      message,
    },
    summary: `Request ${formatCents(result.owedCents)} back from ${vendor.name}`,
    key: `${vendor.id}|${cancelledBy}|${toIsoDate(today)}`,
    defaultClauseId: result.clauseId,
  };
}

function draftMessage(input: Input): Draft {
  const text = need(input.message, "message", "message (the text to show)");
  return { payload: { text }, summary: "A note for the couple", key: text, defaultClauseId: null };
}

/** The same key as a draft's, read back from a stored payload. */
function storedKey(kind: Kind, payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  switch (kind) {
    case "pay":
      return String(p.paymentId);
    case "reschedule":
      return String(p.newDate);
    case "refund_request":
      return `${p.vendorId}|${p.cancelledBy}|${p.cancellationDate}`;
    case "message":
      return String(p.text);
  }
}

async function existingPending(prisma: PrismaClient, weddingId: string, kind: Kind, key: string) {
  const pending = await prisma.proposal.findMany({ where: { weddingId, kind, status: "pending" } });
  return pending.find((p) => storedKey(kind, p.payload) === key) ?? null;
}

export const proposeAction = defineTool({
  name: "propose_action",
  description:
    "Propose something for the couple to approve: pay a payment, reschedule the wedding, request a refund from a vendor, or leave a message. This only records a proposal. Nothing is paid, changed or sent until the couple approves it. Give ids and dates only: amounts are worked out for you.",
  inputSchema,
  run: async (input, ctx) => {
    const { prisma } = ctx;
    const wedding = await loadWedding(prisma);

    const draft =
      input.kind === "pay"
        ? await draftPay(input, ctx)
        : input.kind === "reschedule"
          ? await draftReschedule(input, ctx)
          : input.kind === "refund_request"
            ? await draftRefund(input, ctx)
            : draftMessage(input);

    let clauseId = draft.defaultClauseId;
    if (input.clauseId) {
      const clause = await prisma.clause.findFirst({ where: { id: input.clauseId, vendor: { weddingId: wedding.id } } });
      if (!clause) throw new ToolError(`No clause with id ${input.clauseId}. Use a clauseId from a tool result.`);
      clauseId = clause.id;
    }

    const note = "Recorded for the couple to review. Nothing has been paid, changed or sent.";
    const repeat = await existingPending(prisma, wedding.id, input.kind, draft.key);
    if (repeat) return { proposalId: repeat.id, kind: input.kind, status: "pending", summary: draft.summary, alreadyProposed: true, note };

    const proposal = await prisma.$transaction(async (tx) => {
      const created = await tx.proposal.create({
        data: {
          weddingId: wedding.id,
          kind: input.kind,
          payload: { ...draft.payload, reason: input.reason },
          clauseId,
        },
      });
      await tx.eventLog.create({
        data: { weddingId: wedding.id, type: "proposal_created", message: `Proposed: ${draft.summary}` },
      });
      return created;
    });

    return { proposalId: proposal.id, kind: input.kind, status: "pending", summary: draft.summary, note };
  },
});
