/**
 * What the sign-in page says for each kind of failure. A code comes from Auth.js
 * (an error type, or the `code` of a CredentialsSignin we threw) or from the
 * `?error=` in the URL when Google sends the person back.
 *
 * The password message is deliberately the same for a wrong password, an unknown
 * email, and an account that only has Google: it must not reveal which accounts
 * exist. The hint about Google is shown for all of them for the same reason.
 */

export type SignInMessage = {
  message: string;
  /** Show "Signed up with Google? Use Continue with Google." (only sensible when Google is offered). */
  googleHint: boolean;
};

export const RATE_LIMITED_CODE = "rate_limited";

export function signInMessage(code: string | null | undefined): SignInMessage | null {
  switch (code) {
    case undefined:
    case null:
    case "":
      return null;
    // Wrong password, unknown email, or an account with no password: one answer for all three.
    case "credentials":
    case "CredentialsSignin":
      return { message: "That email and password don't match.", googleHint: true };
    case RATE_LIMITED_CODE:
      return { message: "Too many tries. Please wait a minute and try again.", googleHint: false };
    // Google sent back an email that already has a password account (we never link them: see the README's Accounts section).
    case "OAuthAccountNotLinked":
      return { message: "There's already an account with that email that uses a password. Sign in with your email and password instead.", googleHint: false };
    // Our sign-in callback refuses a Google email Google hasn't verified.
    case "AccessDenied":
      return { message: "Google didn't confirm that email address, so it can't be used to sign in.", googleHint: false };
    case "demo_unavailable":
      return { message: "The demo isn't available right now. Please try again in a moment.", googleHint: false };
    default:
      return { message: "Sign-in didn't work. Please try again.", googleHint: false };
  }
}
