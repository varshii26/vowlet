/**
 * CSRF defence for the JSON and upload API routes. The session cookie is SameSite=Lax,
 * which already stops cross-site POSTs from carrying it in current browsers; this checks
 * again on the server, so an older browser or a mistake in cookie settings isn't the only
 * thing between another website and a state-changing call.
 *
 * A state-changing request (anything but GET/HEAD/OPTIONS) is refused when the browser
 * says it came from another site: its `Origin` names a different host, or `Sec-Fetch-Site`
 * is `cross-site`/`same-site`. Requests with neither header (curl, server-to-server, tests)
 * are allowed: they are not driven by a victim's browser, and they still need the session.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The host this request was addressed to, as the browser sees it (behind a proxy, the forwarded one). */
function ownHost(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-host");
  return (forwarded?.split(",")[0] ?? request.headers.get("host") ?? new URL(request.url).host).trim().toLowerCase();
}

export function isCrossSiteRequest(request: Request): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return false;

  const origin = request.headers.get("origin");
  if (origin !== null) {
    // "null" is what browsers send from sandboxed frames and some redirects: never ours.
    let host: string;
    try {
      host = new URL(origin).host.toLowerCase();
    } catch {
      return true;
    }
    return host !== ownHost(request);
  }

  const site = request.headers.get("sec-fetch-site");
  return site === "cross-site" || site === "same-site";
}

export const crossSiteResponse = () =>
  Response.json({ ok: false, error: { code: "forbidden_origin", message: "That request came from another website, so it was blocked." } }, { status: 403 });
