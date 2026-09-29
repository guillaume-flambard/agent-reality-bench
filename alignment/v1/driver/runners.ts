/**
 * OpenCode driver: one headless arm.
 *
 * The runner isolates the arm in a fresh throwaway workspace, exports its
 * session through the sanctioned file-redirect path, and stores the raw
 * export under alignment/v1/traces/.
 */

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";

import { exportOpencodeSession } from "../export-opencode.ts";
import { assertParseableJSON } from "./paths.ts";

const RUN_TIMEOUT_MS = 15 * 60 * 1000;
const LIST_TIMEOUT_MS = 120_000;

/** Pin the model so both arms of a pair provably share it. */
export const OPENCODE_MODEL = "opencode/space-bunny-free";

export interface RawRun {
  /** Canonical driver id, e.g. drv-opencode-p1-control. */
  id: string;
  harness: string;
  /** Model recorded from the harness's own metadata. */
  model: string | null;
  /** Raw export/session file, stored under alignment/v1/traces/. */
  rawFile: string;
}

interface SessionMeta {
  id: string;
  directory: string;
  created: number;
  title?: string;
}

function fail(context: string, r: ReturnType<typeof spawnSync>): never {
  const detail = String((r.stderr ?? "") || (r.error?.message ?? "")) || "no stderr";
  throw new Error(`${context} exited ${r.status ?? "null"}${r.signal ? ` (${r.signal})` : ""}: ${detail.slice(-400)}`);
}

function sh(cmd: string, cwd: string, timeout: number): string {
  const r = spawnSync("sh", ["-c", cmd], { cwd, encoding: "utf8", timeout, env: harnessEnv(cwd), maxBuffer: 128 * 1024 * 1024 });
  if (r.status !== 0) fail(`sh '${cmd.slice(0, 80)}'`, r);
  return r.stdout;
}

/**
 * OpenCode resolves its project directory from the PWD environment variable,
 * NOT from the spawn's cwd option (measured 2026-09-29: a spawned run with
 * cwd=<workspace> but a stale parent PWD ran entirely in /Users/memo). Both
 * PWD and OLDPWD are pinned to the workspace for every spawned harness.
 */
function harnessEnv(cwd: string): NodeJS.ProcessEnv {
  return { ...process.env, PWD: cwd, OLDPWD: cwd };
}

/**
 * Drive one OpenCode arm. The seed is already in place at `workspace`; the
 * prompt is run headless with permissions auto-approved (a throwaway dir is
 * the containment), the just-created session is located by title match plus
 * a pre-run timestamp (session list is not dir-scoped in this version), and
 * the raw export lands under traces/opencode/ through the redirect path.
 */
export function runOpenCodeArm(id: string, workspace: string, prompt: string, traceDir: string): RawRun {
  // On macOS the temp parent arrives as /tmp/...; opencode records the
  // resolved /private/tmp path, so match against the realpath.
  workspace = realpathSync(workspace);
  const deadline = Date.now() - 5_000; // clock-skew margin for the created check
  const r = spawnSync(
    "opencode",
    ["run", "--model", OPENCODE_MODEL, "--auto", "--title", id, prompt],
    { cwd: workspace, env: harnessEnv(workspace), encoding: "utf8", timeout: RUN_TIMEOUT_MS, maxBuffer: 128 * 1024 * 1024 },
  );
  if (r.status !== 0) fail(`opencode run ${id}`, r);

  const out = sh("opencode session list --format json -n 600", workspace, LIST_TIMEOUT_MS);
  const metas: SessionMeta[] = JSON.parse(out) as SessionMeta[];
  // Title match does the heavy lifting; directory + created are the belt.
  const mine = metas
    .filter((s) => s.title === id && s.created > deadline)
    .filter((s) => s.directory === workspace)
    .sort((a, b) => b.created - a.created);
  const session = mine[0];
  if (!session) {
    throw new Error(
      `no new opencode session titled ${id} (saw ${metas.length} sessions, newest titled "${metas[0]?.title ?? "?"}")`,
    );
  }

  const rawFile = join(traceDir, "opencode", `${id}.json`);
  exportOpencodeSession(session.id, { cwd: workspace, outFile: rawFile });
  const data = assertParseableJSON(rawFile) as { info?: { model?: { id?: string } } };
  return { id, harness: "opencode", model: data.info?.model?.id ?? null, rawFile };
}
