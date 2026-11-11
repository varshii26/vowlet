import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/Auth/AuthFrame";
import { OnboardingForm } from "@/components/Onboarding/OnboardingForm";
import { requestScope } from "@/lib/auth/request-wedding";
import { auth } from "@/lib/auth";

export const metadata: Metadata = { title: "Set up your wedding · Vowlet" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/onboarding");
  const { weddingId } = await requestScope();
  if (weddingId) redirect("/"); // already set up
  return (
    <AuthFrame title="Set up your wedding">
      <OnboardingForm defaultNames={session.user.name ?? ""} />
    </AuthFrame>
  );
}
