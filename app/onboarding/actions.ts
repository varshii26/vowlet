"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createWeddingFromForm } from "@/lib/onboarding/service";
import type { OnboardingState } from "@/lib/onboarding/rules";

/** Creates the signed-in user's wedding, then goes to their (empty) dashboard. */
export async function createWedding(_previous: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const userId = (await auth())?.user?.id;
  if (!userId) redirect("/login?next=/onboarding");
  const result = await createWeddingFromForm(prisma, userId, formData);
  if (!result.ok) return result.state;
  redirect("/"); // Next's redirect is an exception: it must not sit inside a try/catch.
}
