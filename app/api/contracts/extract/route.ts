import { withSession } from "@/lib/auth/guard";
import { extractHandler } from "@/lib/extraction/handler";
import { createGeminiClient } from "@/lib/llm/gemini";
import { modelChain } from "@/lib/llm/config";
import { createRateLimiter } from "@/lib/rate-limit";

// Module scope: one limiter and one client for the life of the server process.
const limiter = createRateLimiter({ max: 6, windowMs: 60_000 });
const client = createGeminiClient();

async function handlePOST(request: Request) {
  return extractHandler(request, {
    client,
    models: modelChain("extraction"),
    limiter,
    configured: Boolean(process.env.GEMINI_API_KEY),
  });
}

export const POST = withSession(handlePOST);
