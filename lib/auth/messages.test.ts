import { describe, expect, it } from "vitest";
import { signInMessage } from "@/lib/auth/messages";

describe("signInMessage", () => {
  it("says nothing when there is no error", () => {
    for (const code of [undefined, null, ""]) expect(signInMessage(code)).toBeNull();
  });

  it("gives the same answer for a wrong password, an unknown email and an account with no password", () => {
    // All three reach the page as the same code, so the message cannot say which it was.
    const a = signInMessage("credentials");
    expect(a).toEqual({ message: "That email and password don't match.", googleHint: true });
    expect(signInMessage("CredentialsSignin")).toEqual(a);
    expect(JSON.stringify(a)).not.toMatch(/no account|doesn't exist|not found|wrong password/i);
  });

  it("tells someone who tried too often to wait, without a Google hint", () => {
    expect(signInMessage("rate_limited")).toEqual({ message: "Too many tries. Please wait a minute and try again.", googleHint: false });
  });

  it("explains the two Google failures", () => {
    expect(signInMessage("OAuthAccountNotLinked")?.message).toMatch(/uses a password.*email and password/);
    expect(signInMessage("AccessDenied")?.message).toMatch(/Google didn't confirm/);
  });

  it("has a plain fallback for anything else, never the raw code", () => {
    const other = signInMessage("Configuration");
    expect(other?.message).toBe("Sign-in didn't work. Please try again.");
    expect(other?.message).not.toMatch(/Configuration/);
    expect(signInMessage("demo_unavailable")?.message).toMatch(/demo isn't available/);
  });
});
