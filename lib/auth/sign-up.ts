import type { PrismaClient } from "@/generated/prisma/client";
import { registerSchema } from "@/lib/auth/rules";
import { safeNextPath } from "@/lib/auth/redirect";
import { registerUser } from "@/lib/auth/users";
import type { RateLimiter } from "@/lib/rate-limit";

/**
 * Sign-up from the form: validate, rate limit, create the account. Signing the
 * new user in is the server action's job (it needs Auth.js and Next's redirect),
 * so this stays a plain function that is tested against a real database.
 */

export type SignUpField = "name" | "email" | "password" | "form";

/** What the sign-up form shows after an attempt. The password is never part of it. */
export type SignUpState = {
  errors: Partial<Record<SignUpField, string>>;
  /** Kept across a failed attempt so a typo doesn't mean retyping them. */
  values: { name: string; email: string };
  /** The email already has an account: the form offers "Sign in instead" with the address pre-filled. */
  emailTaken: boolean;
};

export const INITIAL_SIGN_UP: SignUpState = { errors: {}, values: { name: "", email: "" }, emailTaken: false };

export type SignUpResult =
  | { ok: true; email: string; password: string; redirectTo: string }
  | { ok: false; state: SignUpState };

const text = (data: FormData, name: string) => (typeof data.get(name) === "string" ? (data.get(name) as string) : "");

export async function registerFromForm(deps: { prisma: PrismaClient; limiter: RateLimiter; ip: string }, data: FormData): Promise<SignUpResult> {
  const values = { name: text(data, "name"), email: text(data, "email") };
  const fail = (errors: SignUpState["errors"], emailTaken = false): SignUpResult => ({ ok: false, state: { errors, values, emailTaken } });

  // Every attempt counts, valid or not: this is public, and hashing a password is expensive.
  if (!deps.limiter.check(deps.ip).allowed) return fail({ form: "Too many sign-up attempts. Please wait a minute and try again." });

  const parsed = registerSchema.safeParse({ name: values.name || undefined, email: values.email, password: text(data, "password") });
  if (!parsed.success) {
    const errors: SignUpState["errors"] = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0]);
      if (field === "name" || field === "email" || field === "password") errors[field] ??= issue.message;
    }
    return fail(errors);
  }

  const created = await registerUser(deps.prisma, parsed.data);
  if (!created.ok) return fail({ email: "There's already an account for that email." }, true);
  return { ok: true, email: parsed.data.email, password: parsed.data.password, redirectTo: safeNextPath(text(data, "next")) };
}
