/**
 * Path guards for every first write of derived output.
 *
 * Two real failures shaped this module (see harness feedback in RESULTS.md):
 * 1. `opencode export` truncates its JSON through pipes (65 of 340 KB, no
 *    error) and only a shell file redirect delivers the full bytes. Every
 *    consumed export must therefore assert file-exists + parses first.
 * 2. A wrong URL-relative path silently wrote derived output outside its
 *    intended directory while printing success. Every derived write must
 *    assert the target directory exists, and the resolved path must stay
 *    inside the v1 tree anchored at import.meta.url, never a bare relative
 *    guess.
 */

import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * The v1 tree (alignment/v1) this module lives under; the default guarded
 * root every write fans out from, anchored at import.meta.url so a wrong
 * relative path can never silently redirect derived output. Callers from
 * other case trees (E1) pass their own root; the default keeps v1 behavior.
 */
export function v1Root(): string {
  return new URL("..", import.meta.url).pathname;
}

/** Assert a directory exists, is a directory, and sits inside the guarded root. */
export function assertDirectory(dir: string, root: string = v1Root()): void {
  const abs = resolve(dir);
  if (!abs.startsWith(root)) {
    throw new Error(
      `write-guard: ${abs} resolves outside the guarded tree ${root}; this is the silent-wrong-directory failure, refusing to write`,
    );
  }
  if (!existsSync(abs)) {
    throw new Error(`write-guard: target directory does not exist: ${abs}`);
  }
  if (!statSync(abs).isDirectory()) {
    throw new Error(`write-guard: target is not a directory: ${abs}`);
  }
}

/**
 * The only write door for any derived or trace artifact: explicitly creates
 * the containing directory, asserts it exists inside the v1 tree, writes,
 * and reads the file back non-empty before returning.
 */
export function writeGuarded(file: string, content: string, root: string = v1Root()): void {
  const abs = resolve(file);
  const dir = dirname(abs);
  // Explicit mkdir of the path we intend, not an incidental CWD-dependent
  // side effect: a wrong relative path would otherwise land silently.
  mkdirSync(dir, { recursive: true });
  assertDirectory(dir, root);
  writeFileSync(file, content);
  if (!existsSync(abs) || statSync(abs).size === 0) {
    throw new Error(`write-guard: ${abs} did not survive its own write`);
  }
}

/**
 * Consumption guard: the file exists, is non-empty, and parses as JSON.
 * This is the regression point for the pipe-truncation failure: a truncated
 * export must throw here, never reach the ingest adapters silently.
 */
export function assertParseableJSON(file: string): unknown {
  if (!existsSync(file)) {
    throw new Error(`export-guard: file does not exist: ${file}`);
  }
  const raw = readFileSync(file, "utf8");
  if (!raw.trim()) {
    throw new Error(`export-guard: file is empty: ${file}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `export-guard: ${file} is not parseable JSON (truncated export pipe? ${(e as Error).message.slice(0, 120)})`,
    );
  }
}
