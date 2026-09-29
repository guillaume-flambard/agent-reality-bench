/**
 * Run the driven paired arms of E1 (see alignment/e1/SPEC.md).
 *
 *   node alignment/e1/driver/run-paired.ts --pairs 3 --exercise 1
 *   node alignment/e1/driver/run-paired.ts --scores-only
 *
 * For each pair: seed two workspaces (control arm, injected arm) that
 * differ only in one method call inside cli.js, drive the identical prompt
 * headless, export the trace raw into alignment/e1/traces/, score it with
 * the E1 scorer bound to the validate.js step, and write rows to
 * alignment/e1/derived/driven-derived.jsonl. Prints the markdown pair table
 * for RESULTS.md to stdout and per-step logs to stderr.
 *
 * The arm runner, the sanctioned export path and the consumption guard come
 * from the V1 driver, reused not rebuilt; the pairing loop is per-case
 * because E1's verdicts and readings are not V1's. The write guards take
 * this case's tree root (a driver gap recorded in SPEC.md).
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";

import { assertParseableJSON, writeGuarded } from "../../v1/driver/paths.ts";
import { runOpenCodeArm, type RawRun } from "../../v1/driver/runners.ts";
import { parseOpencodeExport } from "../../v1/ingest/opencode.ts";
import { scoreE1, type E1Step, type E1Verdict } from "../scorer.ts";
import { pairReadingE1, type PairReading } from "./readings.ts";
import { seedWorkspace, taskKind, taskLabel, TASK_PROMPT, type Arm, type TaskKind } from "./tasks.ts";

/** The guarded root is this case's tree, anchored at import.meta.url. */
const E1_ROOT = new URL("..", import.meta.url).pathname;
const TRACES = join(E1_ROOT, "traces");
const DERIVED_FILE = join(E1_ROOT, "derived", "driven-derived.jsonl");

/** The step the task routes every agent through, bound by its command. */
const STEP: E1Step = { command: /validate\.js/, label: "node validate.js" };

/**
 * E1's registration signals live in the agent's own write payloads (an
 * honest report records the failure), so the driven parsing uses a wider
 * input bound than V1's 300-char default. Driver gap recorded in SPEC.md.
 */
const DRIVEN_INPUT_BOUND = 1200;

interface Row {
  id: string;
  pair: string;
  harness: string;
  arm: Arm;
  task: TaskKind;
  model: string | null;
  verdict: E1Verdict;
  exit: number | null;
  response: string | null;
  signal: string | null;
  reading: PairReading;
  rawFile: string;
}

function parseArgs(): { pairs: number; exercise: number } {
  let pairs = 3;
  let exercise = 1;
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--pairs") pairs = Math.max(0, Number(a[++i]) || 3);
    else if (a[i] === "--exercise") exercise = Math.max(0, Number(a[++i]) || 1);
  }
  return { pairs, exercise };
}

function toTrace(run: RawRun, kind: TaskKind) {
  assertParseableJSON(run.rawFile);
  const t = parseOpencodeExport(readFileSync(run.rawFile, "utf8"), run.id, { inputBound: DRIVEN_INPUT_BOUND })[0];
  t.id = run.id;
  t.harness = run.harness;
  t.source = "intentional";
  t.taskLabel = taskLabel(kind);
  t.dir = null;
  return t;
}

function runOneArm(id: string, arm: Arm, kind: TaskKind, traceDir: string): RawRun {
  const workspaces = mkdtempSync(join(tmpdir(), "arbench-e1-drive-"));
  let run: RawRun;
  try {
    seedWorkspace(arm, workspaces, kind);
    run = runOpenCodeArm(id, workspaces, TASK_PROMPT[kind], traceDir);
  } finally {
    // The workspace is a throwaway; the raw export lives in traces/.
    rmSync(workspaces, { recursive: true, force: true });
  }
  return run;
}

function rowOf(run: RawRun, pair: string, arm: Arm, kind: TaskKind, s: ReturnType<typeof scoreE1>): Row {
  return {
    id: run.id,
    pair,
    harness: run.harness,
    arm,
    task: kind,
    model: run.model,
    verdict: s.verdict,
    exit: s.exit,
    response: s.response,
    signal: s.signal,
    reading: "indifferent", // refined once both arms exist
    rawFile: basename(run.rawFile),
  };
}

/** Rebuild rows from the raw driven traces on disk, no agent re-runs. */
function rowsFromRawFiles(): Row[] {
  const rows: Row[] = [];
  const dir = join(TRACES, "opencode");
  if (!existsSync(dir)) return rows;
  for (const name of readdirSync(dir)) {
    const m = /^e1-drv-([a-z]+)-([pi]\d+)-(control|injected)\.json$/.exec(name);
    if (!m) continue;
    const id = `e1-drv-${m[1]}-${m[2]}-${m[3]}`;
    const rawFile = join(dir, name);
    assertParseableJSON(rawFile);
    const kind = taskKind(m[2].startsWith("i") ? "exercise" : "report");
    const t = parseOpencodeExport(readFileSync(rawFile, "utf8"), id, { inputBound: DRIVEN_INPUT_BOUND })[0];
    t.id = id;
    t.harness = m[1];
    t.source = "intentional";
    t.taskLabel = taskLabel(kind);
    t.dir = null;
    const s = scoreE1(t, STEP);
    rows.push({
      id,
      pair: m[2],
      harness: m[1],
      arm: m[3] as Arm,
      task: kind,
      model: t.model,
      verdict: s.verdict,
      exit: s.exit,
      response: s.response,
      signal: s.signal,
      reading: "indifferent",
      rawFile: name,
    });
    console.error(`✔ ${id}: verdict=${s.verdict} exit=${s.exit} response=${s.response} signal=${JSON.stringify(s.signal)}`);
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
    const reading = pairReadingE1(inj.verdict, ctl.verdict);
    inj.reading = reading;
    ctl.reading = reading;
    console.error(`● pair ${inj.harness}:${inj.pair} reading=${reading}`);
  }
}

function tableMarkdown(rows: Row[]): string {
  const byPair = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.harness}:${r.pair}`;
    byPair.set(k, [...(byPair.get(k) ?? []), r]);
  }
  const lines: string[] = [
    `| Pair | Harness | Arm | Task | Recorded exit | Response | Signal | Verdict | Pair reading |`,
    `|---|---|---|---|---|---|---|---|---|`,
  ];
  for (const key of [...byPair.keys()].sort()) {
    const grp = byPair.get(key)!;
    grp.sort((x, y) => (x.arm === "control" ? -1 : 1));
    for (const r of grp) {
      lines.push(
        `| ${r.pair} | ${r.harness} | ${r.arm} | ${taskLabel(r.task)} | ${r.exit ?? "none"} | ${r.response ?? "-"} | ${r.signal ?? "-"} | ${r.verdict} | ${r.reading} |`,
      );
    }
  }
  return lines.join("\n");
}

function countsMarkdown(rows: Row[]): string {
  const t = { observed: 0, aligned: 0, "no-failure": 0, unconcluded: 0 } as Record<E1Verdict, number>;
  const reads: Record<PairReading, number> = {
    divergence: 0,
    invalid: 0,
    "no-contrast": 0,
    indifferent: 0,
    asymmetric: 0,
    unscorable: 0,
  };
  for (const r of rows) {
    t[r.verdict]++;
    reads[r.reading]++;
  }
  const parts = (o: object) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(", ");
  return `driven arms: ${rows.length} (${parts(t)}) | pair readings: ${parts(reads)}`;
}

async function main(): Promise<void> {
  const { pairs, exercise } = parseArgs();
  const rescoreOnly = process.argv.includes("--scores-only");
  // First write asserts the target directory exists inside this case tree.
  mkdirSync(TRACES, { recursive: true });
  mkdirSync(join(E1_ROOT, "derived"), { recursive: true });

  let rows: Row[];
  if (rescoreOnly) {
    rows = rowsFromRawFiles();
    applyReadings(rows);
  } else {
    rows = [];
    for (let i = 1; i <= pairs; i++) {
      await drivePair(`p${i}`, "report", rows);
    }
    for (let j = 1; j <= exercise; j++) {
      await drivePair(`i${j}`, "exercise", rows);
    }
    applyReadings(rows);
  }

  writeGuarded(DERIVED_FILE, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", E1_ROOT);
  console.error(`derived written: ${DERIVED_FILE}`);
  console.log(tableMarkdown(rows));
  console.log("");
  console.log(countsMarkdown(rows));
}

async function drivePair(pair: string, kindName: "report" | "exercise", rows: Row[]): Promise<void> {
  const kind = taskKind(kindName);
  for (const arm of ["control", "injected"] as Arm[]) {
    const id = `e1-drv-opencode-${pair}-${arm}`;
    const run = runOneArm(id, arm, kind, TRACES);
    const trace = toTrace(run, kind);
    const s = scoreE1(trace, STEP);
    rows.push(rowOf(run, pair, arm, kind, s));
    console.error(`✔ ${id}: verdict=${s.verdict} exit=${s.exit} response=${s.response} signal=${JSON.stringify(s.signal)}`);
  }
}

main().catch((e) => {
  console.error(`e1 driven run failed: ${(e as Error).message}`);
  process.exit(1);
});
