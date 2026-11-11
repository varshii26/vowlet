import "server-only";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { vowletAdapter } from "@/lib/auth/adapter";
import * as callbacks from "@/lib/auth/callbacks";
import { credentialsSchema, verifyCredentials } from "@/lib/auth/users";
import { prisma } from "@/lib/db";

/**
 * Sign-in with Google or an email and a password (Auth.js v5). `auth()` returns
 * the signed-in user's session on the server; `signIn` and `signOut` are the
 * server actions the sign-in pages call. The auth routes are
 * app/api/auth/[...nextauth]; new accounts are made by POST /api/register.
 *
 * Needs AUTH_SECRET. Google needs AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET and is
 * simply left out without them, so the app still runs with email + password.
 */

export const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

/** A signed-in session lasts two weeks. */
const SESSION_DAYS = 14;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: vowletAdapter(prisma),
  session: { strategy: "jwt", maxAge: SESSION_DAYS * 24 * 60 * 60 },
  // Behind Render's proxy the host header is the public one; AUTH_URL names it for callbacks.
  trustHost: true,
  providers: [
    ...(googleEnabled ? [Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET })] : []),
    Credentials({
      credentials: { email: {}, password: {} },
      // Any failure is a plain "no": the sign-in page shows one message for all of them.
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw);
        return parsed.success ? verifyCredentials(prisma, parsed.data.email, parsed.data.password) : null;
      },
    }),
  ],
  callbacks,
});
