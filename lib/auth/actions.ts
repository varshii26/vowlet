"use server";

import { AuthError, CredentialsSignin } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";
import { clientIp } from "@/lib/auth/ip";
import { registrations } from "@/lib/auth/limits";
import { safeNextPath } from "@/lib/auth/redirect";
import { registerFromForm, type SignUpState } from "@/lib/auth/sign-up";
import { prisma } from "@/lib/db";

/** What the sign-in form shows after an attempt. `email` is kept so a typo doesn't mean retyping it. */
export type SignInState = { error: string | null; email: string };

/** The code the page maps to a message: our own code for CredentialsSignin, otherwise Auth.js's error type. */
const codeOf = (error: AuthError) => (error instanceof CredentialsSignin ? error.code : error.type);

const field = (data: FormData, name: string) => (typeof data.get(name) === "string" ? (data.get(name) as string) : "");

/**
 * Email + password. On success Auth.js redirects (Next's redirect is an exception,
 * so it must be rethrown, never swallowed); on failure the form gets the code back.
 */
export async function signInWithPassword(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = field(formData, "email");
  try {
    await signIn("credentials", { email, password: field(formData, "password"), redirectTo: safeNextPath(field(formData, "next")) });
  } catch (error) {
    if (error instanceof AuthError) return { error: codeOf(error), email };
    throw error;
  }
  return { error: null, email };
}

/** Starts the Google flow. Google then sends the person back to the callback, and on a problem to /login?error=. */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  await signIn("google", { redirectTo: safeNextPath(field(formData, "next")) });
}

/** "Try the demo": signs into the shared Priya & Sam account. */
export async function startDemo(formData: FormData): Promise<void> {
  const next = safeNextPath(field(formData, "next"));
  try {
    await signIn("demo", { redirectTo: next });
  } catch (error) {
    if (error instanceof AuthError) {
      // A rate limit says so; anything else (the demo user missing, say) is "unavailable".
      const code = error instanceof CredentialsSignin && error.code !== "credentials" ? error.code : "demo_unavailable";
      redirect(`/login?error=${encodeURIComponent(code)}`);
    }
    throw error;
  }
}

/**
 * Sign-up: create the account, then sign the new user in. The destination is the
 * dashboard (or `next`); once onboarding exists (#104) a user with no wedding is
 * sent there from any page, which is how "land on onboarding" is met.
 */
export async function signUp(_previous: SignUpState, formData: FormData): Promise<SignUpState> {
  const result = await registerFromForm({ prisma, limiter: registrations, ip: clientIp({ headers: await headers() }) }, formData);
  if (!result.ok) return result.state;

  try {
    await signIn("credentials", { email: result.email, password: result.password, redirectTo: result.redirectTo });
  } catch (error) {
    // The account exists, so say so, rather than leaving the person thinking sign-up failed.
    if (error instanceof AuthError) {
      return {
        errors: { form: "Your account was created, but signing in didn't work. Please sign in with your new email and password." },
        values: { name: field(formData, "name"), email: result.email },
        emailTaken: false,
      };
    }
    throw error;
  }
  return { errors: {}, values: { name: "", email: "" }, emailTaken: false };
}
