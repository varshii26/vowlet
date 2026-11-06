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
