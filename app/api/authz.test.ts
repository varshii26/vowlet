import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase } from "@/lib/test-utils/db";

/**
 * One test per API route, through the real route module: no session -> 401, another
 * couple's id -> 404 (never 403, never data), your own id -> works. Only the session
 * (Auth.js) and the database handle are replaced; the route, its wrapper, the wedding
 * lookup and the handler are the real ones.
 */
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ prisma: null as unknown, userId: null as string | null }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  get prisma() {
    return state.prisma;
  },
}));
vi.mock("@/lib/auth", () => ({ auth: async () => (state.userId ? { user: { id: state.userId } } : null) }));

// The first call into each route imports it (and its SDKs), which is slow when the whole suite runs at once.
vi.setConfig({ testTimeout: 60_000 });

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let demoUser: string; // owns the seeded Priya & Sam wedding
let ana: { userId: string; weddingId: string; vendorId: string; paymentId: string; proposalId: string };
let nobody: string; // signed up, no wedding yet
let demoVendorId: string;
let demoPaymentId: string;
let demoProposalId: string;

beforeAll(async () => {
  process.env.PAYPAL_CLIENT_ID = "test-id"; // the PayPal client is built lazily and never called in these tests
  process.env.PAYPAL_CLIENT_SECRET = "test-secret";
  delete process.env.GEMINI_API_KEY;
  ({ prisma, cleanup } = createTestDatabase());
  state.prisma = prisma;
}, 60_000);
afterAll(async () => cleanup());

beforeEach(async () => {
  await seedDemo(prisma);
  await prisma.user.deleteMany({ where: { isDemo: false } });
  demoUser = "demo-user";
  const demoWedding = await prisma.wedding.findFirstOrThrow({ where: { userId: demoUser } });
  demoVendorId = (await prisma.vendor.findFirstOrThrow({ where: { weddingId: demoWedding.id, name: "Grand Oak Estate" } })).id;
  demoPaymentId = (await prisma.payment.findFirstOrThrow({ where: { vendor: { weddingId: demoWedding.id }, status: "scheduled" } })).id;
  demoProposalId = (await prisma.proposal.create({ data: { weddingId: demoWedding.id, kind: "message", payload: { text: "demo note" }, status: "pending" } })).id;

  const user = await prisma.user.create({ data: { email: "ana@example.com" } });
  const wedding = await prisma.wedding.create({ data: { userId: user.id, coupleNames: "Ana & Ben", date: new Date("2027-09-04"), budget: 0 } });
  const vendor = await prisma.vendor.create({
    data: { weddingId: wedding.id, name: "Ana's Florist", category: "florist", paypalEmail: "f@example.com", contractPath: "seed/contracts/grand-oak-estate.pdf", signingDate: new Date("2026-08-01"), totalCost: 100_000 },
  });
  const payment = await prisma.payment.create({ data: { vendorId: vendor.id, label: "Florist deposit", amount: 50_000, anchor: "signing_date", status: "paid" } });
  await prisma.terms.create({ data: { vendorId: vendor.id, cancellationRules: [{ minNoticeDays: 0, refundPercent: 0, flatFee: 0 }], dateChangeRules: [{ minNoticeDays: 0, feePercent: 10, flatFee: 0 }], clauseIds: [] } });
  const proposal = await prisma.proposal.create({ data: { weddingId: wedding.id, kind: "message", payload: { text: "ana note" }, status: "pending" } });
  ana = { userId: user.id, weddingId: wedding.id, vendorId: vendor.id, paymentId: payment.id, proposalId: proposal.id };
  nobody = (await prisma.user.create({ data: { email: "nobody@example.com" } })).id;
  state.userId = null;
});

const json = (body: unknown, extra: Record<string, string> = {}) =>
  ({ method: "POST", headers: { "Content-Type": "application/json", ...extra }, body: JSON.stringify(body) }) satisfies RequestInit;
const url = (path: string) => `http://localhost:3000${path}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const asAna = () => (state.userId = ana.userId);

// The routes, called as Next calls them. Imported lazily so the mocks above are in place first.
type Call = () => Promise<Response>;
const routes: Record<string, (id?: string) => Promise<Call>> = {
  "POST /api/agent": async () => { const m = await import("@/app/api/agent/route"); return () => m.POST(new Request(url("/api/agent"), json({ question: "hi" }))); },
  "POST /api/whatif": async () => { const m = await import("@/app/api/whatif/route"); return () => m.POST(new Request(url("/api/whatif"), json({ newDate: "2027-10-02" }))); },
  "POST /api/whatif/apply": async () => { const m = await import("@/app/api/whatif/apply/route"); return () => m.POST(new Request(url("/api/whatif/apply"), json({ newDate: "2027-10-02", previousDate: "2027-09-04" }))); },
  "POST /api/whatif/explain": async () => { const m = await import("@/app/api/whatif/explain/route"); return () => m.POST(new Request(url("/api/whatif/explain"), json({ newDate: "2027-10-02" }))); },
  "POST /api/proposals/[id]": async (id = "x") => { const m = await import("@/app/api/proposals/[id]/route"); return () => m.POST(new Request(url(`/api/proposals/${id}`), json({ action: "dismiss" })), ctx(id)); },
  "POST /api/payments/[id]/order": async (id = "x") => { const m = await import("@/app/api/payments/[id]/order/route"); return () => m.POST(new Request(url(`/api/payments/${id}/order`), json({})), ctx(id)); },
  "POST /api/payments/[id]/capture": async (id = "x") => { const m = await import("@/app/api/payments/[id]/capture/route"); return () => m.POST(new Request(url(`/api/payments/${id}/capture`), json({ orderId: "ORDER-1" })), ctx(id)); },
  "POST /api/vendors/[id]/cancel": async (id = "x") => { const m = await import("@/app/api/vendors/[id]/cancel/route"); return () => m.POST(new Request(url(`/api/vendors/${id}/cancel`), json({ cancelledBy: "couple" })), ctx(id)); },
  "GET /api/vendors/[id]/contract": async (id = "x") => { const m = await import("@/app/api/vendors/[id]/contract/route"); return () => m.GET(new Request(url(`/api/vendors/${id}/contract`)), ctx(id)); },
  "POST /api/contracts/extract": async () => { const m = await import("@/app/api/contracts/extract/route"); return () => m.POST(new Request(url("/api/contracts/extract"), { method: "POST", body: new FormData() })); },
  "POST /api/contracts/confirm": async () => { const m = await import("@/app/api/contracts/confirm/route"); return () => m.POST(new Request(url("/api/contracts/confirm"), { method: "POST", body: new FormData() })); },
  "GET /api/contracts/samples/[slug]": async () => { const m = await import("@/app/api/contracts/samples/[slug]/route"); return () => m.GET(new Request(url("/api/contracts/samples/dapper-co-tailoring")), { params: Promise.resolve({ slug: "dapper-co-tailoring" }) }); },
  "POST /api/demo/reset": async () => { const m = await import("@/app/api/demo/reset/route"); return () => m.POST(new Request(url("/api/demo/reset"), { method: "POST" })); },
};

describe("authentication: no session -> 401 in the app's error shape", () => {
  it.each(Object.keys(routes))("%s", async (name) => {
    const res = await (await routes[name]())();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: { code: "unauthorized", message: "Your session ended. Sign in again." } });
  });

  it("changes nothing for a signed-out caller (the vendor stays active, the proposal pending)", async () => {
    await (await routes["POST /api/vendors/[id]/cancel"](demoVendorId))();
    await (await routes["POST /api/proposals/[id]"](demoProposalId))();
    expect((await prisma.vendor.findUniqueOrThrow({ where: { id: demoVendorId } })).status).toBe("active");
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: demoProposalId } })).status).toBe("pending");
  });
});

describe("authorization: another couple's id is a 404, and nothing changes", () => {
  const notFound = async (res: Response) => {
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    return body;
  };

  it("proposals", async () => {
    asAna();
    await notFound(await (await routes["POST /api/proposals/[id]"](demoProposalId))());
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: demoProposalId } })).status).toBe("pending");
  });

  it.each(["order", "capture"] as const)("payments %s", async (kind) => {
    asAna();
    await notFound(await (await routes[`POST /api/payments/[id]/${kind}`](demoPaymentId))());
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: demoPaymentId } })).paypalOrderId).toBeNull();
  });

  it("vendor cancel (preview and confirm)", async () => {
    asAna();
    await notFound(await (await routes["POST /api/vendors/[id]/cancel"](demoVendorId))());
    const m = await import("@/app/api/vendors/[id]/cancel/route");
    await notFound(await m.POST(new Request(url("/x"), json({ cancelledBy: "couple", confirm: true })), ctx(demoVendorId)));
    expect((await prisma.vendor.findUniqueOrThrow({ where: { id: demoVendorId } })).status).toBe("active");
  });

  it("the contract PDF, with the same answer as an id that doesn't exist", async () => {
    asAna();
    const theirs = await notFound(await (await routes["GET /api/vendors/[id]/contract"](demoVendorId))());
    const missing = await notFound(await (await routes["GET /api/vendors/[id]/contract"]("no-such-vendor"))());
    expect(theirs).toEqual(missing); // a probe can't tell "exists, not yours" from "doesn't exist"
  });

  it("works the other way round too", async () => {
    state.userId = demoUser;
    await notFound(await (await routes["GET /api/vendors/[id]/contract"](ana.vendorId))());
    await notFound(await (await routes["POST /api/proposals/[id]"](ana.proposalId))());
    await notFound(await (await routes["POST /api/payments/[id]/order"](ana.paymentId))());
  });

  it("a signed-in user with no wedding yet gets 404 for any id, and 409 where a wedding is needed (the upload is covered in confirm.test.ts)", async () => {
    state.userId = nobody;
    await notFound(await (await routes["POST /api/proposals/[id]"](demoProposalId))());
    await notFound(await (await routes["GET /api/vendors/[id]/contract"](demoVendorId))());
    await notFound(await (await routes["POST /api/vendors/[id]/cancel"](demoVendorId))());
    await notFound(await (await routes["POST /api/payments/[id]/order"](demoPaymentId))());
    expect((await (await routes["POST /api/whatif"]())()).status).toBe(409);
    expect((await (await routes["POST /api/whatif/apply"]())()).status).toBe(409);
  });
});

describe("your own ids work", () => {
  it("proposal: dismissed", async () => {
    asAna();
    const res = await (await routes["POST /api/proposals/[id]"](ana.proposalId))();
    expect(res.status).toBe(200);
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: ana.proposalId } })).status).toBe("dismissed");
  });

  it("payments: past the ownership check (this one is already paid, so 409, never 404)", async () => {
    asAna();
    expect((await (await routes["POST /api/payments/[id]/order"](ana.paymentId))()).status).toBe(409);
    expect((await (await routes["POST /api/payments/[id]/capture"](ana.paymentId))()).status).toBe(409);
  });

  it("vendor cancel preview", async () => {
    asAna();
    const res = await (await routes["POST /api/vendors/[id]/cancel"](ana.vendorId))();
    expect(res.status).toBe(200);
    expect((await res.json()).vendorName).toBe("Ana's Florist");
  });

  it("the contract PDF", async () => {
    asAna();
    const res = await (await routes["GET /api/vendors/[id]/contract"](ana.vendorId))();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });

  it("what-if previews only your own vendors", async () => {
    asAna();
    const res = await (await routes["POST /api/whatif"]())();
    expect(res.status).toBe(200);
    expect((await res.json()).rows.map((r: { vendorName: string }) => r.vendorName)).toEqual(["Ana's Florist"]);
  });

  it("the demo account reaches its own data", async () => {
    state.userId = demoUser;
    expect((await (await routes["POST /api/vendors/[id]/cancel"](demoVendorId))()).status).toBe(200);
  });
});

describe("CSRF: a state-changing request from another site is refused before anything happens", () => {
  it("answers 403 for a cross-site Origin, even with a valid session, and changes nothing", async () => {
    asAna();
    const m = await import("@/app/api/proposals/[id]/route");
    const res = await m.POST(new Request(url("/x"), json({ action: "dismiss" }, { Origin: "https://evil.example" })), ctx(ana.proposalId));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden_origin");
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: ana.proposalId } })).status).toBe("pending");
  });

  it("accepts the site's own Origin", async () => {
    asAna();
    const m = await import("@/app/api/proposals/[id]/route");
    const res = await m.POST(new Request(url("/x"), json({ action: "dismiss" }, { Origin: "http://localhost:3000", Host: "localhost:3000" })), ctx(ana.proposalId));
    expect(res.status).toBe(200);
  });
});
