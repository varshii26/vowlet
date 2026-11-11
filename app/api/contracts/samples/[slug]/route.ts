import { sampleHandler } from "@/lib/upload/sample-file";

// A sample contract PDF for "Try a sample contract" on the upload page.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return sampleHandler(slug);
}
