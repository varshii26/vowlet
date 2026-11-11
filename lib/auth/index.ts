import "server-only";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { vowletAdapter } from "@/lib/auth/adapter";
import * as callbacks from "@/lib/auth/callbacks";
import { clientIp } from "@/lib/auth/ip";
import { demoSignIns, signInAttempts } from "@/lib/auth/limits";
import { RATE_LIMITED_CODE } from "@/lib/auth/messages";
import { applyPublicUrl } from "@/lib/auth/public-url";
import { credentialsSchema, normalizeEmail, publicUser, verifyCredentials } from "@/lib/auth/users";
import { prisma } from "@/lib/db";
import { DEMO_USER } from "@/lib/seed/demo-user";

/**
 * Sign-in with Google or an email and a password (Auth.js v5). `auth()` returns
 * the signed-in user's session on the server; `signIn` and `signOut` are the
 * server actions the sign-in pages call. The auth routes are
 * app/api/auth/[...nextauth]; new accounts are made by POST /api/register.
 *
 * Needs AUTH_SECRET. Google needs AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET and is
 * simply left out without them, so the app still runs with email + password.
 */

// Before anything builds a callback URL: on Render this is what makes Google redirect to the public address, not localhost:10000.
applyPublicUrl();

export const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

/** Thrown when someone has failed too often: the sign-in page shows "wait a minute" for this code. */
class RateLimited extends CredentialsSignin {
  code = RATE_LIMITED_CODE;
}

/** A signed-in session lasts two weeks. */
const SESSION_DAYS = 14;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: vowletAdapter(prisma),
  session: { strategy: "jwt", maxAge: SESSION_DAYS * 24 * 60 * 60 },
  // Behind Render the app sees an internal address, so callbacks use the public one (AUTH_URL, or RENDER_EXTERNAL_URL: lib/auth/public-url.ts).
  trustHost: true,
  providers: [
    ...(googleEnabled ? [Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET })] : []),
    Credentials({
      credentials: { email: {}, password: {} },
      // Any failure is a plain "no": the sign-in page shows one message for all of them. Too many
      // failures for an email or from an address lock further attempts out, even with the right
      // password, so guessing gets nowhere. (Checked before the hash, so a lockout is cheap too.)
      authorize: async (raw, request) => {
        const parsed = credentialsSchema.safeParse(raw);
        const email = parsed.success ? parsed.data.email : normalizeEmail(String(raw?.email ?? ""));
        const ip = clientIp(request);
        if (signInAttempts.status(email, ip).blocked) throw new RateLimited();

        const user = parsed.success ? await verifyCredentials(prisma, parsed.data.email, parsed.data.password) : null;
        if (!user) {
          signInAttempts.fail(email, ip);
          return null;
        }
        signInAttempts.succeed(email);
        return user;
      },
    }),
    // "Try the demo": signs into the shared Priya & Sam account with no password (it has none). Public by design,
    // so it only ever signs into that one user, and is rate limited per address.
    Credentials({
      id: "demo",
      name: "Demo",
      credentials: {},
      authorize: async (_raw, request) => {
        if (!demoSignIns.check(clientIp(request)).allowed) throw new RateLimited();
        const user = await prisma.user.findUnique({ where: { id: DEMO_USER.id } });
        return user?.isDemo ? publicUser(user) : null;
      },
    }),
  ],
  // Our own pages: signed-out visitors, and any sign-in error, land on /login.
  pages: { signIn: "/login", error: "/login" },
  callbacks,
});
