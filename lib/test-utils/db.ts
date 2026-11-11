import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";
import { createPrismaClient } from "@/lib/db";

/**
 * A real SQLite database in a temp directory, built from the committed
 * migrations. For tests that need to run actual queries.
 */
export function createTestDatabase(): { prisma: PrismaClient; cleanup: () => Promise<void> } {
  const dir = mkdtempSync(path.join(tmpdir(), "vowlet-test-"));
  const url = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  const prisma = createPrismaClient(url);

  return {
    prisma,
    cleanup: async () => {
      await prisma.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * The id of the only wedding in a test database. Most tests seed one wedding and
 * every wedding-scoped function now takes its id, so this is the one-liner for
 * "the wedding this test is about". An empty database gives an id that matches
 * nothing, so "no wedding yet" still behaves as "no wedding yet".
 */
export async function soleWeddingId(prisma: PrismaClient): Promise<string> {
  return (await prisma.wedding.findFirst({ select: { id: true } }))?.id ?? "no-such-wedding";
}
