import { requestWeddingId } from "@/lib/auth/request-wedding";
import { prisma } from "@/lib/db";
import { modelChain } from "@/lib/llm/config";
import { createGeminiClient } from "@/lib/llm/gemini";
import { createRateLimiter } from "@/lib/rate-limit";
import { explainWhatIfHandler } from "@/lib/whatif/handler";

// Module scope: one limiter and one client for the life of the server process.
// A summary is a nice-to-have on top of the computed table, so keep it quick:
// a short timeout, no long waits, and the code-written summary when it misses.
const limiter = createRateLimiter({ max: 20, windowMs: 60_000 });
const client = createGeminiClient({ timeoutMs: 10_000, maxRetries: 0, maxWaitMs: 2_000 });

export async function POST(request: Request) {
  return explainWhatIfHandler(request, {
    prisma,
    resolveWeddingId: requestWeddingId,
    client,
    models: modelChain("agent"),
    limiter,
    configured: Boolean(process.env.GEMINI_API_KEY),
  });
}
