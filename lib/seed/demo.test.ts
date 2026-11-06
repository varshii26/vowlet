import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createPrismaClient } from "@/lib/db";
import {
  cancellationRulesSchema,
  clauseIdsSchema,
  dateChangeRulesSchema,
} from "@/lib/rules";
import { VENDORS } from "@/lib/seed/demo-data";
import { ensureSeeded, seedDemo } from "@/lib/seed/demo";

// Real SQLite database in a temp dir, built from the committed migrations.
let dir: string;
let prisma: PrismaClient;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "vowlet-seed-"));
  const url = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  prisma = createPrismaClient(url);
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("seedDemo / ensureSeeded", () => {
  it("seeds an empty database and reports it", async () => {
    expect(await ensureSeeded(prisma)).toBe(true);
    expect(await prisma.wedding.count()).toBe(1);
  });

  it("does nothing on a database that already has data", async () => {
    await prisma.payment.updateMany({ data: { status: "void" } });
    expect(await ensureSeeded(prisma)).toBe(false);
    expect(await prisma.payment.count({ where: { status: "void" } })).toBe(23);
  });

  it("writes the full demo dataset", async () => {
    await seedDemo(prisma);
    const wedding = await prisma.wedding.findFirstOrThrow();
    expect(wedding.coupleNames).toBe("Priya & Sam");
    expect(wedding.date.toISOString()).toBe("2027-04-17T00:00:00.000Z");
    expect(await prisma.vendor.count()).toBe(14);
    expect(await prisma.payment.count()).toBe(23);
    expect(await prisma.terms.count()).toBe(14);
    expect(await prisma.clause.count()).toBe(23 + 14 * 2);

    const total = await prisma.vendor.aggregate({ _sum: { totalCost: true } });
    expect(total._sum.totalCost).toBe(3_100_000);
  });

  it("is idempotent: reseeding resets state instead of duplicating", async () => {
    await prisma.payment.updateMany({ data: { status: "void" } });
    await prisma.proposal.create({
      data: { weddingId: (await prisma.wedding.findFirstOrThrow()).id, kind: "message", payload: {} },
    });
    await seedDemo(prisma);
    expect(await prisma.wedding.count()).toBe(1);
    expect(await prisma.payment.count()).toBe(23);
    expect(await prisma.payment.count({ where: { status: "void" } })).toBe(0);
    expect(await prisma.proposal.count()).toBe(0);
  });

  it("marks signing-date deposits paid and everything else scheduled", async () => {
    const payments = await prisma.payment.findMany();
    for (const p of payments) {
      if (p.anchor === "signing_date") {
        expect(p.status).toBe("paid");
        expect(p.paidAt).not.toBeNull();
      } else {
        expect(p.status).toBe("scheduled");
        expect(p.paidAt).toBeNull();
      }
    }
  });

  it("stores anchors and offsets instead of due dates", async () => {
    const venue = await prisma.vendor.findFirstOrThrow({
      where: { name: "Grand Oak Estate" },
      include: { payments: true },
    });
    expect(venue.payments.map((p) => [p.anchor, p.offsetDays]).sort()).toEqual(
      [
        ["signing_date", 0],
        ["wedding_date", -120],
        ["wedding_date", -30],
      ].sort(),
    );
    const dj = await prisma.payment.findFirstOrThrow({ where: { label: "DJ booking fee" } });
    expect(dj.anchor).toBe("fixed");
    expect(dj.fixedDate?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("links every payment to a clause of the same vendor, and terms to real clauses", async () => {
    const payments = await prisma.payment.findMany({ include: { clause: true } });
    for (const p of payments) {
      expect(p.clause?.vendorId).toBe(p.vendorId);
      expect(p.clause?.kind).toBe("payment");
    }
    const allTerms = await prisma.terms.findMany();
    for (const t of allTerms) {
      cancellationRulesSchema.parse(t.cancellationRules);
      dateChangeRulesSchema.parse(t.dateChangeRules);
      const ids = clauseIdsSchema.parse(t.clauseIds);
      const clauses = await prisma.clause.findMany({ where: { id: { in: ids } } });
      expect(clauses.map((c) => c.kind).sort()).toEqual(["cancellation", "date_change"]);
      expect(clauses.every((c) => c.vendorId === t.vendorId)).toBe(true);
    }
  });

  it("puts the addendum vendor's cancellation clause on page 3", async () => {
    const spec = VENDORS.find((v) => v.cancellationInAddendum)!;
    const clause = await prisma.clause.findFirstOrThrow({
      where: { kind: "cancellation", vendor: { name: spec.name } },
    });
    expect(clause.page).toBe(3);
  });
});
