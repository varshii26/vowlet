import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildAllContracts } from "@/lib/contracts/document";
import { renderContractPdf } from "@/lib/contracts/pdf";
import { formatCents } from "@/lib/money";
import { extractPdfPages } from "@/lib/pdf-text";
import { buildVendorClauses, vendorStyle } from "@/lib/seed/clauses";
import { VENDORS, vendorTotalCents } from "@/lib/seed/demo-data";

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

const contracts = buildAllContracts();
let rendered: { slug: string; bytes: Buffer; pages: string[] }[] = [];

beforeAll(async () => {
  rendered = await Promise.all(
    contracts.map(async (c) => {
      const bytes = await renderContractPdf(c);
      return { slug: c.slug, bytes, pages: (await extractPdfPages(bytes)).map(squash) };
    }),
  );
}, 60_000);

const forVendor = (slug: string) => rendered.find((r) => r.slug === slug)!;

describe("contract documents", () => {
  it("has 14 contracts of 2 or 3 pages", () => {
    expect(contracts).toHaveLength(14);
    for (const c of contracts) expect([2, 3]).toContain(c.pages.length);
  });

  it("gives the addendum vendor a third page with the cancellation terms and a pointer on page 2", () => {
    const dj = contracts.find((c) => c.slug === "dj-marlow-sound")!;
    expect(dj.pages).toHaveLength(3);
    const page2 = JSON.stringify(dj.pages[1]);
    expect(page2).toContain("Addendum A");
    expect(page2).not.toContain("refunded");
  });

  it("includes one schedule page with no terms for some vendors", () => {
    const withSchedule = contracts.filter((c) => c.pages.length === 3 && c.slug !== "dj-marlow-sound");
    expect(withSchedule.map((c) => c.slug).sort()).toEqual(["grand-oak-estate", "lumen-photography", "saffron-and-sage-catering"]);
  });

  it("words the contracts in more than one way", () => {
    const text = (block: { type: string; text?: string }) => block.text ?? "";
    // Cancellation paragraph on page 2 (the addendum vendor points to page 3).
    const cancellationOpenings = new Set(
      contracts.filter((c) => c.slug !== "dj-marlow-sound").map((c) => text(c.pages[1][1]).slice(0, 14)),
    );
    expect(cancellationOpenings).toEqual(new Set(["Cancellation b", "If the Client ", "Termination by"]));

    const intros = contracts.map((c) => text(c.pages[0][1]));
    expect(intros.some((t) => t.startsWith("This Agreement is made on"))).toBe(true);
    expect(intros.some((t) => t.startsWith("Agreement dated"))).toBe(true);
    expect(intros.some((t) => t.includes("agrees to provide"))).toBe(true);
  });
});

describe("rendered PDFs", () => {
  it("renders every contract with the expected number of pages", () => {
    expect(rendered).toHaveLength(14);
    for (const r of rendered) {
      const doc = contracts.find((c) => c.slug === r.slug)!;
      expect(r.pages, r.slug).toHaveLength(doc.pages.length);
    }
  });

  it("contains every seeded clause, word for word, on the page the seed says", () => {
    for (const spec of VENDORS) {
      const { pages } = forVendor(spec.slug);
      const clauses = buildVendorClauses(spec, vendorStyle(spec, VENDORS));
      for (const c of [...clauses.payments, clauses.cancellation, clauses.dateChange]) {
        expect(pages[c.page - 1], `${spec.slug}: "${c.text}" should be on page ${c.page}`).toContain(squash(c.text));
      }
    }
  });

  it("hides the addendum vendor's cancellation terms from page 2", () => {
    const spec = VENDORS.find((v) => v.cancellationInAddendum)!;
    const { pages } = forVendor(spec.slug);
    const cancellation = buildVendorClauses(spec, vendorStyle(spec, VENDORS)).cancellation;
    expect(pages[1]).toContain("Addendum A");
    expect(pages[1]).not.toContain(squash(cancellation.text));
    expect(pages[2]).toContain(squash(cancellation.text));
  });

  it("states each vendor's name and total price on page 1", () => {
    for (const spec of VENDORS) {
      const page1 = forVendor(spec.slug).pages[0];
      expect(page1).toContain(spec.name);
      expect(page1).toContain(`Total contract price: ${formatCents(vendorTotalCents(spec))}.`);
      expect(page1).toContain("Priya & Sam");
      expect(page1).toContain("April 17, 2027");
    }
  });

  it("keeps the ambiguous clause vague", () => {
    const page1 = forVendor("dapper-and-co-tailoring").pages[0];
    expect(page1).toContain("approximately one month before the Event Date");
    expect(page1).not.toContain("30 days");
  });

  it("puts a page footer on every page", () => {
    for (const r of rendered) {
      r.pages.forEach((text, i) => expect(text, r.slug).toContain(`Page ${i + 1} of ${r.pages.length}`));
    }
  });

  it("renders byte-for-byte identically every time", async () => {
    const again = await renderContractPdf(contracts[0]);
    expect(again.equals(rendered[0].bytes)).toBe(true);
  });
});

describe("committed seed/contracts", () => {
  it("match a fresh render, so the PDFs cannot drift from the demo data", async () => {
    for (const r of rendered) {
      const committed = await readFile(path.join(process.cwd(), "seed", "contracts", `${r.slug}.pdf`));
      const pages = (await extractPdfPages(committed)).map(squash);
      expect(pages, `${r.slug}.pdf is stale: run npm run make-contracts`).toEqual(r.pages);
    }
  });
});
