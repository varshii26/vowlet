import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXPECTED_DIR, expectedJson, loadExpected } from "@/evals/expected";
import { extractPdfPages } from "@/lib/pdf-text";
import { VENDORS } from "@/lib/seed/demo-data";

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US")}`;

describe("evals/expected", () => {
  it("has one file per sample contract and no strays", () => {
    expect(readdirSync(EXPECTED_DIR).filter((f) => f.endsWith(".json")).sort()).toEqual(VENDORS.map((v) => `${v.slug}.json`).sort());
  });

  it.each(VENDORS.map((v) => [v.slug, v] as const))("%s matches the demo data (run `npm run eval:expected` if this fails)", (slug, spec) => {
    const onDisk = readFileSync(path.join(EXPECTED_DIR, `${slug}.json`), "utf8").replaceAll("\r\n", "\n");
    expect(onDisk).toBe(expectedJson(spec));
  });

  // The files come from the same data the PDFs are made from, so also check them against the PDFs themselves.
  it.each(VENDORS.map((v) => v.slug))("%s: every expected payment amount appears in the contract PDF", async (slug) => {
    const pdf = new Uint8Array(readFileSync(path.join(process.cwd(), "seed", "contracts", `${slug}.pdf`)));
    const text = (await extractPdfPages(pdf)).join("\n");
    for (const p of loadExpected(slug).payments) expect(text, `${p.label}: ${dollars(p.amountCents)}`).toContain(dollars(p.amountCents));
  });
});
