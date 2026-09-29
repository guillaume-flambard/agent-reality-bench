/**
 * Ingest Codex rollout JSONL files into normalized V1 traces.
 *
 * Source format: one JSON object per line, the interesting ones being
 *   {type:"session_meta"|"turn_context", payload:{id?, cwd?, model?}}
 *   {type:"response_item", payload:{type:"message", role:"assistant",
 *        content:[{type:"output_text", text}]}}
 *   {type:"response_item", payload:{type:"custom_tool_call", name:"exec",
 *        call_id, input:"<js calling tools.exec_command({"cmd": "..."})>"}}
 *   {type:"response_item", payload:{type:"custom_tool_call_output",
 *        call_id, output:[{type:"input_text", text:"...\nexit code: N\n..."}]}}
 *
 * A call and its output are merged into ONE tool_result: name from the call,
 * cmd extracted from the call input, exit code parsed from the output text.
 * The output text itself carries `exit code: N` / `Script succeeded|failed`.
 */

import {
  bound,
  TEXT_BOUND,
  INPUT_BOUND,
  type ToolStatus,
  type Trace,
  type TraceItem,
} from "../scorer.ts";
import { labelFromDir } from "./task-label.ts";

export interface CodexLine {
  type?: string;
  payload?: {
    type?: string;
    id?: string;
    role?: string;
    cwd?: string;
    model?: string;
    name?: string;
    call_id?: string;
    input?: string;
    content?: Array<{ type?: string; text?: string }>;
    output?: Array<{ type?: string; text?: string }> | string;
  };
}

/** Codex calls exec through a JS shim; the real command is in {"cmd": ...}. */
export function parseExecExit(text: string): { exit: number | null; status: ToolStatus } {
  const m = /exit code: (-?\d+)/i.exec(text);
  if (m) return { exit: Number(m[1]), status: Number(m[1]) === 0 ? "completed" : "error" };
  if (/\bscript failed\b/i.test(text)) return { exit: null, status: "error" };
  if (/\bscript succeeded\b/i.test(text)) return { exit: 0, status: "completed" };
  return { exit: null, status: null };
}

export function extractCmd(input: string | null): string | null {
  if (!input) return null;
  const m = /"cmd"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(input);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return m[1];
  }
}

export function parseCodexRollout(raw: string, idHint: string): Trace[] {
  const lines = raw.split("\n").filter((l) => l.trim());
  const pending = new Map<string, { name: string; cmd: string | null }>();
  let id: string | null = idHint || null;
  let cwd: string | null = null;
  let model: string | null = null;
  const events: TraceItem[] = [];
  for (const line of lines) {
    let line0: CodexLine;
    try {
      line0 = JSON.parse(line);
    } catch {
      continue;
    }
    const p = line0.payload ?? {};
    if (line0.type === "session_meta") {
      if (!id) id = p.id ?? null;
      model ??= p.model ?? null;
      cwd ??= p.cwd ?? null;
    } else if (line0.type === "turn_context") {
      cwd ??= p.cwd ?? null;
      model ??= p.model ?? null;
    } else if (line0.type === "response_item") {
      if (p.type === "message" && p.role === "assistant") {
        const text = (p.content ?? [])
          .filter((c) => c.type === "output_text")
          .map((c) => c.text ?? "")
          .join("\n");
        if (text.trim())
          events.push({ kind: "model_turn", at: null, text: bound(text, TEXT_BOUND) });
      } else if (p.type === "custom_tool_call" && p.call_id) {
        pending.set(p.call_id, { name: p.name ?? "call", cmd: extractCmd(p.input ?? null) });
      } else if (p.type === "custom_tool_call_output" && p.call_id) {
        const call = pending.get(p.call_id);
        const outs = Array.isArray(p.output) ? p.output : [];
        const text = outs.map((o) => o.text ?? "").join("\n");
        const exitInfo = parseExecExit(text);
        events.push({
          kind: "tool_result",
          at: null,
          name: call?.name ?? "exec",
          text: bound(text, TEXT_BOUND),
          exit: exitInfo.exit,
          status: exitInfo.status,
          input: call?.cmd ? bound(call.cmd, INPUT_BOUND) : null,
        });
        pending.delete(p.call_id);
      }
    }
  }
  return [
    {
      id: id || "codex-rollout",
      harness: "codex",
      model,
      taskLabel: labelFromDir(cwd),
      dir: cwd,
      source: "session-corpus",
      events,
    },
  ];
}
