import { withSession } from "@/lib/auth/guard";
import { sampleHandler } from "@/lib/upload/sample-file";

// A sample contract PDF for "Try a sample contract" on the upload page.
async function handleGET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return sampleHandler(slug);
}

export const GET = withSession(handleGET);
