import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { citation, loadBudgetSummary, loadWedding, resolveVendor } from "@/lib/agent/tools/data";
import { ToolError, defineTool, isoDateSchema, parseIsoDate } from "@/lib/agent/tools/types";
import { budgetImpact, largestCharge } from "@/lib/budget";
import { formatCents } from "@/lib/money";
import { cancellationRulesSchema, dateChangeRulesSchema } from "@/lib/rules";
import { toIsoDate } from "@/lib/schedule";
import { dateChangeCost, refundOwed, type DateChangeResult, type RefundResult } from "@/lib/terms";

const money = (cents: number) => ({ cents, label: formatCents(cents) });

/** What it costs to move the wedding to `newDate`, per vendor. Used by the tool and by reschedule proposals. */
export async function computeDateChange(prisma: PrismaClient, newDate: Date, today: Date) {
  const wedding = await loadWedding(prisma);
  const vendors = await prisma.vendor.findMany({
    where: { weddingId: wedding.id },
    include: { terms: true, clauses: { where: { kind: "date_change" }, orderBy: { page: "asc" } } },
    orderBy: { name: "asc" },
  });

  let result: DateChangeResult;
  try {
    result = dateChangeCost({
      originalDate: wedding.date,
      newDate,
      today,
      vendors: vendors.map((v) => ({
        vendorId: v.id,
        vendorName: v.name,
        totalCostCents: v.totalCost,
        status: v.status,
        dateChangeRules: v.terms ? dateChangeRulesSchema.parse(v.terms.dateChangeRules) : [],
        clauseId: v.clauses[0]?.id ?? null,
      })),
    });
  } catch (error) {
    if (error instanceof RangeError) throw new ToolError(`newDate can't be in the past (today is ${toIsoDate(today)}).`);
    throw error;
  }
  const citations = new Map(vendors.flatMap((v) => (v.clauses[0] ? [[v.id, citation(v.name, v.clauses[0].page)] as const] : [])));
  // What the move does to the budget: everything committed so far plus the fees.
  const budget = budgetImpact(await loadBudgetSummary(prisma, wedding), result.totalCents);
  return { wedding, result, citations, vendors, budget };
}

/** What a vendor owes back if the wedding is cancelled on `cancellationDate`. Used by the tool and by refund proposals. */
export async function computeRefund(
  prisma: PrismaClient,
  vendorRef: string,
  cancelledBy: "couple" | "vendor",
  cancellationDate: Date,
) {
  const wedding = await loadWedding(prisma);
  const vendor = await resolveVendor(prisma, wedding.id, vendorRef);
  const [terms, payments, clause] = await Promise.all([
    prisma.terms.findUnique({ where: { vendorId: vendor.id } }),
    prisma.payment.findMany({ where: { vendorId: vendor.id } }),
    prisma.clause.findFirst({ where: { vendorId: vendor.id, kind: "cancellation" }, orderBy: { page: "asc" } }),
  ]);

  const result: RefundResult = refundOwed({
    cancelledBy,
    rules: terms ? cancellationRulesSchema.parse(terms.cancellationRules) : [],
    clauseId: clause?.id ?? null,
    payments: payments.map((p) => ({ amountCents: p.amount, status: p.status })),
    weddingDate: wedding.date,
    cancellationDate,
  });
  return { vendor, wedding, result, citation: clause ? citation(vendor.name, clause.page) : null };
}

export const computeDateChangeCostTool = defineTool({
  name: "compute_date_change_cost",
  description:
    "What it would cost to move the wedding to a new date: one row per vendor, worked out from each contract's date-change terms, with the clause each comes from. Always use this for what-if questions about changing the date. Never work out costs yourself.",
  inputSchema: z.object({
    newDate: isoDateSchema.describe("The new wedding date, written YYYY-MM-DD."),
  }),
  run: async ({ newDate }, { prisma, today }) => {
    const { wedding, result, citations, budget } = await computeDateChange(prisma, parseIsoDate(newDate), today);
    const biggest = largestCharge(result.rows);
    return {
      currentDate: toIsoDate(wedding.date),
      newDate,
      today: toIsoDate(today),
      total: money(result.totalCents),
      vendorsCharging: result.rows.filter((r) => r.costCents > 0).length,
      budget: {
        budget: money(budget.budgetCents),
        committedBeforeMove: money(budget.committedCents),
        totalAfterMove: money(budget.projectedCents),
        overBudget: budget.overBudget,
        overBudgetBy: budget.overBudget ? money(budget.overByCents) : null,
      },
      biggestFee: biggest
        ? { vendorName: biggest.vendorName, cost: money(biggest.costCents), citation: citations.get(biggest.vendorId) ?? null }
        : null,
      rows: result.rows.map((r) => ({
        vendorId: r.vendorId,
        vendorName: r.vendorName,
        cost: money(r.costCents),
        noticeDays: r.noticeDays,
        reason: r.reason,
        clauseId: r.clauseId,
        citation: citations.get(r.vendorId) ?? null,
      })),
    };
  },
});

export const computeRefundOwedTool = defineTool({
  name: "compute_refund_owed",
  description:
    "How much a vendor owes back if the wedding is cancelled, from that vendor's cancellation terms and what has been paid, with the clause it comes from. Always use this for cancellation and refund questions. Never work out amounts yourself.",
  inputSchema: z.object({
    vendorId: z.string().describe("A vendor id or name."),
    cancelledBy: z.enum(["couple", "vendor"]).describe("Who cancels: the couple, or the vendor (for example 'the florist cancelled')."),
    date: isoDateSchema.optional().describe("The cancellation date, YYYY-MM-DD. Defaults to today."),
  }),
  run: async ({ vendorId, cancelledBy, date }, { prisma, today }) => {
    const when = date ? parseIsoDate(date) : today;
    const { vendor, result, citation: clauseCitation } = await computeRefund(prisma, vendorId, cancelledBy, when);
    return {
      vendorId: vendor.id,
      vendorName: vendor.name,
      cancelledBy,
      cancellationDate: toIsoDate(when),
      owedBack: money(result.owedCents),
      paidSoFar: money(result.paidCents),
      vendorKeeps: money(result.retainedCents),
      noticeDays: result.noticeDays,
      reason: result.reason,
      clauseId: result.clauseId,
      citation: clauseCitation,
    };
  },
});
