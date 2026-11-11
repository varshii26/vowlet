import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "@/components/Auth/AuthFrame";
import { DemoButton } from "@/components/Auth/ProviderButtons";
import { SignUpForm } from "@/components/Auth/SignUpForm";
import { googleEnabled } from "@/lib/auth";
import { safeNextPath } from "@/lib/auth/redirect";

export const metadata: Metadata = { title: "Create an account · Vowlet" };

// Reads the URL and the server's configuration on every request.
export const dynamic = "force-dynamic";

export default async function SignUpPage({ searchParams }: PageProps<"/signup">) {
  const { next } = await searchParams;
  const safeNext = safeNextPath(next);
  return (
    <AuthFrame
      title="Create your Vowlet account"
      footer={
        <>
          <p>
            Already have an account?{" "}
            <Link href={safeNext === "/" ? "/login" : `/login?next=${encodeURIComponent(safeNext)}`} className="font-medium text-accent underline-offset-2 hover:underline">
              Sign in
            </Link>
          </p>
          {/* A div, not a p: a form can't sit inside a paragraph, and the browser would close the paragraph early. */}
          <div>
            Just looking? <DemoButton next={safeNext} variant="link" />
          </div>
        </>
      }
    >
      <SignUpForm next={safeNext} googleEnabled={googleEnabled} />
    </AuthFrame>
  );
}
