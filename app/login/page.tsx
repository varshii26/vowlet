import type { Metadata } from "next";
import { AuthFrame } from "@/components/Auth/AuthFrame";
import { SignInForm } from "@/components/Auth/SignInForm";
import { googleEnabled } from "@/lib/auth";
import { safeNextPath } from "@/lib/auth/redirect";

export const metadata: Metadata = { title: "Sign in · Vowlet" };

// Reads the URL and the server's configuration on every request.
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error, email } = await searchParams;
  return (
    <AuthFrame title="Sign in">
      <SignInForm
        next={safeNextPath(next)}
        googleEnabled={googleEnabled}
        urlError={typeof error === "string" ? error : null}
        // Only ever shown back in the email field: kept short and treated as plain text.
        initialEmail={typeof email === "string" ? email.slice(0, 254) : ""}
      />
    </AuthFrame>
  );
}
