"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { DemoButton, GoogleButton } from "@/components/Auth/ProviderButtons";
import { Divider } from "@/components/Auth/AuthFrame";
import { PasswordField } from "@/components/Auth/PasswordField";
import { signInWithPassword, type SignInState } from "@/lib/auth/actions";
import { signInMessage } from "@/lib/auth/messages";

type Props = {
  /** Where to go after signing in: already checked by safeNextPath on the server. */
  next: string;
  googleEnabled: boolean;
  /** An error code from the URL (`/login?error=`), for failures that happen away from the form, such as Google's. */
  urlError?: string | null;
};

const INITIAL: SignInState = { error: null, email: "" };

/**
 * The whole sign-in card: the demo shortcut, Google (when configured), then email
 * and password. One error region, announced to screen readers and given focus
 * when something fails.
 */
export function SignInForm({ next, googleEnabled, urlError = null }: Props) {
  const [state, formAction, pending] = useActionState(signInWithPassword, INITIAL);
  const alert = useRef<HTMLDivElement>(null);

  // A failed attempt beats the URL's error, which was about an earlier one.
  const message = signInMessage(state.error ?? urlError);
  useEffect(() => {
    if (message) alert.current?.focus();
  }, [message]);

  return (
    <>
      <DemoButton next={next} />

      {message && (
        <div
          ref={alert}
          role="alert"
          tabIndex={-1}
          className="space-y-1 rounded-control border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800 outline-none focus-visible:outline-2"
        >
          <p className="font-medium">{message.message}</p>
          {message.googleHint && googleEnabled && <p>Signed up with Google? Use Continue with Google.</p>}
        </div>
      )}

      <Divider>or sign in</Divider>

      {googleEnabled && (
        <>
          <GoogleButton next={next} />
          <Divider>or</Divider>
        </>
      )}

      <form action={formAction} className="space-y-4" noValidate={false}>
        <input type="hidden" name="next" value={next} />
        <div className="space-y-1.5">
          <label htmlFor="signin-email" className="block text-sm font-medium text-ink">
            Email
          </label>
          <input
            id="signin-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            // Kept across a failed attempt, so a typo in the password doesn't mean retyping the email.
            defaultValue={state.email}
            key={state.email}
            aria-invalid={state.error ? true : undefined}
            className="w-full rounded-control border border-line bg-canvas px-3 py-2.5 text-sm text-ink focus:border-accent/50 focus:outline-none focus-visible:outline-2"
          />
        </div>
        <PasswordField autoComplete="current-password" />
        <button type="submit" disabled={pending} className="btn btn-primary w-full py-2.5 disabled:cursor-wait">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="text-center text-sm text-muted">
        New here?{" "}
        <Link href="/signup" className="font-medium text-accent underline-offset-2 hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
