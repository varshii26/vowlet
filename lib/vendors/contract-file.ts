import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";
import { extractPdfPages } from "@/lib/pdf-text";

/**
 * Reading a vendor's contract PDF from disk. Server only.
 *
 * `Vendor.contractPath` is repo-relative: seeded contracts live in
 * `seed/contracts/`, uploaded ones in `data/uploads/`. Nothing outside those two
 * folders is ever served, whatever the database says.
 */
export const CONTRACT_DIRS = ["seed/contracts", "data/uploads"] as const;

const inside = (dir: string, file: string) => {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/**
 * The absolute path of a contract, or null if `contractPath` points anywhere
 * but a PDF inside one of the contract folders (absolute paths, `..`, other
 * file types). Does not touch the disk.
 */
export function resolveContractPath(contractPath: string, root: string = process.cwd()): string | null {
  if (!contractPath || contractPath.includes("\0")) return null;
  if (path.isAbsolute(contractPath) || path.win32.isAbsolute(contractPath) || path.posix.isAbsolute(contractPath)) return null;
  if (path.extname(contractPath).toLowerCase() !== ".pdf") return null;
  const file = path.resolve(root, contractPath);
  return CONTRACT_DIRS.some((dir) => inside(path.resolve(root, dir), file)) ? file : null;
}

export type ContractFile =
  | { ok: true; file: string; bytes: Buffer }
  | { ok: false; reason: "forbidden" | "missing" };

/**
 * Read a contract's bytes. Also resolves symlinks, so a link inside a contract
 * folder cannot point outside it.
 */
export async function readContractFile(contractPath: string, root: string = process.cwd()): Promise<ContractFile> {
  const file = resolveContractPath(contractPath, root);
  if (!file) return { ok: false, reason: "forbidden" };
  let real: string;
  try {
    real = await realpath(file);
  } catch {
    return { ok: false, reason: "missing" };
  }
  const realRoot = await realpath(root).catch(() => root);
  const allowed = await Promise.all(CONTRACT_DIRS.map((dir) => realpath(path.resolve(realRoot, dir)).catch(() => null)));
  if (!allowed.some((dir) => dir !== null && inside(dir, real))) return { ok: false, reason: "forbidden" };
  try {
    return { ok: true, file: real, bytes: await readFile(real) };
  } catch {
    return { ok: false, reason: "missing" };
  }
}

// Page text per file, reused until the file changes. Extraction takes a moment
// and the same contracts are opened again and again during a demo.
const pageCache = new Map<string, { key: string; pages: Promise<string[]> }>();

/** The text of each page of a contract, or null if it can't be read. */
export async function readContractPages(contractPath: string, root: string = process.cwd()): Promise<string[] | null> {
  const file = resolveContractPath(contractPath, root);
  if (!file) return null;
  let key: string;
  try {
    const info = await stat(file);
    key = `${info.mtimeMs}:${info.size}`;
  } catch {
    return null;
  }
  const cached = pageCache.get(file);
  if (cached?.key === key) return cached.pages.catch(() => null);

  const pages = readContractFile(contractPath, root).then((read) => {
    if (!read.ok) throw new Error(read.reason);
    return extractPdfPages(read.bytes);
  });
  pageCache.set(file, { key, pages });
  pages.catch(() => pageCache.delete(file));
  return pages.catch(() => null);
}

const fail = (status: number, code: string, message: string) => Response.json({ ok: false, error: { code, message } }, { status });

/** GET /api/vendors/[id]/contract: the vendor's contract PDF, shown inline. */
export async function contractHandler(vendorId: string, deps: { prisma: PrismaClient; root?: string }): Promise<Response> {
  const vendor = await deps.prisma.vendor.findUnique({ where: { id: vendorId }, select: { contractPath: true } });
  if (!vendor) return fail(404, "not_found", "No vendor with that id.");

  const read = await readContractFile(vendor.contractPath, deps.root);
  if (!read.ok) {
    return read.reason === "forbidden"
      ? fail(403, "forbidden", "This contract can't be served.")
      : fail(404, "missing_file", "The contract file is missing.");
  }

  const name = path.basename(read.file).replace(/[^\w.-]/g, "_");
  return new Response(new Uint8Array(read.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "Content-Length": String(read.bytes.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache",
    },
  });
}
