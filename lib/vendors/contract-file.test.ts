import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase, soleWeddingId } from "@/lib/test-utils/db";
import { contractHandler, readContractPages, resolveContractPath } from "@/lib/vendors/contract-file";

const ROOT = process.cwd();

describe("resolveContractPath", () => {
  it("accepts PDFs inside the seed and upload folders", () => {
    expect(resolveContractPath("seed/contracts/grand-oak-estate.pdf", ROOT)).toBe(path.resolve(ROOT, "seed/contracts/grand-oak-estate.pdf"));
    expect(resolveContractPath("data/uploads/abc123.pdf", ROOT)).toBe(path.resolve(ROOT, "data/uploads/abc123.pdf"));
  });

  it.each([
    ["../secret.pdf"],
    ["seed/contracts/../../package.pdf"],
    ["seed/contracts/../../../outside.pdf"],
    ["data/uploads/../../.env.pdf"],
    ["seed/other/file.pdf"],
    ["seed/contracts"],
    ["seed/contracts/.pdf/.."],
    ["/etc/passwd.pdf"],
    ["C:/Windows/win.pdf"],
    ["C:\\Windows\\win.pdf"],
    ["seed/contracts/grand-oak-estate.txt"],
    [".env.local"],
    ["seed/contracts/a.pdf\0.png"],
    [""],
  ])("refuses %j", (p) => {
    expect(resolveContractPath(p, ROOT)).toBeNull();
  });
});

describe("GET /api/vendors/[id]/contract", () => {
  let prisma: PrismaClient;
  let cleanup: () => Promise<void>;
  beforeAll(() => {
    ({ prisma, cleanup } = createTestDatabase());
  }, 60_000);
  afterAll(async () => cleanup());
  beforeEach(async () => seedDemo(prisma));

  const vendorNamed = (name: string) => prisma.vendor.findFirstOrThrow({ where: { name } });

  it("serves a seeded contract inline as a PDF", async () => {
    const vendor = await vendorNamed("Grand Oak Estate");
    const res = await contractHandler(vendor.id, { prisma, resolveWeddingId: () => soleWeddingId(prisma) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="grand-oak-estate.pdf"');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("answers 404 for an unknown vendor", async () => {
    const res = await contractHandler("nope", { prisma, resolveWeddingId: () => soleWeddingId(prisma) });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("answers 404 when the file is missing", async () => {
    const vendor = await vendorNamed("Grand Oak Estate");
    await prisma.vendor.update({ where: { id: vendor.id }, data: { contractPath: "data/uploads/does-not-exist.pdf" } });
    const res = await contractHandler(vendor.id, { prisma, resolveWeddingId: () => soleWeddingId(prisma) });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("missing_file");
  });

  it.each([["../../package.json"], ["seed/contracts/../../prisma/dev.pdf"], ["/etc/passwd.pdf"], ["prisma/schema.prisma"]])(
    "refuses a contract path outside the contract folders: %j",
    async (contractPath) => {
      const vendor = await vendorNamed("Grand Oak Estate");
      await prisma.vendor.update({ where: { id: vendor.id }, data: { contractPath } });
      const res = await contractHandler(vendor.id, { prisma, resolveWeddingId: () => soleWeddingId(prisma) });
      expect(res.status).toBe(403);
      expect(res.headers.get("content-type")).not.toBe("application/pdf");
    },
  );

  describe("with a temporary repo root", () => {
    let root: string;
    beforeAll(() => {
      root = mkdtempSync(path.join(tmpdir(), "vowlet-contracts-"));
      mkdirSync(path.join(root, "data/uploads"), { recursive: true });
      writeFileSync(path.join(root, "secret.pdf"), "%PDF-secret");
      writeFileSync(path.join(root, "data/uploads/up1.pdf"), "%PDF-uploaded");
    });
    afterAll(() => rmSync(root, { recursive: true, force: true }));

    it("serves an uploaded contract", async () => {
      const vendor = await vendorNamed("Grand Oak Estate");
      await prisma.vendor.update({ where: { id: vendor.id }, data: { contractPath: "data/uploads/up1.pdf" } });
      const res = await contractHandler(vendor.id, { prisma, resolveWeddingId: () => soleWeddingId(prisma), root });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("%PDF-uploaded");
    });

    it("refuses a symlink in the upload folder that points outside it", async (ctx) => {
      try {
        symlinkSync(path.join(root, "secret.pdf"), path.join(root, "data/uploads/link.pdf"));
      } catch {
        ctx.skip(); // Creating symlinks needs extra rights on Windows.
      }
      const vendor = await vendorNamed("Grand Oak Estate");
      await prisma.vendor.update({ where: { id: vendor.id }, data: { contractPath: "data/uploads/link.pdf" } });
      expect((await contractHandler(vendor.id, { prisma, resolveWeddingId: () => soleWeddingId(prisma), root })).status).toBe(403);
    });
  });
});

describe("readContractPages", () => {
  it("returns the text of each page of a seeded contract", async () => {
    const pages = await readContractPages("seed/contracts/grand-oak-estate.pdf");
    expect(pages).toHaveLength(3);
    expect(pages?.[0]).toContain("Venue Rental Agreement");
  });

  it("returns null for a forbidden or missing file", async () => {
    expect(await readContractPages("../package.json")).toBeNull();
    expect(await readContractPages("data/uploads/missing.pdf")).toBeNull();
  });
});
