import type { PrismaClient } from "@/generated/prisma/client";
import { ToolError } from "@/lib/agent/tools/types";
import { summarizeBudget, type BudgetSummary } from "@/lib/budget";

/**
 * A human-readable reference to a clause, ready for the model to quote:
 * "Grand Oak Estate contract, page 2". Tools return it next to every clause id,
 * so answers cite the contract in words instead of printing an id.
 */
export const citation = (vendorName: string, page: number) => `${vendorName} contract, page ${page}`;

export async function loadWedding(prisma: PrismaClient) {
  const wedding = await prisma.wedding.findFirst();
  if (!wedding) throw new ToolError("There is no wedding set up yet.");
  return wedding;
}

/** Budget totals for the wedding (paid, scheduled, remaining), the same numbers the dashboard shows. */
export async function loadBudgetSummary(prisma: PrismaClient, wedding: { id: string; budget: number }): Promise<BudgetSummary> {
  const vendors = await prisma.vendor.findMany({ where: { weddingId: wedding.id }, include: { payments: true } });
  return summarizeBudget(
    wedding.budget,
    vendors.flatMap((v) => v.payments.map((p) => ({ amountCents: p.amount, status: p.status, vendorActive: v.status === "active" }))),
  );
}

const MAX_SUGGESTIONS = 20;

/**
 * Find a vendor from what the model wrote: an id, a name, part of a name, or a
 * category that only one vendor has ("the florist"). Models rarely copy an id
 * perfectly, so this is forgiving, but never guesses between several matches.
 */
export async function resolveVendor(prisma: PrismaClient, weddingId: string, reference: string) {
  const vendors = await prisma.vendor.findMany({ where: { weddingId }, orderBy: { name: "asc" } });
  const ref = reference.trim();
  const q = ref.toLowerCase();

  const byId = vendors.find((v) => v.id === ref);
  if (byId) return byId;

  const tiers = [
    vendors.filter((v) => v.name.toLowerCase() === q),
    vendors.filter((v) => v.category.toLowerCase() === q),
    q.length >= 3 ? vendors.filter((v) => v.name.toLowerCase().includes(q)) : [],
  ];
  for (const matches of tiers) {
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      const options = matches.map((v) => `${v.name} (id ${v.id})`).join(", ");
      throw new ToolError(`"${reference}" matches several vendors: ${options}. Use a vendor id.`);
    }
  }

  const known = vendors.slice(0, MAX_SUGGESTIONS).map((v) => `${v.name} (id ${v.id})`).join(", ");
  throw new ToolError(`No vendor matches "${reference}". Known vendors: ${known}. Call get_vendors for the full list.`);
}
