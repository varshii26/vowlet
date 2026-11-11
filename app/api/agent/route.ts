import { withSession } from "@/lib/auth/guard";
import { agentHandler } from "@/lib/agent/handler";
import { requestWeddingId } from "@/lib/auth/request-wedding";
import { prisma } from "@/lib/db";
import { modelChain } from "@/lib/llm/config";
import { createGeminiClient } from "@/lib/llm/gemini";
import { paypalReader } from "@/lib/paypal";
import { createRateLimiter } from "@/lib/rate-limit";

// Module scope: one limiter and one client for the life of the server process.
// Each question spends free-tier quota and the endpoint is public, so 8 a minute.
const limiter = createRateLimiter({ max: 8, windowMs: 60_000 });
// A short retry budget: the agent loop has its own 60 s deadline to keep.
const client = createGeminiClient({ timeoutMs: 30_000, maxRetries: 1, maxWaitMs: 8_000 });

async function handlePOST(request: Request) {
  return agentHandler(request, {
    client,
    models: modelChain("agent"),
    prisma,
    // Read-only: an object holding only getOrder. The agent never gets the full PayPal client.
    paypal: paypalReader(),
    limiter,
    resolveWeddingId: requestWeddingId,
    configured: Boolean(process.env.GEMINI_API_KEY),
  });
}

export const POST = withSession(handlePOST);
