import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { isoDateSchema } from "@/lib/agent/tools/types";
import { applyDateChange, previewDateChange } from "@/lib/whatif/service";

type Deps = { prisma: PrismaClient; now?: () => Date };

const previewSchema = z.object({ newDate: isoDateSchema });
const applySchema = z.object({ newDate: isoDateSchema, previousDate: isoDateSchema });

const fail = (status: number, code: string, message: string) => Response.json({ ok: false, error: { code, message } }, { status });

async function readBody<S extends z.ZodType>(request: Request, schema: S, help: string): Promise<z.infer<S> | Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail(400, "bad_request", help);
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : fail(400, "bad_request", help);
}

/** POST /api/whatif `{ newDate }`: per-vendor date-change costs. Read-only. */
export async function whatIfHandler(request: Request, deps: Deps): Promise<Response> {
  const body = await readBody(request, previewSchema, 'Send a JSON body like { "newDate": "2027-06-12" }.');
  if (body instanceof Response) return body;

  const result = await previewDateChange(deps.prisma, body.newDate, deps.now?.() ?? new Date());
  if (!result.ok) return fail(result.status, result.code, result.message);
  return Response.json(result);
}

/**
 * POST /api/whatif/apply `{ newDate, previousDate }`: the couple confirmed the
 * move. Only the Confirm button in the what-if panel calls this.
 */
export async function applyWhatIfHandler(request: Request, deps: Deps): Promise<Response> {
  const body = await readBody(request, applySchema, 'Send a JSON body like { "newDate": "2027-06-12", "previousDate": "2027-04-17" }.');
  if (body instanceof Response) return body;

  const result = await applyDateChange(deps.prisma, body, deps.now?.() ?? new Date());
  if (!result.ok) return fail(result.status, result.code, result.message);
  return Response.json({ ok: true, message: result.message });
}
