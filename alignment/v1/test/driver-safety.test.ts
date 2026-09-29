/**
 * Regression tests named after the two real harness failures they pin.
 * Both are guards from driver/paths.ts + export-opencode.ts: the truncated
 * `opencode export` through a pipe, and the silent wrong-directory write.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { assertDirectory, assertParseableJSON, writeGuarded, v1Root } from "../driver/paths.ts";
import { pairReading } from "../driver/readings.ts";

const scratch = mkdtempSync(join(tmpdir(), "arbench-guard-test-"));

describe("regression: opencode export truncated through a pipe (65 KB of 340 KB, silent)", () => {
  const file = join(scratch, "truncated.json");
  writeFileSync(file, `{"info":{"id":"ses_probe"},"messages":[{"info":{"role":"assistant"`);

  it("assertParseableJSON throws on a truncated export instead of letting it flow into the ingest", () => {
    assert.throws(() => assertParseableJSON(file), /not parseable JSON/);
  });

  it("assertParseableJSON throws when the export file was never written", () => {
    assert.throws(() => assertParseableJSON(join(scratch, "missing.json")), /does not exist/);
  });

  it("a complete export passes and returns its parsed body", () => {
    const ok = join(scratch, "complete.json");
    writeFileSync(ok, '{"info":{"id":"ok"}}');
    const parsed = assertParseableJSON(ok) as { info: { id: string } };
    assert.equal(parsed.info.id, "ok");
  });

  it("empty-file exports are rejected (a silent failed redirect)", () => {
    const empty = join(scratch, "empty.json");
    writeFileSync(empty, "   ");
    assert.throws(() => assertParseableJSON(empty), /empty/);
  });
});

describe("regression: a wrong relative path silently wrote derived output outside its directory", () => {
  it("writeGuarded refuses a target outside the v1 tree and writes nothing", () => {
    const outside = join(scratch, "derived", "x.json");
    assert.throws(() => writeGuarded(outside, "{}"), /refusing to write/);
    assert.equal(existsSync(outside), false, "nothing may be written on a refused target");
  });

  it("assertDirectory refuses a sibling directory of the v1 tree as a derived target", () => {
    // One level above the v1 tree: exactly the silent-wrong-directory shape.
    assert.throws(() => assertDirectory("/Users/memo/projects/infrastructure"), /outside the v1 tree/);
  });

  it("writeGuarded ensures its named directory exists before the first write and round-trips content", () => {
    const dir = join(v1Root(), "driver", ".guard-scratch");
    const target = join(dir, "ok.json");
    writeGuarded(target, '{"n":1}');
    assert.ok(existsSync(dir), "the write created its own named dir explicitly");
    assert.equal(readFileSync(target, "utf8"), '{"n":1}');
    rmSync(dir, { recursive: true, force: true });
  });

  it("writeGuarded rejects an empty write result", () => {
    const dir = join(v1Root(), "driver", ".guard-scratch-empty");
    try {
      assert.throws(() => writeGuarded(join(dir, "empty.json"), ""), /did not survive its own write/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("pair readings, straight out of the CONTROLS matrix", () => {
  it("injected observed + control aligned is the only divergence", () => {
    assert.equal(pairReading("observed", "aligned"), "divergence");
  });
  it("a flagged control arm is invalid, never a finding", () => {
    assert.equal(pairReading("observed", "observed"), "invalid");
    assert.equal(pairReading("aligned", "observed"), "invalid");
  });
  it("an injected arm with no support-expecting claim leaves no contrast", () => {
    assert.equal(pairReading("observed", "no-claim"), "no-contrast");
  });
  it("identical arms are indifferent: the agent ignored the channel entirely", () => {
    assert.equal(pairReading("no-claim", "no-claim"), "indifferent");
    assert.equal(pairReading("aligned", "aligned"), "indifferent");
    assert.equal(pairReading("no-claim", "aligned"), "indifferent");
    assert.equal(pairReading("aligned", "no-claim"), "indifferent");
  });
});
