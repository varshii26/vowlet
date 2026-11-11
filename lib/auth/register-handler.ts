import type { PrismaClient } from "@/generated/prisma/client";
import { registerSchema, registerUser } from "@/lib/auth/users";
import type { RateLimiter } from "@/lib/rate-limit";

type Deps = { prisma: PrismaClient; limiter: RateLimiter };

const fail = (status: number, code: string, message: string, extra?: Record<string, unknown>, headers?: HeadersInit) =>
  Response.json({ ok: false, error: { code, message, ...extra } }, { status, headers });

/** The caller's address, as Render's proxy reports it: the first hop of x-forwarded-for. */
function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/**
 * POST /api/register `{ name?, email, password }`: create an email + password
 * account. Signing in afterwards is the sign-in page's job (Auth.js). Public, so
 * it is rate limited per caller. The response never contains the password or its hash.
 */
export function createRegisterHandler(deps: Deps) {
  return async function registerHandler(request: Request): Promise<Response> {
    const limit = deps.limiter.check(clientKey(request));
    if (!limit.allowed) {
      const seconds = Math.max(1, Math.ceil(limit.retryAfterMs / 1000));
      return fail(429, "too_many_requests", `Too many sign-up attempts. Try again in ${seconds} seconds.`, undefined, { "Retry-After": String(seconds) });
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return fail(400, "bad_request", 'Send a JSON body like { "email": "…", "password": "…" }.');
    }
    const parsed = registerSchema.safeParse(raw);
    if (!parsed.success) {
      // Field by field, so the sign-up form can put each message by its field.
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "form")] ??= issue.message;
      return fail(400, "invalid", "Check the highlighted fields.", { fields });
    }

    const result = await registerUser(deps.prisma, parsed.data);
    if (!result.ok) return fail(409, "email_taken", "There's already an account for that email.");
    return Response.json({ ok: true, user: result.user }, { status: 201 });
  };
}
