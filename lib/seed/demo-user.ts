/**
 * The shared Priya & Sam demo account. It has no password and is reachable only
 * through "Try the demo" (#108). The same id and email are written by the
 * migration that introduced accounts (prisma/migrations/*_auth_accounts), so
 * keep them in step. `.invalid` is a reserved domain: it can never be a real mailbox.
 */
export const DEMO_USER = {
  id: "demo-user",
  name: "Demo (Priya & Sam)",
  email: "demo@vowlet.invalid",
} as const;
