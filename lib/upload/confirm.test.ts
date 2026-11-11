import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createRateLimiter } from "@/lib/rate-limit";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase, soleWeddingId } from "@/lib/test-utils/db";
import { loadTimelineInput } from "@/lib/timeline-data";
import { confirmHandler, uploadedContractPath, type ConfirmDeps } from "@/lib/upload/confirm";
import type { ReviewedContract } from "@/lib/upload/schema";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let grandOak: Uint8Array;
let root: string;

beforeAll(async () => {
  ({ prisma, cleanup } = createTestDatabase());
  // The real Grand Oak contract: these quotes are word for word in it.
  grandOak = new Uint8Array(await readFile(path.join(process.cwd(), "seed", "contracts", "grand-oak-estate.pdf")));
}, 60_000);
afterAll(async () => cleanup());
beforeEach(async () => {
  await seedDemo(prisma);
  root = mkdtempSync(path.join(tmpdir(), "vowlet-uploads-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const evidence = (clauseQuote: string, page: number) => ({ clauseQuote, page, flagged: false, acknowledged: false });

function review(over: Partial<ReviewedContract> = {}): ReviewedContract {
  return {
    vendorName: "Grand Oak Estate (uploaded)",
    category: "Venue",
    paypalEmail: "venue@example.com",
    signingDate: "2026-06-12",
    totalCents: 900_000,
    payments: [
      { label: "Venue deposit", amountCents: 300_000, anchor: "signing_date", offsetDays: 0, fixedDate: null, ...evidence("The Client shall pay $3,000 (Venue deposit) upon signing this agreement.", 1) },
      { label: "Venue second installment", amountCents: 300_000, anchor: "wedding_date", offsetDays: -120, fixedDate: null, ...evidence("The Client shall pay $3,000 (Venue second installment) no later than 120 days before the Event Date.", 1) },
      { label: "Venue final balance", amountCents: 300_000, anchor: "wedding_date", offsetDays: -30, fixedDate: null, ...evidence("The Client shall pay $3,000 (Venue final balance) no later than 30 days before the Event Date.", 1) },
    ],
    cancellation: {
      found: true,
      rules: [
        { minNoticeDays: 90, refundPercent: 50, flatFee: 0 },
        { minNoticeDays: 0, refundPercent: 0, flatFee: 0 },
      ],
      ...evidence("Cancellation by the Client: with at least 90 days' written notice, 50% of payments made will be refunded", 2),
    },
    dateChange: {
      found: true,
      rules: [
        { minNoticeDays: 120, feePercent: 5, flatFee: 0 },
        { minNoticeDays: 0, feePercent: 30, flatFee: 0 },
      ],
      ...evidence("Change of Event Date: with at least 120 days' written notice, a fee of 5% of the total contract price applies", 2),
    },
    ...over,
  };
}

function request(body: unknown, file: Uint8Array | string | null = grandOak) {
  const form = new FormData();
  if (file !== null) form.set("file", new File([file as BlobPart], "contract.pdf", { type: "application/pdf" }));
  if (body !== undefined) form.set("review", typeof body === "string" ? body : JSON.stringify(body));
  return new Request("http://localhost/api/contracts/confirm", { method: "POST", body: form });
}

const deps = (over: Partial<ConfirmDeps> = {}): ConfirmDeps => ({
  prisma,
  limiter: createRateLimiter({ max: 100, windowMs: 60_000 }),
  resolveWeddingId: () => soleWeddingId(prisma),
  rootDir: root,
  ...over,
});

async function confirm(body: unknown, file?: Uint8Array | string | null, over?: Partial<ConfirmDeps>) {
  const res = await confirmHandler(request(body, file), deps(over));
  return { status: res.status, body: await res.json() };
}

const uploadedVendor = () => prisma.vendor.findFirst({ where: { name: "Grand Oak Estate (uploaded)" } });

describe("POST /api/contracts/confirm", () => {
  it("writes the vendor, its clauses, payments and terms, linked by clause id, and stores the PDF", async () => {
    const r = await confirm(review());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, vendorName: "Grand Oak Estate (uploaded)" });

    const vendor = await prisma.vendor.findUniqueOrThrow({
      where: { id: r.body.vendorId },
      include: { payments: { include: { clause: true } }, clauses: true, terms: true },
    });
    expect(vendor).toMatchObject({ category: "venue", totalCost: 900_000, paypalEmail: "venue@example.com", status: "active" });
    expect(vendor.signingDate.toISOString()).toBe("2026-06-12T00:00:00.000Z");

    // Path format shared with the vendor page: data/uploads/<vendorId>.pdf
    expect(vendor.contractPath).toBe(`data/uploads/${vendor.id}.pdf`);
    expect(vendor.contractPath).toBe(uploadedContractPath(vendor.id));
    const saved = await readFile(path.join(root, "data", "uploads", `${vendor.id}.pdf`));
    expect(new Uint8Array(saved)).toEqual(grandOak);

    expect(vendor.payments.map((p) => [p.label, p.amount, p.anchor, p.offsetDays, p.status])).toEqual([
      ["Venue deposit", 300_000, "signing_date", 0, "scheduled"],
      ["Venue second installment", 300_000, "wedding_date", -120, "scheduled"],
      ["Venue final balance", 300_000, "wedding_date", -30, "scheduled"],
    ]);
    for (const p of vendor.payments) {
      expect(p.clause).toMatchObject({ kind: "payment", vendorId: vendor.id, summary: p.label, page: 1 });
      expect(p.clause?.text).toContain(`(${p.label})`);
    }

    const cancel = vendor.clauses.find((c) => c.kind === "cancellation");
    const change = vendor.clauses.find((c) => c.kind === "date_change");
    expect(cancel?.page).toBe(2);
    expect(vendor.terms?.clauseIds).toEqual([cancel?.id, change?.id]);
    expect(vendor.terms?.cancellationRules).toEqual(review().cancellation.rules);
    expect(vendor.terms?.dateChangeRules).toEqual(review().dateChange.rules);

    const log = await prisma.eventLog.findFirst({ where: { type: "contract_uploaded" } });
    expect(log?.message).toContain("Grand Oak Estate (uploaded)");
  });

  it("adds the vendor to the signed-in couple's own wedding, and never to the demo", async () => {
    const demoWedding = await prisma.wedding.findFirstOrThrow();
    const owner = await prisma.user.create({ data: { email: "owner@example.com" } });
    const mine = await prisma.wedding.create({ data: { userId: owner.id, coupleNames: "Ana & Ben", date: new Date("2027-09-04"), budget: 0 } });

    const r = await confirm(review(), undefined, { resolveWeddingId: async () => mine.id });
    expect(r.status).toBe(200);

    expect((await prisma.vendor.findUniqueOrThrow({ where: { id: r.body.vendorId } })).weddingId).toBe(mine.id);
    expect(await prisma.vendor.count({ where: { weddingId: mine.id } })).toBe(1);
    expect(await prisma.vendor.count({ where: { weddingId: demoWedding.id } })).toBe(14); // the demo is untouched
    // The first vendor of a new wedding gets the first sandbox payee, not one counted from the demo's 14.
    expect(await uploadedVendor()).toMatchObject({ weddingId: mine.id });
  });

  it("answers 409 for an account that hasn't set up a wedding yet, and saves nothing", async () => {
    const before = await prisma.vendor.count();
    const r = await confirm(review(), undefined, { resolveWeddingId: async () => null });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "no_wedding", message: "Set up your wedding first, then add contracts to it." });
    expect(await prisma.vendor.count()).toBe(before);
  });

  it("puts the new vendor on the dashboard timeline", async () => {
    const r = await confirm(review());
    const input = await loadTimelineInput(prisma, await soleWeddingId(prisma));
    const row = input?.vendors.find((v) => v.id === r.body.vendorId);
    expect(row?.payments).toHaveLength(3);
  });

  it("rejects a flagged term the couple hasn't acknowledged, and saves nothing", async () => {
    const body = review();
    body.payments[2] = { ...body.payments[2], flagged: true, acknowledged: false };
    const r = await confirm(body);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("needs_confirmation");
    expect(r.body.error.message).toContain("Venue final balance");
    expect(await uploadedVendor()).toBeNull();
    expect(existsSync(path.join(root, "data"))).toBe(false);
  });

  it("flags a quote that isn't in the PDF even when the browser didn't, until it is acknowledged", async () => {
    const body = review();
    body.dateChange = { ...body.dateChange, clauseQuote: "Date changes are always free of charge, whenever requested." };
    const r = await confirm(body);
    expect(r.status).toBe(422);
    expect(r.body.error.message).toContain("date-change terms");

    body.dateChange.acknowledged = true;
    expect((await confirm(body)).status).toBe(200);
  });

  it("accepts flagged terms once acknowledged, and takes the page the quote was really found on", async () => {
    const body = review();
    body.cancellation = { ...body.cancellation, page: 9, flagged: true, acknowledged: true };
    const r = await confirm(body);
    expect(r.status).toBe(200);
    const clause = await prisma.clause.findFirst({ where: { vendorId: r.body.vendorId, kind: "cancellation" } });
    expect(clause?.page).toBe(2);
  });

  it("saves terms the contract doesn't have as empty rules, with no clause", async () => {
    const r = await confirm(review({ dateChange: { found: false, rules: [], clauseQuote: "", page: 1, flagged: false, acknowledged: false } }));
    expect(r.status).toBe(200);
    const terms = await prisma.terms.findUniqueOrThrow({ where: { vendorId: r.body.vendorId } });
    expect(terms.dateChangeRules).toEqual([]);
    expect((terms.clauseIds as string[]).length).toBe(1);
  });

  it("assigns a sandbox payee when no PayPal email is given", async () => {
    const r = await confirm(review({ paypalEmail: "" }), undefined, { vendorEmails: "shop1@business.example.com,shop2@business.example.com" });
    const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: r.body.vendorId } });
    // 14 demo vendors already, so this is slot 15: the first of two emails.
    expect(vendor.paypalEmail).toBe("shop1@business.example.com");
  });

  it("rejects a file that isn't a PDF, whatever it is called", async () => {
    const r = await confirm(review(), "just some text pretending to be a PDF");
    expect(r).toMatchObject({ status: 400, body: { error: { code: "not_a_pdf" } } });
    expect(await uploadedVendor()).toBeNull();
  });

  it("rejects a missing file, an empty file and an oversized file", async () => {
    expect((await confirm(review(), null)).status).toBe(400);
    expect((await confirm(review(), new Uint8Array())).status).toBe(400);
    const huge = new Uint8Array(10 * 1024 * 1024 + 1);
    huge.set(new TextEncoder().encode("%PDF-"));
    expect((await confirm(review(), huge)).status).toBe(413);
  });

  it("rejects review JSON that is malformed or breaks the rules", async () => {
    expect((await confirm("{not json")).body.error.code).toBe("invalid_review");
    expect((await confirm(undefined)).body.error.code).toBe("invalid_review");

    const fractional = review();
    fractional.payments[0] = { ...fractional.payments[0], amountCents: 1500.5 };
    expect((await confirm(fractional)).status).toBe(400);

    const negative = review({ totalCents: -100 });
    expect((await confirm(negative)).status).toBe(400);

    const noDate = review();
    noDate.payments[0] = { ...noDate.payments[0], anchor: "fixed", fixedDate: null };
    expect((await confirm(noDate)).status).toBe(400);

    expect((await confirm(review({ payments: [] }))).status).toBe(400);
    expect((await confirm({ ...review(), contractPath: "../../etc/passwd" })).status).toBe(200); // unknown keys are ignored
    const vendor = await uploadedVendor();
    expect(vendor?.contractPath).toBe(`data/uploads/${vendor?.id}.pdf`);
    expect(readdirSync(path.join(root, "data", "uploads"))).toEqual([`${vendor?.id}.pdf`]);
  });

  it("is rate limited", async () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    expect((await confirm(review(), undefined, { limiter })).status).toBe(200);
    expect((await confirm(review(), undefined, { limiter })).status).toBe(429);
  });
});
