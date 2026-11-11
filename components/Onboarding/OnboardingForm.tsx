"use client";

import { useActionState } from "react";
import { createWedding } from "@/app/onboarding/actions";
import { TextField } from "@/components/Auth/TextField";
import { INITIAL_ONBOARDING } from "@/lib/onboarding/rules";

/** Names, date and (optional) budget: all Vowlet needs before the couple can add their first contract. */
export function OnboardingForm({ defaultNames }: { defaultNames: string }) {
  const [state, formAction, pending] = useActionState(createWedding, INITIAL_ONBOARDING);
  const { errors, values } = state;
  return (
    <form action={formAction} className="space-y-4" noValidate>
      {errors.form && (
        <div role="alert" className="rounded-control border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-800">
          {errors.form}
        </div>
      )}
      <TextField name="coupleNames" label="Your names" autoComplete="off" required hint="For example, Priya & Sam." defaultValue={values.coupleNames || defaultNames} error={errors.coupleNames} key={`n-${values.coupleNames}`} />
      <TextField name="date" type="date" label="Wedding date" autoComplete="off" required defaultValue={values.date} error={errors.date} key={`d-${values.date}`} hint="Every payment deadline is counted from this date. You can change it later." />
      <TextField name="budget" label="Budget in dollars (optional)" autoComplete="off" hint="For example, 25,000. It powers the budget bar." defaultValue={values.budget} error={errors.budget} key={`b-${values.budget}`} />
      <button type="submit" disabled={pending} className="btn btn-primary w-full py-2.5 disabled:cursor-wait">
        {pending ? "Setting up…" : "Continue"}
      </button>
    </form>
  );
}
