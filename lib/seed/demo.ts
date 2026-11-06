import type { PrismaClient } from "@/generated/prisma/client";
import {
  cancellationRulesSchema,
  dateChangeRulesSchema,
} from "@/lib/rules";
import { buildVendorClauses, vendorStyle } from "@/lib/seed/clauses";
import { VENDORS, WEDDING, vendorTotalCents } from "@/lib/seed/demo-data";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Wipe all data and write the Priya & Sam demo. Used by the CLI seed, startup
 * seeding and (later) the "Reset demo" button.
 */
export async function seedDemo(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.eventLog.deleteMany();
    await tx.proposal.deleteMany();
    await tx.payment.deleteMany();
    await tx.terms.deleteMany();
    await tx.clause.deleteMany();
    await tx.vendor.deleteMany();
    await tx.wedding.deleteMany();

    const wedding = await tx.wedding.create({
      data: {
        coupleNames: WEDDING.coupleNames,
        date: utc(WEDDING.date),
        budget: WEDDING.budgetCents,
      },
    });

    for (const spec of VENDORS) {
      const cancellationRules = cancellationRulesSchema.parse(spec.cancellation);
      const dateChangeRules = dateChangeRulesSchema.parse(spec.dateChange);

      const vendor = await tx.vendor.create({
        data: {
          weddingId: wedding.id,
          name: spec.name,
          category: spec.category,
          paypalEmail: spec.paypalEmail,
          contractPath: `seed/contracts/${spec.slug}.pdf`,
          signingDate: utc(spec.signingDate),
          totalCost: vendorTotalCents(spec),
        },
      });

      // The same wording the contract PDFs contain, so quotes match the PDF.
      const clauses = buildVendorClauses(spec, vendorStyle(spec, VENDORS));

      for (const { payment: p, text, summary, page } of clauses.payments) {
        const clause = await tx.clause.create({
          data: { vendorId: vendor.id, kind: "payment", text, page, summary },
        });
        // Deposits due at signing are already paid in the demo story.
        const paid = p.anchor === "signing_date";
        await tx.payment.create({
          data: {
            vendorId: vendor.id,
            label: p.label,
            amount: p.amountCents,
            anchor: p.anchor,
            offsetDays: p.offsetDays ?? 0,
            fixedDate: p.fixedDate ? utc(p.fixedDate) : null,
            status: paid ? "paid" : "scheduled",
            paidAt: paid ? utc(spec.signingDate) : null,
            clauseId: clause.id,
          },
        });
      }

      const cancelClause = await tx.clause.create({
        data: { vendorId: vendor.id, kind: "cancellation", ...clauses.cancellation },
      });
      const changeClause = await tx.clause.create({
        data: { vendorId: vendor.id, kind: "date_change", ...clauses.dateChange },
      });

      await tx.terms.create({
        data: {
          vendorId: vendor.id,
          cancellationRules,
          dateChangeRules,
          clauseIds: [cancelClause.id, changeClause.id],
        },
      });
    }

    await tx.eventLog.create({
      data: {
        weddingId: wedding.id,
        type: "demo_seeded",
        message: `Loaded demo wedding for ${WEDDING.coupleNames}`,
      },
    });
  });
}

/** Seed only when the database has no wedding yet. Returns true if it seeded. */
export async function ensureSeeded(prisma: PrismaClient): Promise<boolean> {
  if ((await prisma.wedding.count()) > 0) return false;
  await seedDemo(prisma);
  return true;
}
