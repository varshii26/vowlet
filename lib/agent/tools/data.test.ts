import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadWedding, resolveVendor } from "@/lib/agent/tools/data";
import { ToolError } from "@/lib/agent/tools/types";
import { seedDemo } from "@/lib/seed/demo";
import { createTestDatabase } from "@/lib/test-utils/db";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let weddingId: string;

beforeAll(async () => {
  ({ prisma, cleanup } = createTestDatabase());
  await seedDemo(prisma);
  weddingId = (await prisma.wedding.findFirstOrThrow()).id;
}, 60_000);
afterAll(async () => cleanup());

const find = (ref: string) => resolveVendor(prisma, weddingId, ref);
const refusal = (ref: string) => find(ref).then(() => "", (e) => (e instanceof ToolError ? e.message : `unexpected ${e}`));

describe("loadWedding", () => {
  it("returns the wedding", async () => {
    expect((await loadWedding(prisma, weddingId)).coupleNames).toBe("Priya & Sam");
  });
});

describe("resolveVendor", () => {
  it("finds a vendor by id", async () => {
    const lumen = await prisma.vendor.findFirstOrThrow({ where: { name: "Lumen Photography" } });
    expect((await find(lumen.id)).name).toBe("Lumen Photography");
  });

  it("finds a vendor by exact name, ignoring case and spaces around it", async () => {
    expect((await find("lumen photography")).name).toBe("Lumen Photography");
    expect((await find("  GRAND OAK ESTATE ")).name).toBe("Grand Oak Estate");
  });

  it("finds a vendor by a category only one vendor has, the way the couple talks", async () => {
    expect((await find("florist")).name).toBe("Bloom & Thistle Florals");
    expect((await find("Photographer")).name).toBe("Lumen Photography");
  });

  it("finds a vendor by part of its name", async () => {
    expect((await find("lumen")).name).toBe("Lumen Photography");
    expect((await find("saffron")).name).toBe("Saffron & Sage Catering");
  });

  it("will not guess between vendors that share a category, and lists them with ids", async () => {
    const message = await refusal("attire"); // Maison Eclat Bridal and Dapper & Co both
    expect(message).toContain("matches several vendors");
    expect(message).toContain("Maison Éclat Bridal");
    expect(message).toContain("Dapper & Co Tailoring");
    expect(message).toContain("id ");
  });

  it("will not guess between vendors that share part of a name", async () => {
    const message = await refusal("ing"); // Catering, Tailoring and Lighting
    expect(message).toContain("matches several vendors");
    expect(message).toContain("Saffron & Sage Catering");
    expect(message).toContain("Starlight Lighting & Decor");
  });

  it("does not treat a two-letter fragment as a name", async () => {
    expect(await refusal("oa")).toContain("No vendor matches");
  });

  it("says what it does know when nothing matches", async () => {
    const message = await refusal("the unicorn rental place");
    expect(message).toContain('No vendor matches "the unicorn rental place"');
    expect(message).toContain("Grand Oak Estate");
    expect(message).toContain("get_vendors");
  });

  it("caps how many names it lists", async () => {
    const message = await refusal("zzz-nothing");
    expect(message.split("(id ").length - 1).toBeLessThanOrEqual(20);
  });

  it("prefers an exact id over a name that happens to look like it", async () => {
    const vendor = await prisma.vendor.findFirstOrThrow({ where: { name: "Harbor Officiants" } });
    expect((await find(vendor.id)).id).toBe(vendor.id);
  });

  it("only looks at this wedding's vendors", async () => {
    await expect(resolveVendor(prisma, "another-wedding", "florist")).rejects.toBeInstanceOf(ToolError);
  });
});
