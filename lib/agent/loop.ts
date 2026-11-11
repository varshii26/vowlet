import { FunctionCallingConfigMode, type Content, type Part } from "@google/genai";
import type { PrismaClient } from "@/generated/prisma/client";
import { focusFromRun, type AgentFocus, type FocusCall } from "@/lib/agent/focus";
import { agentSystemPrompt } from "@/lib/agent/prompt";
import { collectSources, type CitationSource } from "@/lib/agent/sources";
import { describeStep, type AgentStep } from "@/lib/agent/steps";
import { executeTool, toolDeclarations } from "@/lib/agent/tools";
import type { OrderLookup } from "@/lib/agent/tools/types";
import { addUsage, LlmError, ZERO_USAGE, type GeminiClient, type LlmUsage } from "@/lib/llm/gemini";

/**
 * The agent loop: a Claude-style tool-use loop of our own on Gemini, no framework.
 * Ask the model; while it asks for tools, run them in TypeScript and hand the
 * results back; when it answers, return the answer plus any proposals recorded.
 *
 * It yields events as it goes, so the browser can show a live step list. The
 * model never moves money: its only way to act is `propose_action`, which records
 * a proposal the couple approves in the app.
 */

export const MAX_ITERATIONS = 8;
export const DEADLINE_MS = 60_000;
/** No single model call waits longer than this, or than the time left before the deadline. */
export const CALL_TIMEOUT_MS = 30_000;

export type ChatTurn = { role: "user" | "assistant"; text: string };

export type ProposalSummary = {
  id: string;
  kind: string;
  status: string;
  summary: string;
  clauseId: string | null;
  payload: unknown;
};

export type AgentEvent =
  | { type: "thinking"; label: string }
  | ({ type: "step" } & AgentStep)
  | {
      type: "answer";
      text: string;
      proposals: ProposalSummary[];
      model: string | null;
      iterations: number;
      /** True when the answer is incomplete: a step limit, the time limit, or a failure part way. */
      truncated: boolean;
      usage: LlmUsage;
      /** The clause citations tools returned during the run: the only ones the answer may turn into chips. */
      sources: CitationSource[];
      /** What the answer is about on the timeline, derived from the tool calls in code (lib/agent/focus.ts). */
      focus: AgentFocus | null;
    }
  | { type: "error"; message: string };

export type AgentRun = {
  question: string;
  /** Earlier turns of this conversation, as plain text. */
  history?: ChatTurn[];
  client: GeminiClient;
  /** Models to try, in order, for the first answer. The run then stays on the one that answered. */
  models: string[];
  prisma: PrismaClient;
  /** Read-only PayPal order lookup for check_payment_status (lib/paypal.ts `paypalReader()`). Nothing that moves money. */
  paypal?: OrderLookup | null;
  today: Date;
  maxIterations?: number;
  deadlineMs?: number;
  /** Aborted when the browser disconnects: the loop stops without spending more of the free quota. */
  signal?: AbortSignal;
  now?: () => number;
};

const NOTES = {
  steps: "I reached my step limit before I could finish, so this answer may be incomplete. Try asking a narrower question.",
  time: "I ran out of time before I could finish, so this answer may be incomplete. Try asking a narrower question.",
  failed: "I ran into a problem before I could finish.",
  proposals: "The proposals I prepared are below for you to review.",
} as const;

/** A message the couple can read for a model failure. Never shows the raw error. */
export function friendlyLlmMessage(error: unknown): string {
  const code = error instanceof LlmError ? error.code : null;
  switch (code) {
    case "daily_quota":
      return "The assistant has used up its free allowance for today. Please try again tomorrow.";
    case "no_key":
      return "The assistant isn't set up on this server yet.";
    case "rate_limited":
    case "overloaded":
    case "timeout":
      return "The assistant is busy right now. Please try again in a moment.";
    default:
      return "The assistant couldn't answer that. Please try again.";
  }
}


export async function* runAgent(run: AgentRun): AsyncGenerator<AgentEvent> {
  const maxIterations = run.maxIterations ?? MAX_ITERATIONS;
  const deadlineMs = run.deadlineMs ?? DEADLINE_MS;
  const now = run.now ?? Date.now;
  const started = now();

  const contents: Content[] = [
    ...(run.history ?? []).map((turn): Content => ({ role: turn.role === "user" ? "user" : "model", parts: [{ text: turn.text }] })),
    { role: "user", parts: [{ text: run.question }] },
  ];
  const system = agentSystemPrompt(run.today);
  const tools = [{ functionDeclarations: toolDeclarations() }];

  const proposalSummaries = new Map<string, string>();
  const sources = new Map<string, CitationSource>();
  const calls: FocusCall[] = [];
  let model: string | null = null;
  let usage = ZERO_USAGE;
  let iterations = 0;

  /** The answer event, with the proposals recorded so far looked up from the database. */
  async function answer(text: string, note: keyof typeof NOTES | null): Promise<AgentEvent> {
    const rows = proposalSummaries.size
      ? await run.prisma.proposal.findMany({ where: { id: { in: [...proposalSummaries.keys()] } }, orderBy: { createdAt: "asc" } })
      : [];
    const proposals = rows.map((p): ProposalSummary => ({
      id: p.id,
      kind: p.kind,
      status: p.status,
      summary: proposalSummaries.get(p.id) ?? "",
      clauseId: p.clauseId,
      payload: p.payload,
    }));

    const notes = note ? [NOTES[note], ...(proposals.length > 0 ? [NOTES.proposals] : [])] : [];
    const full = [text.trim(), ...notes.map((n) => `(${n})`)].filter(Boolean).join("\n\n");
    const focus = focusFromRun(calls, proposals, run.today);
    return { type: "answer", text: full, proposals, model, iterations, truncated: note !== null, usage, sources: [...sources.values()], focus };
  }

  for (let i = 1; i <= maxIterations; i++) {
    if (run.signal?.aborted) return;
    const remaining = deadlineMs - (now() - started);
    if (remaining <= 0) {
      yield await answer("", "time");
      return;
    }

    yield { type: "thinking", label: i === 1 ? "Understanding your question…" : "Putting the answer together…" };

    // On the last step the tools are switched off, so the model has to answer with what it has.
    const lastStep = i === maxIterations;
    let result;
    try {
      result = await run.client.generateWithFallback(model ? [model] : run.models, {
        contents,
        config: {
          systemInstruction: system,
          tools,
          temperature: 0,
          // A slow model must not carry the run past its deadline.
          httpOptions: { timeout: Math.max(1_000, Math.min(CALL_TIMEOUT_MS, remaining)) },
          ...(lastStep ? { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } } } : {}),
        },
      });
    } catch (error) {
      if (run.signal?.aborted) return;
      // Keep any proposals already recorded: that work is real even if the answer isn't.
      if (proposalSummaries.size > 0) yield await answer("", "failed");
      else yield { type: "error", message: friendlyLlmMessage(error) };
      return;
    }
    if (run.signal?.aborted) return;

    iterations = i;
    model = result.model;
    usage = addUsage(usage, result.usage);

    if (result.functionCalls.length === 0) {
      yield await answer(result.text, lastStep ? "steps" : null);
      return;
    }
    if (lastStep) break; // asked for tools even with them off

    // Hand the model's turn back exactly as it came (Gemini 3 needs its thought signatures), then the results.
    contents.push(result.content);
    const responses: Part[] = [];
    for (const call of result.functionCalls) {
      const outcome = await executeTool(call.name, call.args, { prisma: run.prisma, today: run.today, paypal: run.paypal });
      yield { type: "step", ...describeStep(call.name, call.args, outcome) };
      if (outcome.ok) collectSources(outcome.output, sources);
      calls.push({ tool: call.name, args: call.args, ok: outcome.ok, output: outcome.ok ? outcome.output : null });

      if (outcome.ok && call.name === "propose_action") {
        const out = outcome.output as { proposalId?: unknown; summary?: unknown };
        if (typeof out.proposalId === "string") proposalSummaries.set(out.proposalId, typeof out.summary === "string" ? out.summary : "");
      }
      responses.push({ functionResponse: { name: call.name, response: outcome.ok ? { output: outcome.output } : { error: outcome.error } } });
    }
    contents.push({ role: "user", parts: responses });
  }

  yield await answer("", "steps");
}
