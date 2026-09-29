/**
 * Score the organic session corpus that already exists on this machine,
 * read-only: OpenCode session exports, Codex rollouts, Claude Code session
 * JSONLs. Traces are read from their harness storage and never committed;
 * only derived verdicts land in alignment/v1/derived/organic-derived.jsonl.
 *
 * Privacy gate, per SPEC.md: sessions are included only when their working
 * directory sits under an allowlisted engineering root, and only work from
 * before 2026-09-28T00:00Z is read.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";

import { scoreTrace, summarize, type Trace, type V1Score } from "./scorer.ts";
import { exportOpencodeSession } from "./export-opencode.ts";
import { assertDirectory } from "./driver/paths.ts";
import { parseOpencodeExport } from "./ingest/opencode.ts";
import { parseCodexRollout } from "./ingest/codex.ts";
import { parseClaudeSession } from "./ingest/claude-code.ts";

const CUTOFF = new Date("2026-09-28T00:00:00Z").getTime();
const ALLOWED = [
  "/Users/memo/projects",
  "/Users/memo/oss",
  "/Users/memo/.config/opencode",
  "/Users/memo/worldstation",
];

const REPO = new URL(".", import.meta.url).pathname;
const CACHE = join(REPO, ".cache");
const DERIVED = join(REPO, "derived");

const inScope = (dir: string | null): boolean =>
  !!dir && ALLOWED.some((root) => dir === root || dir.startsWith(root + "/"));

function okMtime(ms: number): boolean {
  return ms < CUTOFF;
}

function jsonlWrite(file: string, rows: object[]) {
  // The derived write asserts its target directory exists before touching
  // anything, per the silent-wrong-directory failure in the harness notes.
  assertDirectory(join(DERIVED));
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

interface Row extends V1Score {
  source: string;
  turns: number;
  tools: number;
}

interface OpencodeSessionMeta {
  id: string;
  directory: string;
  created: number;
  updated: number;
}
async function opencodeTraces(): Promise<Trace[]> {
  // `opencode session list` is scoped to the invocation directory's project;
  // the home-directory project is global, so spawn from there.
  const HOME = "/Users/memo";
  const out = execFileSync(
    "opencode",
    ["session", "list", "--format", "json", "-n", "600"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd: HOME },
  );
    const sessions: OpencodeSessionMeta[] = JSON.parse(out);
  const keep = sessions.filter((s) => s.updated < CUTOFF && inScope(s.directory));
  const traces: Trace[] = [];
  for (const s of keep) {
    const cacheFile = join(CACHE, "opencode", `${s.id}.json`);
    let raw: string;
    try {
      if (existsSync(cacheFile)) {
        raw = readFileSync(cacheFile, "utf8");
      } else {
        // The only sanctioned export path (extension export-opencode.ts):
        // shell FILE redirect, never a pipe, and the destination must exist
        // AND parse as JSON before anything consumes it. Recorded as
        // harness friction; the regression test pins it.
        mkdirSync(join(CACHE, "opencode"), { recursive: true });
        exportOpencodeSession(s.id, { cwd: HOME, outFile: cacheFile });
        raw = readFileSync(cacheFile, "utf8");
      }
      traces.push(...parseOpencodeExport(raw, `oc:${s.id}`));
    } catch (e) {
      console.warn(`! opencode ${s.id}: ${(e as Error).message}`.slice(0, 120));
    }
  }
  return traces;
}

function filesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(root);
  return out;
}

function codexTraces(): Trace[] {
  const files = filesUnder("/Users/memo/.codex/sessions").filter((f) => f.endsWith(".jsonl") && okMtime(statSync(f).mtimeMs));
  const traces: Trace[] = [];
  for (const f of files) {
    traces.push(...parseCodexRollout(readFileSync(f, "utf8"), `codex:${basename(f, ".jsonl").slice(0, 24)}`));
  }
  return traces;
}

function claudeDirToPath(segment: string): string {
  return "/" + segment.split("-").filter(Boolean).join("/");
}

function claudeTraces(): Trace[] {
  const root = "/Users/memo/.claude/projects";
  if (!existsSync(root)) return [];
  const traces: Trace[] = [];
  for (const proj of readdirSync(root, { withFileTypes: true })) {
    if (!proj.isDirectory()) continue;
    const dirPath = claudeDirToPath(proj.name);
    if (!inScope(dirPath)) continue;
    for (const f of filesUnder(join(root, proj.name)).filter((f) => f.endsWith(".jsonl") && okMtime(statSync(f).mtimeMs))) {
      traces.push(...parseClaudeSession(readFileSync(f, "utf8"), `cc:${basename(f, ".jsonl")}`));
    }
  }
  return traces;
}

async function main() {
  // The cache and derived directories are named explicitly here, anchored at
  // the module URL, and every write reads back through the guards.
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(DERIVED, { recursive: true });
  const all = [...(await opencodeTraces()), ...codexTraces(), ...claudeTraces()];
  // The durable privacy gate: parse-time dirs are re-checked here for every
  // source, so no harness's sloppy layout decides what enters the corpus.
  const traces = all.filter((t) => inScope(t.dir ?? null));
  const rows: Row[] = [];
  for (const t of traces) {
    const s = scoreTrace(t);
    rows.push({
      ...s,
      turns: t.events.filter((e) => e.kind === "model_turn").length,
      tools: t.events.filter((e) => e.kind === "tool_result").length,
      source: t.source,
    });
  }
  jsonlWrite(join(DERIVED, "organic-derived.jsonl"), rows);
  console.error("derived written:", join(DERIVED, "organic-derived.jsonl"), existsSync(join(DERIVED, "organic-derived.jsonl")));
  console.log(JSON.stringify(summarize(rows), null, 1));
  const empty = rows.filter((r) => r.turns === 0).length;
  console.log(`traces parsed: ${rows.length} (no turns in ${empty})`);
}

main();
