import type { PrismaClient } from "@/generated/prisma/client";
import { parseIsoDate } from "@/lib/agent/tools/types";
import { INITIAL_ONBOARDING, onboardingSchema, parseBudgetCents, type OnboardingField, type OnboardingState } from "@/lib/onboarding/rules";

const text = (data: FormData, name: string) => (typeof data.get(name) === "string" ? (data.get(name) as string) : "");

export type CreateResult = { ok: true; weddingId: string } | { ok: false; state: OnboardingState };

/**
 * Creates the signed-in user's wedding from the onboarding form. One wedding per
 * user: if they already have one (a double submit, a second tab) it is kept and
 * returned, never replaced or duplicated.
 */
export async function createWeddingFromForm(prisma: PrismaClient, userId: string, data: FormData): Promise<CreateResult> {
  const values = { coupleNames: text(data, "coupleNames"), date: text(data, "date"), budget: text(data, "budget") };
  const parsed = onboardingSchema.safeParse(values);
  if (!parsed.success) {
    const errors: OnboardingState["errors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as OnboardingField;
      errors[field] ??= issue.message;
    }
    return { ok: false, state: { errors, values } };
  }

  const existing = await prisma.wedding.findUnique({ where: { userId }, select: { id: true } });
  if (existing) return { ok: true, weddingId: existing.id };

  try {
    const wedding = await prisma.wedding.create({
      data: { userId, coupleNames: parsed.data.coupleNames, date: parseIsoDate(parsed.data.date), budget: parseBudgetCents(parsed.data.budget) ?? 0 },
    });
    await prisma.eventLog.create({ data: { weddingId: wedding.id, type: "wedding_created", message: `Set up the wedding for ${wedding.coupleNames}.` } });
    return { ok: true, weddingId: wedding.id };
  } catch (error) {
    // A parallel submit won the race for the unique userId: use theirs.
    const winner = await prisma.wedding.findUnique({ where: { userId }, select: { id: true } });
    if (winner) return { ok: true, weddingId: winner.id };
    throw error;
  }
}

export { INITIAL_ONBOARDING };
