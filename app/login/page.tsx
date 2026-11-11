import type { Metadata } from "next";
import { AuthFrame } from "@/components/Auth/AuthFrame";
import { SignInForm } from "@/components/Auth/SignInForm";
import { redirect } from "next/navigation";
import { auth, googleEnabled } from "@/lib/auth";
import { safeNextPath } from "@/lib/auth/redirect";

export const metadata: Metadata = { title: "Sign in · Vowlet" };

// Reads the URL and the server's configuration on every request.
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error, email, signedout } = await searchParams;
  // Already signed in: nothing to do here. (A stale cookie still gets the page: auth() says who is really signed in.)
  if ((await auth())?.user?.id) redirect(safeNextPath(next));
  return (
    <AuthFrame title="Sign in">
      {signedout !== undefined && (
        <p role="status" className="rounded-control border border-line bg-canvas px-3.5 py-2.5 text-sm font-medium text-ink">
          You&apos;ve signed out.
        </p>
      )}
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
