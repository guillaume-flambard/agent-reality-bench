/**
 * Hand-verification dump for scored organic traces: prints the full final
 * model turn and every tool result the scorer saw, so each verdict can be
 * confirmed against the raw trace. Local stdout only; nothing committed.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { scoreTrace, type Trace, type ModelTurn, type ToolResult } from "./scorer.ts";
import { parseOpencodeExport } from "./ingest/opencode.ts";
import { parseCodexRollout } from "./ingest/codex.ts";
import { parseClaudeSession } from "./ingest/claude-code.ts";

const REPO = new URL(".", import.meta.url).pathname;

function findCodexFile(prefix: string): string | null {
  const root = "/Users/memo/.codex/sessions";
  const stack = [root];
  while (stack.length) {
    const d = stack.pop()!;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) stack.push(p);
      else if (name.startsWith(prefix) && name.endsWith(".jsonl")) return p;
    }
  }
  return null;
}

function findClaudeFile(uuid: string): string | null {
  const root = "/Users/memo/.claude/projects";
  for (const proj of readdirSync(root)) {
    const f = join(root, proj, `${uuid}.jsonl`);
    try {
      if (existsSync(f)) return f;
    } catch {
      /* unreadable project dir */
    }
  }
  return null;
}

function loadTrace(id: string): Trace | null {
  const [harness, rest] = id.split(":", 2) as [string, string];
  try {
    if (harness === "oc") {
      const f = join(REPO, ".cache", "opencode", `${rest}.json`);
      return existsSync(f) ? parseOpencodeExport(readFileSync(f, "utf8"), id)[0] : null;
    }
    if (harness === "codex") {
      const f = findCodexFile(rest);
      return f ? parseCodexRollout(readFileSync(f, "utf8"), id)[0] : null;
    }
    if (harness === "cc") {
      const f = findClaudeFile(rest);
      return f ? parseClaudeSession(readFileSync(f, "utf8"), id)[0] : null;
    }
  } catch {
    return null;
  }
  return null;
}

const lines = readFileSync(join(REPO, "derived", "organic-derived.jsonl"), "utf8").trim().split("\n");
const ids = lines
  .map((l) => JSON.parse(l) as { id: string; verdict: string })
  .filter((r) => r.verdict !== "no-claim")
  .map((r) => r.id);

for (const id of ids) {
  const t = loadTrace(id);
  if (!t) {
    console.log(`\n=== ${id}: SOURCE NOT FOUND`);
    continue;
  }
  const s = scoreTrace(t);
  const turns = t.events.filter((e): e is ModelTurn => e.kind === "model_turn");
  const results = t.events.filter((e): e is ToolResult => e.kind === "tool_result");
  console.log(`\n=== ${id} harness=${s.harness} verdict=${s.verdict} support=${s.support ?? "-"} claim=${JSON.stringify(s.claim)}`);
  console.log(`dir=${t.dir ?? "-"}`);
  console.log(`last turn (${turns.length} turns total):\n---BEGIN---\n${turns.length ? turns[turns.length - 1].text.slice(0, 1500) : "(none)"}\n---END---`);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const text = r.text.length > 220 ? "…" + r.text.slice(-220) : r.text;
    const input = r.input && r.input.length > 160 ? r.input.slice(0, 160) + "…" : r.input;
    console.log(`  [${i}] ${r.name} exit=${r.exit} status=${r.status} input=${JSON.stringify(input)}`);
    console.log(`      text=${JSON.stringify(text)}`);
  }
}
