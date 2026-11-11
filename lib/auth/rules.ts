import { z } from "zod";

/**
 * The sign-up rules, in a file with no server-only imports so the browser and
 * the server check a form against the very same schema (lib/auth/password.ts and
 * users.ts import node:crypto and the database, and can't be bundled for the browser).
 */

export const MIN_PASSWORD_LENGTH = 10;
/** scrypt would hash a megabyte as easily as a word; refuse silly lengths before spending CPU on them. */
export const MAX_PASSWORD_LENGTH = 200;

/** Emails are compared and stored lower-cased and trimmed, so "Priya@x.com" and "priya@x.com" are one account. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Enter your email.")
  .max(254, "That email is too long.")
  .email("Enter a valid email address.")
  .transform(normalizeEmail);

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(MAX_PASSWORD_LENGTH, `Use at most ${MAX_PASSWORD_LENGTH} characters.`)
  .refine((value) => value.trim().length > 0, "A password can't be only spaces.");

export const registerSchema = z.object({
  /** Optional: "Priya & Sam". */
  name: z.string().trim().max(100, "That name is too long.").optional(),
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.input<typeof registerSchema>;
