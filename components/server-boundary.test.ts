import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Browser code must never import server code. The Gemini wrapper and the PayPal
 * client deliberately throw if they are loaded in a browser, and the database,
 * the agent loop and the payment logic must not be bundled into the page. A type
 * check can't see this, and the page would break at runtime, so check it here.
 */
const ROOT = process.cwd();

// Modules that only run on the server.
const SERVER_ONLY = [
  /^@\/lib\/db$/,
  /^@\/lib\/paypal$/,
  /^@\/lib\/llm\/(gemini|config)$/,
  /^@\/lib\/agent\/(handler|loop|prompt|steps|tools)/,
  /^@\/lib\/payments\/(service|handlers|webhook)$/,
  /^@\/lib\/proposals\/(service|handler|data)$/,
  /^@\/lib\/extraction\//,
  /^@\/lib\/rate-limit$/,
  /^@\/lib\/timeline-data$/,
  /^@\/lib\/whatif\/(service|handler|explain)$/,
  /^@\/lib\/pdf-text$/,
  /^@\/lib\/upload\/confirm$/,
  /^@\/lib\/vendors\/(contract-file|page-data)$/,
  /^@\/generated\//,
  /^node:/,
  /^@google\/genai$/,
  /^@paypal\/paypal-server-sdk$/,
];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

/** Value imports only: `import type` is erased and never reaches the browser. */
function valueImports(source: string): string[] {
  return [...source.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
}

const isTest = (file: string) => /\.test\.tsx?$/.test(file) || file.endsWith("test-utils.ts");

describe("browser code stays out of server code", () => {
  const components = walk(path.join(ROOT, "components")).filter((f) => /\.tsx?$/.test(f) && !isTest(f));
  // lib files the browser imports directly.
  const browserLib = [
    "lib/agent/client.ts",
    "lib/agent/sse.ts",
    "lib/agent/limits.ts",
    "lib/payments/client.ts",
    "lib/proposals/client.ts",
    "lib/proposals/view.ts",
    "lib/proposals/payloads.ts",
    "lib/whatif/client.ts",
    "lib/upload/client.ts",
    "lib/upload/draft.ts",
    "lib/upload/schema.ts",
    "lib/vendors/highlight.ts",
    "lib/vendors/links.ts",
  ].map((f) => path.join(ROOT, f));

  it("found the files to check", () => {
    expect(components.length).toBeGreaterThan(8);
    for (const file of browserLib) expect(statSync(file).isFile(), file).toBe(true);
  });

  it("no component imports a server-only module", () => {
    for (const file of components) {
      for (const specifier of valueImports(readFileSync(file, "utf8"))) {
        expect(SERVER_ONLY.some((re) => re.test(specifier)), `${path.relative(ROOT, file)} imports ${specifier}`).toBe(false);
      }
    }
  });

  it("the lib files the browser uses import nothing server-only", () => {
    for (const file of browserLib) {
      for (const specifier of valueImports(readFileSync(file, "utf8"))) {
        expect(SERVER_ONLY.some((re) => re.test(specifier)), `${path.relative(ROOT, file)} imports ${specifier}`).toBe(false);
      }
    }
  });

  it("recognises a violation (so the check can't pass by accident)", () => {
    const bad = `import { runAgent } from "@/lib/agent/loop";\nimport type { AgentEvent } from "@/lib/agent/loop";\nimport { x } from "@/lib/money";`;
    expect(valueImports(bad)).toEqual(["@/lib/agent/loop", "@/lib/money"]);
    expect(SERVER_ONLY.some((re) => re.test("@/lib/agent/loop"))).toBe(true);
    expect(SERVER_ONLY.some((re) => re.test("@/lib/money"))).toBe(false);
  });
});
