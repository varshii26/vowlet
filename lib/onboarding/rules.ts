import { z } from "zod";
import { isoDateSchema } from "@/lib/agent/tools/types";

/** Browser-safe: the onboarding form and the server check the same rules. */
export const MAX_NAMES = 80;
export const MAX_BUDGET_DOLLARS = 10_000_000;

/** "12,500", "$12,500.50" or "12500" to cents; null when it isn't an amount. Blank means no budget set yet (0). */
export function parseBudgetCents(raw: string): number | null {
  const text = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (text === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const dollars = Number(text);
  if (dollars > MAX_BUDGET_DOLLARS) return null;
  return Math.round(dollars * 100);
}

export const onboardingSchema = z.object({
  coupleNames: z.string().trim().min(1, "Enter your names, for example Priya & Sam.").max(MAX_NAMES, `Keep it under ${MAX_NAMES} characters.`),
  date: isoDateSchema.catch("").pipe(z.string().min(1, "Pick your wedding date.")),
  budget: z.string().refine((v) => parseBudgetCents(v) !== null, "Enter an amount like 25,000."),
});

export type OnboardingField = "coupleNames" | "date" | "budget";
export type OnboardingState = {
  errors: Partial<Record<OnboardingField | "form", string>>;
  values: { coupleNames: string; date: string; budget: string };
};
export const INITIAL_ONBOARDING: OnboardingState = { errors: {}, values: { coupleNames: "", date: "", budget: "" } };
