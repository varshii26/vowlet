import type { PrismaClient } from "@/generated/prisma/client";
import {
  cancellationRulesSchema,
  dateChangeRulesSchema,
} from "@/lib/rules";
import { buildVendorClauses, vendorStyle } from "@/lib/seed/clauses";
import { VENDORS, WEDDING, vendorTotalCents } from "@/lib/seed/demo-data";
import { DEMO_USER } from "@/lib/seed/demo-user";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Wipe the demo wedding and write it again: Priya & Sam, owned by the demo user.
 * Used by the CLI seed, startup seeding, the "Reset demo" button and the idle auto-reset.
 *
 * It touches only the demo user's wedding. Real couples' weddings, vendors, payments and
 * accounts are never read or deleted here: a judge pressing Reset must not be able to wipe anyone's data.
 */
export async function seedDemo(prisma: PrismaClient, options: { message?: string } = {}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // The demo user: no password (so it can't be signed into with one), reachable only through "Try the demo".
    await tx.user.upsert({
      where: { id: DEMO_USER.id },
      create: { id: DEMO_USER.id, name: DEMO_USER.name, email: DEMO_USER.email, isDemo: true },
      update: { name: DEMO_USER.name, email: DEMO_USER.email, isDemo: true, passwordHash: null },
    });

    // Only the demo user's wedding goes (children first: SQLite enforces the foreign keys).
    const vendors = { vendor: { wedding: { userId: DEMO_USER.id } } };
    await tx.eventLog.deleteMany({ where: { wedding: { userId: DEMO_USER.id } } });
    await tx.proposal.deleteMany({ where: { wedding: { userId: DEMO_USER.id } } });
    await tx.payment.deleteMany({ where: vendors });
    await tx.terms.deleteMany({ where: vendors });
    await tx.clause.deleteMany({ where: vendors });
    await tx.vendor.deleteMany({ where: { wedding: { userId: DEMO_USER.id } } });
    await tx.wedding.deleteMany({ where: { userId: DEMO_USER.id } });

    const wedding = await tx.wedding.create({
      data: {
        userId: DEMO_USER.id,
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
      // The prompt-injection showcase: on file like any clause, so the contract
      // viewer can highlight it and the agent can read it (as data).
      if (clauses.billingNotes) {
        await tx.clause.create({ data: { vendorId: vendor.id, kind: "other", ...clauses.billingNotes } });
      }

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
        message: options.message ?? `Loaded demo wedding for ${WEDDING.coupleNames}`,
      },
    });
  });
}

/** Seed only when the demo wedding is missing (a database full of real couples still needs it). Returns true if it seeded. */
export async function ensureSeeded(prisma: PrismaClient): Promise<boolean> {
  if ((await prisma.wedding.count({ where: { userId: DEMO_USER.id } })) > 0) return false;
  await seedDemo(prisma);
  return true;
}
