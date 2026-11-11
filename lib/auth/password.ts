import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Password hashing with scrypt from Node's own crypto: slow and memory-hard, so
 * guessing offline is expensive, and no native add-on to break a deploy. (The
 * issue suggested argon2id or bcrypt; scrypt gives the same protection, and
 * crypto.argon2 only exists on newer Node versions than this project's
 * minimum.) The hash is stored as `scrypt$N$r$p$salt$hash`, so the cost can be
 * raised later and old hashes still verify.
 *
 * Passwords are never logged and never returned by any API.
 */

const COST = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
/** Node refuses scrypt jobs above 32 MiB unless told otherwise: 128 * N * r = 32 MiB at these settings, so allow some headroom. */
const MAX_MEMORY = 64 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 10;
/** scrypt would hash a megabyte as easily as a word; refuse silly lengths before spending CPU on them. */
export const MAX_PASSWORD_LENGTH = 200;

function derive(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { N, r, p, maxmem: MAX_MEMORY }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, COST.N, COST.r, COST.p);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64"), key.toString("base64")].join("$");
}

/** True when the password matches the stored hash. A malformed hash is simply a mismatch, never an exception. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const [N, R, P] = [Number(n), Number(r), Number(p)];
  if (![N, R, P].every((v) => Number.isInteger(v) && v > 0)) return false;
  try {
    const expected = Buffer.from(key, "base64");
    const actual = await derive(password, Buffer.from(salt, "base64"), N, R, P);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** A hash to compare against when no account matched, so "no such account" costs the same time as "wrong password". */
let decoy: Promise<string> | undefined;
export const decoyHash = () => (decoy ??= hashPassword("not-a-real-password-just-a-decoy"));

/** What is wrong with a candidate password, in words for the sign-up form; empty when it is fine. */
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) problems.push(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (password.length > MAX_PASSWORD_LENGTH) problems.push(`Use at most ${MAX_PASSWORD_LENGTH} characters.`);
  if (password.trim().length === 0) problems.push("A password can't be only spaces.");
  return problems;
}
