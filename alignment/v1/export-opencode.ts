/**
 * The only sanctioned path for `opencode export`.
 *
 * Harness failure behind this module (2026-09-29): piping the export through
 * `execFileSync` in pipe mode hands back 65 KB of a 340 KB payload with no
 * error, and a silently truncated JSON is parse-fail poison downstream. The
 * export must go through a shell FILE redirect and must assert file-exists +
 * parses before anyone consumes it. Both are exercised by the regression
 * test named after that failure in alignment/v1/test/driver-safety.test.ts.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { assertParseableJSON } from "./driver/paths.ts";

export interface ExportOptions {
  /** Directory the export is invoked from; `opencode export` keeps it. */
  cwd: string;
  /** Redirect destination (temp or cache file), NOT a pipe. */
  outFile: string;
  timeoutMs?: number;
}

export function exportOpencodeSession(sessionId: string, opts: ExportOptions): void {
  const dir = dirname(opts.outFile);
  mkdirSync(dir, { recursive: true });
  const r = spawnSync(
    "sh",
    ["-c", `opencode export ${JSON.stringify(sessionId)} > ${JSON.stringify(opts.outFile)}`],
    { cwd: opts.cwd, encoding: "utf8", timeout: opts.timeoutMs ?? 120_000 },
  );
  if (r.status !== 0) {
    throw new Error(
      `opencode export ${sessionId} exited ${r.status}${r.signal ? ` (signal ${r.signal})` : ""}: ${String(r.stderr ?? r.error ?? "").slice(-240)}`,
    );
  }
  // Guard rides inside the export itself: the caller can't skip it.
  assertParseableJSON(opts.outFile);
}
