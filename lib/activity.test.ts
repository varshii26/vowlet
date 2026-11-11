import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { TODAY, ok } from "@/lib/agent/tools/test-utils";
import { activityTone, loadActivity } from "@/lib/activity";
import { resolveProposal } from "@/lib/proposals/service";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase, soleWeddingId } from "@/lib/test-utils/db";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(() => {
  ({ prisma, cleanup } = createTestDatabase());
}, 60_000);
afterAll(async () => cleanup());
beforeEach(async () => seedDemo(prisma));

describe("activityTone", () => {
  it.each([
    ["payment_paid", "success"],
    ["proposal_approved", "success"],
    ["contract_uploaded", "success"],
    ["payment_amount_mismatch", "warning"],
    ["payment_order_mismatch", "warning"],
    ["payment_unexpected_capture", "warning"],
    ["payment_duplicate_capture", "warning"],
    ["proposal_created", "neutral"],
    ["proposal_dismissed", "neutral"],
    ["demo_seeded", "neutral"],
    ["something_new", "neutral"],
  ])("%s -> %s", (type, tone) => {
    expect(activityTone(type)).toBe(tone);
  });
});

describe("loadActivity", () => {
  it("starts with just the demo being loaded, so Reset demo clears the feed", async () => {
    await ok(prisma, "propose_action", { kind: "message", message: "A note for you.", reason: "because" });
    await seedDemo(prisma);
    const items = await loadActivity(prisma, await soleWeddingId(prisma));
    expect(items.map((i) => i.type)).toEqual(["demo_seeded"]);
    expect(items[0].message).toBe("Loaded demo wedding for Priya & Sam");
  });

  it("lists the newest first, and records a proposal being made and dismissed by name", async () => {
    const { proposalId } = await ok(prisma, "propose_action", { kind: "reschedule", newDate: "2027-06-12", reason: "because" });
    await resolveProposal(prisma, await soleWeddingId(prisma), proposalId, "dismiss", TODAY);
    const items = await loadActivity(prisma, await soleWeddingId(prisma));
    expect(items.map((i) => i.type)).toEqual(["proposal_dismissed", "proposal_created", "demo_seeded"]);
    expect(items[0].message).toBe("Dismissed: Move the wedding");
    expect(items[1].message).toMatch(/^Proposed: /);
  });

  it("records an approval with what it did", async () => {
    const { proposalId } = await ok(prisma, "propose_action", { kind: "reschedule", newDate: "2027-06-12", reason: "because" });
    await resolveProposal(prisma, await soleWeddingId(prisma), proposalId, "approve", TODAY);
    const [latest] = await loadActivity(prisma, await soleWeddingId(prisma));
    expect(latest).toMatchObject({ type: "proposal_approved", tone: "success" });
    expect(latest.message).toContain("2027-06-12");
  });

  it("shows at most the limit", async () => {
    for (let i = 0; i < 5; i++) await ok(prisma, "propose_action", { kind: "message", message: `Note number ${i}.`, reason: "because" });
    expect(await loadActivity(prisma, await soleWeddingId(prisma), 3)).toHaveLength(3);
  });

  it("gives ISO timestamps", async () => {
    const [item] = await loadActivity(prisma, await soleWeddingId(prisma));
    expect(new Date(item.at).toISOString()).toBe(item.at);
  });
});
