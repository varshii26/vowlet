import { findSample } from "@/lib/upload/samples";
import { readContractFile } from "@/lib/vendors/contract-file";

/**
 * GET /api/contracts/samples/[slug]: one of the sample contracts as a PDF.
 * Only the slugs in SAMPLE_CONTRACTS are served, so the slug never builds an
 * arbitrary path. Server only.
 */
export async function sampleHandler(slug: string, root?: string): Promise<Response> {
  const sample = findSample(slug);
  if (!sample) return Response.json({ ok: false, error: { code: "not_found", message: "No sample contract by that name." } }, { status: 404 });

  const read = await readContractFile(`seed/contracts/${sample.slug}.pdf`, root);
  if (!read.ok) return Response.json({ ok: false, error: { code: "missing_file", message: "The sample contract is missing." } }, { status: 404 });

  return new Response(new Uint8Array(read.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${sample.slug}.pdf"`,
      "Content-Length": String(read.bytes.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
