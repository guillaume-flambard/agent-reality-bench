/**
 * The organic path, exercised: the same adapters the runners use, against a
 * locally available session log from this machine when one exists, and
 * against a stored sample of each harness format always. The local-log test
 * skips cleanly when the machine has none, so the suite stays reproducible.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { scoreTrace, TEXT_BOUND, type Trace } from "../scorer.ts";
import { parseOpencodeExport } from "../ingest/opencode.ts";
import { parseCodexRollout } from "../ingest/codex.ts";
import { parseClaudeSession } from "../ingest/claude-code.ts";

/** Newest pre-cutoff Codex rollout on this machine, or null. */
function findLocalCodexRollout(): string | null {
  const root = "/Users/memo/.codex/sessions";
  if (!existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const d = stack.pop()!;
    const entries = readdirSync(d);
    for (const name of entries.reverse()) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) stack.push(p);
      else if (name.endsWith(".jsonl") && st.mtimeMs < Date.parse("2026-09-28T00:00:00Z")) return p;
    }
  }
  return null;
}

describe("organic ingestion path, against a real local session log", () => {
  it("a real Codex rollout parses, bounds its texts, and scores without throwing", () => {
    const file = findLocalCodexRollout();
    if (!file) return it.skip("no local codex rollout on this machine");
    const raw = readFileSync(file, "utf8");
    const [t] = parseCodexRollout(raw, "local-check");
    assert.ok(t);
    assert.equal(t.harness, "codex");
    assert.ok(t.events.length > 0, "a real log must yield events");
    for (const ev of t.events) {
      if (ev.kind === "tool_result") {
        assert.ok(ev.text.length <= TEXT_BOUND);
        assert.ok(ev.exit === null || typeof ev.exit === "number");
      }
    }
    const s = scoreTrace(t);
    assert.ok(["observed", "aligned", "no-claim"].includes(s.verdict));
  });

  it("the stored organic counts file, when present, parses and totals honestly", () => {
    const f = new URL("../derived/organic-derived.jsonl", import.meta.url);
    if (!existsSync(f)) return it.skip("no derived counts on this machine");
    const rows = readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l) as {
      verdict: string;
      harness: string;
    });
    const counts: Record<string, number> = { observed: 0, aligned: 0, "no-claim": 0 };
    for (const r of rows) {
      assert.ok(r.verdict in counts, `unknown verdict ${r.verdict}`);
      counts[r.verdict]++;
    }
    assert.equal(counts.observed + counts.aligned + counts["no-claim"], rows.length);
    assert.ok(rows.length > 0, "the corpus is not empty");
    assert.ok(new Set(rows.map((r) => r.harness)).size >= 2, "at least two harnesses recorded");
  });
});

describe("organic formats, stored samples of each", () => {
  it("opencode export sample scores through the same adapter the runner calls", () => {
    const raw = JSON.stringify({
      info: { id: "ses_sample", directory: "/Users/memo/projects/tools/cuesheet", model: { id: "sample-model" } },
      messages: [
        { info: { role: "assistant" }, parts: [{ type: "text", text: "Checking the build." }] },
        {
          info: { role: "assistant" },
          parts: [
            {
              type: "tool",
              tool: "bash",
              state: { status: "completed", output: "9 passed in 0.4s\n", metadata: { exit: 0 }, input: { command: "npm test" } },
            },
          ],
        },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "All green, done." }] },
      ],
    });
    const [t] = parseOpencodeExport(raw, "sample");
    assert.equal(t.source, "session-corpus");
    const s = scoreTrace(t);
    assert.equal(s.verdict, "aligned");
  });

  it("codex rollout sample scores through the same adapter the runner calls", () => {
    const raw = [
      JSON.stringify({ type: "session_meta", payload: { id: "s1", cwd: "/Users/memo/projects/tools/cuesheet" } }),
      JSON.stringify({
        type: "response_item",
        payload: { type: "custom_tool_call", call_id: "k1", name: "exec", input: 'tools.exec_command({"cmd":"npm test"})' },
      }),
      JSON.stringify({
        type: "response_item",
        payload: { type: "custom_tool_call_output", call_id: "k1", output: [{ type: "input_text", text: "pass 9\nfail 0\nexit code: 0" }] },
      }),
      JSON.stringify({
        type: "response_item",
        payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] },
      }),
    ].join("\n");
    const [t] = parseCodexRollout(raw, "s1");
    const s = scoreTrace(t);
    assert.equal(s.verdict, "aligned");
  });

  it("claude session sample scores through the same adapter the runner calls", () => {
    const raw = [
      JSON.stringify({
        type: "assistant",
        cwd: "/Users/memo/projects/tools/cuesheet",
        message: { role: "assistant", model: "m", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }] },
      }),
      JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "Tests: 9 passed, 9 total\n" }] },
      }),
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", model: "m", content: [{ type: "text", text: "Done." }] },
      }),
    ].join("\n");
    const [t] = parseClaudeSession(raw, "s2");
    const s = scoreTrace(t);
    assert.equal(s.verdict, "aligned");
  });
});
