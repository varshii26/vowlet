import { describe, expect, it } from "vitest";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, hashPassword, passwordProblems, verifyPassword } from "@/lib/auth/password";

describe("hashPassword / verifyPassword", () => {
  it("verifies the right password and refuses a wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("correct horse battery stapl", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("never stores the password, and salts every hash differently", async () => {
    const [a, b] = await Promise.all([hashPassword("same password"), hashPassword("same password")]);
    expect(a).not.toContain("same password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same password", a)).toBe(true);
    expect(await verifyPassword("same password", b)).toBe(true);
  });

  it("stores its own parameters, so the cost can be raised later", async () => {
    const [scheme, N, r, p, salt, key] = (await hashPassword("x".repeat(12))).split("$");
    expect(scheme).toBe("scrypt");
    expect([Number(N), Number(r), Number(p)]).toEqual([32768, 8, 1]);
    expect(Buffer.from(salt, "base64")).toHaveLength(16);
    expect(Buffer.from(key, "base64")).toHaveLength(64);
  });

  it("treats a password as the same text however it is composed (Unicode normalisation)", async () => {
    const hash = await hashPassword("café au lait"); // the e-acute as one character
    expect(await verifyPassword("café au lait", hash)).toBe(true); // an e plus a combining accent
  });

  it("treats a malformed stored hash as a mismatch, never an exception", async () => {
    for (const bad of ["", "plaintext", "scrypt$", "scrypt$1$2$3$salt", "bcrypt$1$2$3$a$b", "scrypt$x$8$1$AAAA$AAAA", "scrypt$32768$8$1$AAAA$"]) {
      expect(await verifyPassword("anything", bad), bad).toBe(false);
    }
    // Parameters scrypt cannot run with (N must be a power of two).
    expect(await verifyPassword("anything", "scrypt$3$8$1$AAAA$AAAA")).toBe(false);
  });
});

describe("passwordProblems", () => {
  it("is empty for an acceptable password", () => {
    expect(passwordProblems("a decent passphrase")).toEqual([]);
    expect(passwordProblems("x".repeat(MIN_PASSWORD_LENGTH))).toEqual([]);
  });

  it("says what is wrong", () => {
    expect(passwordProblems("short")).toEqual([`Use at least ${MIN_PASSWORD_LENGTH} characters.`]);
    expect(passwordProblems("x".repeat(MAX_PASSWORD_LENGTH + 1))).toEqual([`Use at most ${MAX_PASSWORD_LENGTH} characters.`]);
    expect(passwordProblems(" ".repeat(12))).toEqual(["A password can't be only spaces."]);
  });
});
