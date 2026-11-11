/**
 * Where to send someone after they sign in. The destination comes from a URL
 * (`/login?next=/vendors/abc`), so it is attacker-controlled: a link to
 * `/login?next=https://evil.example` must not bounce a signed-in user there.
 * Only a path on this site is accepted; anything else becomes the dashboard.
 */

export const DEFAULT_AFTER_SIGN_IN = "/";

/** A real path we never send people back to: the auth pages (a loop) and API routes (not pages). */
const NEVER = [/^\/login(\/|\?|#|$)/, /^\/signup(\/|\?|#|$)/, /^\/api(\/|$)/];

const MAX_LENGTH = 2000;

export function safeNextPath(next: string | string[] | null | undefined): string {
  const value = Array.isArray(next) ? next[0] : next;
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LENGTH) return DEFAULT_AFTER_SIGN_IN;

  // A same-site path starts with exactly one slash. `//host` and `/\host` are other sites to a browser,
  // and control characters (tab, newline) are stripped by browsers, which can turn `/\t/evil` into `//evil`.
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) {
    return DEFAULT_AFTER_SIGN_IN;
  }

  // Resolve it the way a browser would, and make sure it stays on this site.
  let url: URL;
  try {
    url = new URL(value, "http://vowlet.invalid");
  } catch {
    return DEFAULT_AFTER_SIGN_IN;
  }
  if (url.origin !== "http://vowlet.invalid") return DEFAULT_AFTER_SIGN_IN;

  const path = `${url.pathname}${url.search}${url.hash}`;
  // Normalising can create what the checks above rule out: `/..//evil.example` becomes `//evil.example`,
  // which a browser reads as another site. So check the result too, not just the input.
  if (path.startsWith("//") || path.includes("\\")) return DEFAULT_AFTER_SIGN_IN;
  return NEVER.some((pattern) => pattern.test(path)) ? DEFAULT_AFTER_SIGN_IN : path;
}
