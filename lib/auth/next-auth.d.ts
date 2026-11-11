import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string; isDemo: boolean } & DefaultSession["user"];
  }
  interface User {
    isDemo?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    isDemo?: boolean;
  }
}
