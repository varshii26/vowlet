import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter } from "next-auth/adapters";
import type { PrismaClient } from "@/generated/prisma/client";
import { normalizeEmail } from "@/lib/auth/users";

/**
 * Auth.js's Prisma adapter, with emails lower-cased on the way in and out. Google
 * hands over whatever case the account uses, and the email column is unique, so
 * without this "Priya@x.com" and "priya@x.com" could become two users.
 */
export function vowletAdapter(prisma: PrismaClient): Adapter {
  // The adapter is typed for @prisma/client; ours is generated elsewhere but has the same models.
  const base = PrismaAdapter(prisma as unknown as Parameters<typeof PrismaAdapter>[0]);
  return {
    ...base,
    createUser: (user) => base.createUser!({ ...user, email: normalizeEmail(user.email) }),
    getUserByEmail: (email) => base.getUserByEmail!(normalizeEmail(email)),
  };
}
