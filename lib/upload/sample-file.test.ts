import { describe, expect, it } from "vitest";
import { sampleHandler } from "@/lib/upload/sample-file";
import { SAMPLE_CONTRACTS } from "@/lib/upload/samples";

describe("sampleHandler", () => {
  it("serves every sample contract as a PDF", async () => {
    for (const sample of SAMPLE_CONTRACTS) {
      const res = await sampleHandler(sample.slug);
      expect(res.status, sample.slug).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(new TextDecoder().decode((await res.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    }
  });

  it("serves nothing but the listed samples", async () => {
    for (const slug of ["grand-oak-estate", "../package", "..%2Fpackage", ""]) {
      expect((await sampleHandler(slug)).status, slug).toBe(404);
    }
  });
});
