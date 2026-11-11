import type { Account, Profile, Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";

/**
 * Auth.js callbacks, kept as plain functions so they are tested without a server.
 *
 * Sessions are JWTs (Auth.js only supports email + password sign-in that way), so
 * what the app needs from the user rides in the token and is copied onto the session.
 */

/** Google must say it verified the address, or the sign-in is refused. Other providers pass. */
export function signIn({ account, profile }: { account?: Account | null; profile?: Profile }): boolean {
  if (account?.provider === "google") return profile?.email_verified === true;
  return true;
}

/** On sign-in `user` is set: remember who it was. Later calls only carry the token. */
export function jwt({ token, user }: { token: JWT; user?: User }): JWT {
  if (user) {
    token.sub = user.id;
    token.isDemo = user.isDemo === true;
  }
  return token;
}

export function session({ session, token }: { session: Session; token: JWT }): Session {
  if (token.sub) session.user.id = token.sub;
  session.user.isDemo = token.isDemo === true;
  return session;
}
