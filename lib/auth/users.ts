import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, decoyHash, hashPassword, verifyPassword } from "@/lib/auth/password";

/** Emails are compared and stored lower-cased and trimmed, so "Priya@x.com" and "priya@x.com" are one account. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const email = z
  .string()
  .trim()
  .min(1, "Enter your email.")
  .max(254, "That email is too long.")
  .email("Enter a valid email address.")
  .transform(normalizeEmail);

export const registerSchema = z.object({
  /** Optional: "Priya & Sam". */
  name: z.string().trim().max(100, "That name is too long.").optional(),
  email,
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
    .max(MAX_PASSWORD_LENGTH, `Use at most ${MAX_PASSWORD_LENGTH} characters.`)
    .refine((value) => value.trim().length > 0, "A password can't be only spaces."),
});
export type RegisterInput = z.input<typeof registerSchema>;

/** Sign-in only checks the shape. Password rules apply when one is created, not when it is used. */
export const credentialsSchema = z.object({
  email,
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

/** What the rest of the app may know about a user. Never the hash. */
export type PublicUser = { id: string; name: string | null; email: string; image: string | null; isDemo: boolean };

const publicUser = (user: { id: string; name: string | null; email: string; image: string | null; isDemo: boolean }): PublicUser => ({
  id: user.id,
  name: user.name,
  email: user.email,
  image: user.image,
  isDemo: user.isDemo,
});

export type RegisterResult = { ok: true; user: PublicUser } | { ok: false; code: "email_taken" };

/**
 * Create an email + password account. An email that already has an account, by
 * any method, is refused: signing up never takes over or links to an existing
 * account. (An unverified password account that later "linked" a Google sign-in
 * for the same email would hand its creator, who knows the password, a victim's
 * Google account. Nothing here sends email, so nothing can be verified.)
 */
export async function registerUser(prisma: PrismaClient, input: z.output<typeof registerSchema>): Promise<RegisterResult> {
  const address = normalizeEmail(input.email);
  if (await prisma.user.findUnique({ where: { email: address }, select: { id: true } })) return { ok: false, code: "email_taken" };

  try {
    const user = await prisma.user.create({
      data: { email: address, name: input.name || null, passwordHash: await hashPassword(input.password) },
    });
    return { ok: true, user: publicUser(user) };
  } catch (error) {
    // Two sign-ups for one address at the same moment: the unique index decides, and the loser lands here.
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") return { ok: false, code: "email_taken" };
    throw error;
  }
}

/**
 * The user for an email and password, or null. Null for every kind of failure:
 * no such account, a wrong password, or an account that has no password
 * (Google-only, or the demo user). A missing account still pays for one hash
 * check, so the two cases take the same time and can't be told apart.
 */
export async function verifyCredentials(prisma: PrismaClient, rawEmail: string, password: string): Promise<PublicUser | null> {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(rawEmail) } });
  const stored = user?.passwordHash ?? (await decoyHash());
  const matches = await verifyPassword(password, stored);
  return user && user.passwordHash && matches ? publicUser(user) : null;
}
