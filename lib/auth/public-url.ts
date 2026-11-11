/**
 * The site's public address. Behind Render's proxy the app only sees an internal address
 * (`https://localhost:10000`), so OAuth callbacks and the cross-site check need to be told
 * the real one: `AUTH_URL` if it is set, else the `RENDER_EXTERNAL_URL` that Render always provides.
 * Locally neither is set and the request's own address is right.
 */
export function publicUrl(env: Record<string, string | undefined> = process.env): string | null {
  const value = [env.AUTH_URL, env.NEXTAUTH_URL, env.RENDER_EXTERNAL_URL].find((v) => v && v.trim() !== "");
  if (!value) return null;
  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
}

/** Auth.js reads AUTH_URL on every request to build callback URLs: default it to the public address when unset. */
export function applyPublicUrl(env: Record<string, string | undefined> = process.env): void {
  if (!env.AUTH_URL?.trim()) {
    const url = publicUrl(env);
    if (url) env.AUTH_URL = url;
  }
}
