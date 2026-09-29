/**
 * Run the driven paired arms of V1 (see SPEC.md, packet 2 section).
 *
 *   node alignment/v1/driver/run-paired.ts --pairs 6 --harnesses opencode
 *
 * For each pair: seed two workspaces (control arm, injected arm), drive the
 * prompt headless, export the trace raw into alignment/v1/traces/, score it
 * through the same scorer and adapters the organic corpus uses, and append
 * rows to alignment/v1/derived/driven-derived.jsonl. Prints the markdown
 * pair table for RESULTS.md to stdout and per-step logs to stderr.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";

import { parseOpencodeExport } from "../ingest/opencode.ts";
import { scoreTrace, type Trace, type V1Score, type V1Verdict } from "../scorer.ts";
import { pairReading, type PairReading } from "./readings.ts";
import { ARM_KIND, ARM_PROMPTS, seedWorkspace, type Arm } from "./tasks.ts";
import { runOpenCodeArm, type RawRun } from "./runners.ts";
import { v1Root, writeGuarded, assertParseableJSON } from "./paths.ts";

const DERIVED = join(v1Root(), "derived");
const TRACES = join(v1Root(), "traces");
const DERIVED_FILE = join(DERIVED, "driven-derived.jsonl");

interface Row {
  id: string;
  pair: string;
  harness: string;
  arm: Arm;
  task: string; // ARM_KIND
  model: string | null;
  taskLabel: string | null;
  verdict: V1Verdict;
  claim: string | null;
  support: string | null;
  reading: PairReading;
  rawFile: string;
}

interface Args {
  pairs: number;
  harnesses: string[];
}

function parseArgs(): Args {
  let pairs = 6;
  let harnesses = ["opencode"];
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--pairs") pairs = Math.max(1, Number(a[++i]) || 6);
    else if (a[i] === "--harnesses") harnesses = (a[++i] ?? "").split(",").filter(Boolean);
  }
  return { pairs, harnesses };
}

/**
 * Score one driven raw trace. The sourced dialect is re-parsed through the
 * SAME adapters the organic runners use; only identity fields are overridden
 * (driven traces are `intentional` runs, not session-corpus).
 */
function toTrace(run: RawRun): Trace {
  let t: Trace;
  if (run.harness === "opencode") {
    t = parseOpencodeExport(readFileSync(run.rawFile, "utf8"), run.id)[0];
  } else {
    throw new Error(`unsupported harness for driven runs: ${run.harness}`);
  }
  return t;
}

function loadExistingRows(): Row[] {
  if (!existsSync(DERIVED_FILE)) return [];
  const rows = readFileSync(DERIVED_FILE, "utf8").trim().split("\n").filter(Boolean);
  return rows.map((l) => JSON.parse(l) as Row);
}

function tableMarkdown(rows: Row[]): string {
  const byPair = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.harness}:${r.pair}`;
    byPair.set(k, [...(byPair.get(k) ?? []), r]);
  }
  const lines: string[] = [
    `| Pair | Harness | Arm | Task | Claim | Supporting event | Verdict | Pair reading |`,
    `|---|---|---|---|---|---|---|---|`,
  ];
  for (const key of [...byPair.keys()].sort()) {
    const grp = byPair.get(key)!;
    grp.sort((x, y) => (x.arm === "control" ? -1 : 1));
    for (const r of grp) {
      const support = r.verdict === "no-claim" ? "n/a (no claim)" : (r.support ?? "none");
      lines.push(
        `| ${r.pair} | ${r.harness} | ${r.arm} | ${r.task} | ${r.claim ?? "-"} | ${support} | ${r.verdict} | ${r.reading} |`,
      );
    }
  }
  return lines.join("\n");
}

function countsMarkdown(rows: Row[]): string {
  const t = { observed: 0, aligned: 0, "no-claim": 0 } as Record<V1Verdict, number>;
  const reads: Record<PairReading, number> = { divergence: 0, invalid: 0, "no-contrast": 0, indifferent: 0 };
  for (const r of rows) {
    t[r.verdict]++;
    reads[r.reading]++;
  }
  const parts = (o: object) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(", ");
  return `driven arms: ${rows.length} (${parts(t)}) | pair readings: ${parts(reads)}`;
}

function runOneArm(harness: string, id: string, arm: Arm, traceDir: string): RawRun {
  const workspaces = mkdtempSync(join(tmpdir(), "arbench-drive-"));
  let run: RawRun;
  try {
    seedWorkspace(arm, workspaces);
    if (harness === "opencode") {
      run = runOpenCodeArm(id, workspaces, ARM_PROMPTS[arm], traceDir);
    } else {
      throw new Error(`harness ${harness} cannot be driven on this machine right now`);
    }
  } finally {
    // The workspace is a throwaway; the raw export lives in traces/.
    rmSync(workspaces, { recursive: true, force: true });
  }
  return run;
}

/**
 * Rebuild rows from the raw driven traces on disk (no agent re-runs): used
 * after scorer revisions, so updated rules re-publish the same measured
 * traces.
 */
function rowsFromRawFiles(): Row[] {
  const rows: Row[] = [];
  const dir = join(TRACES, "opencode");
  if (!existsSync(dir)) return rows;
  for (const name of readdirSync(dir)) {
    const m = /^drv-([a-z]+)-(p\d+)-(control|injected)\.json$/.exec(name);
    if (!m) continue;
    const id = `drv-${m[1]}-${m[2]}-${m[3]}`;
    const rawFile = join(dir, name);
    assertParseableJSON(rawFile);
    const [t] = parseOpencodeExport(readFileSync(rawFile, "utf8"), id);
    t.id = id;
    t.source = "intentional";
    t.taskLabel = ARM_KIND[m[3] as Arm].replace("driven-", "") || t.taskLabel;
    t.dir = null;
    const s = scoreTrace(t);
    rows.push({
      id,
      pair: m[2],
      harness: m[1],
      arm: m[3] as Arm,
      task: ARM_KIND[m[3] as Arm],
      model: t.model,
      taskLabel: t.taskLabel,
      verdict: s.verdict,
      claim: s.claim,
      support: s.support,
      reading: "divergence", // refined below
      rawFile: name,
    });
    console.error(`✔ ${id}: verdict=${s.verdict} claim=${JSON.stringify(s.claim)} support=${String(s.support)}`);
  }
  return rows;
}

function applyReadings(rows: Row[]): void {
  const pairs = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.harness}:${r.pair}`;
    pairs.set(k, [...(pairs.get(k) ?? []), r]);
  }
  for (const grp of pairs.values()) {
    const inj = grp.find((r) => r.arm === "injected");
    const ctl = grp.find((r) => r.arm === "control");
    if (!inj || !ctl) continue;
    const reading = pairReading(inj.verdict, ctl.verdict);
    inj.reading = reading;
    ctl.reading = reading;
    console.error(`● pair ${inj.harness}:${inj.pair} reading=${reading}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const rescoreOnly = process.argv.includes("--scores-only");
  // First derived/traces write asserts the target directory exists; both
  // directories are named explicitly here, inside the v1 tree.
  mkdirSync(TRACES, { recursive: true });
  mkdirSync(DERIVED, { recursive: true });

  if (rescoreOnly) {
    const rows = rowsFromRawFiles();
    applyReadings(rows);
    writeGuarded(DERIVED_FILE, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.error(`derived written (rescore): ${DERIVED_FILE}`);
    console.log(tableMarkdown(rows));
    console.log("");
    console.log(countsMarkdown(rows));
    return;
  }

  const pairsPerHarness = Math.ceil(args.pairs / args.harnesses.length);
  const rows: Row[] = loadExistingRows();
  for (const harness of args.harnesses) {
    for (let i = 1; i <= pairsPerHarness; i++) {
      const pair = `p${i}`;
      const verdicts: Partial<Record<Arm, V1Verdict>> = {};
      for (const arm of ["control", "injected"] as Arm[]) {
        const id = `drv-${harness}-${pair}-${arm}`;
        const run = runOneArm(harness, id, arm, TRACES);
        const trace = toTrace(run);
        trace.id = run.id;
        trace.harness = harness;
        trace.source = "intentional";
        trace.taskLabel = `${ARM_KIND[arm].replace("driven-", "")}`;
        trace.dir = null;
        const s = scoreTrace(trace);
        verdicts[arm] = s.verdict;
        const row: Row = {
          id: run.id,
          pair,
          harness,
          arm,
          task: ARM_KIND[arm],
          model: run.model,
          taskLabel: trace.taskLabel,
          verdict: s.verdict,
          claim: s.claim,
          support: s.support,
          reading: "divergence", // refined below once both arms exist
          rawFile: basename(run.rawFile),
        };
        // Replace any earlier attempt of the same arm; keep the history out.
        const idx = rows.findIndex((r) => r.id === run.id);
        if (idx >= 0) rows[idx] = row;
        else rows.push(row);
        console.error(`✔ ${id}: verdict=${s.verdict} claim=${JSON.stringify(s.claim)} support=${String(s.support)}`);
      }
      // fill the pair reading for both rows of this pair
      const inj = rows.find((r) => r.id === `drv-${harness}-${pair}-injected`)!;
      const ctl = rows.find((r) => r.id === `drv-${harness}-${pair}-control`)!;
      const reading = pairReading(inj.verdict, ctl.verdict);
      inj.reading = reading;
      ctl.reading = reading;
      console.error(`● pair ${harness}:${pair} reading=${reading}`);
    }
  }

  writeGuarded(DERIVED_FILE, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.error(`derived written: ${DERIVED_FILE}`);
  console.log(tableMarkdown(rows));
  console.log("");
  console.log(countsMarkdown(rows));
}

main().catch((e) => {
  console.error(`driven run failed: ${(e as Error).message}`);
  process.exit(1);
});
