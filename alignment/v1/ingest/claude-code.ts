/**
 * Ingest Claude Code session JSONL files into normalized V1 traces.
 *
 * Source format (session files under ~/.claude/projects/.../*.jsonl), the
 * interesting line types being:
 *   {type:"assistant", message:{model, content:[{type:"text",text} |
 *             {type:"tool_use", id, name, input}]}}
 *   {type:"user",      message:{content: string |
 *             [{type:"tool_result", tool_use_id, content: string |
 *               [{type:"text",text}], is_error?}]}}
 * Everything else (queue-operation, summary, thinking blocks, sidechains) is
 * filtered. tool_use input excerpts land on the matching tool_result as the
 * `input` excerpt. No exit codes exist in this format.
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

interface ContentBlock {
  type?: string;
  id?: string;
  text?: string;
  name?: string;
  tool_use_id?: string;
  input?: unknown;
  content?: string | Array<{ type?: string; text?: string }>;
  is_error?: boolean;
}

interface ClaudeLine {
  type?: string;
  isSidechain?: boolean;
  cwd?: string | null;
  message?: {
    role?: string;
    model?: string;
    content?: string | ContentBlock[];
  };
}

export function resultText(content: ContentBlock["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => (c.type === "text" ? c.text ?? "" : "")).join("\n");
  }
  return "";
}

export function parseClaudeSession(raw: string, idHint: string): Trace[] {
  const lines = raw.split("\n").filter((l) => l.trim());
  const events: TraceItem[] = [];
  const calls = new Map<string, { name: string; excerpt: string | null }>();
  let model: string | null = null;
  let cwd: string | null = null;
  for (const line of lines) {
    let obj: ClaudeLine;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.isSidechain) continue;
    if (obj.cwd) cwd ??= obj.cwd;
    const msg = obj.message;
    if (!msg || (obj.type !== "assistant" && obj.type !== "user")) continue;
    model ??= msg.model ?? null;
    if (typeof msg.content !== "string") {
      for (const b of msg.content ?? []) {
        if (b.type === "text" && obj.type === "assistant") {
          const text = bound(b.text ?? "", TEXT_BOUND);
          if (text.trim()) events.push({ kind: "model_turn", at: null, text });
        } else if (b.type === "tool_use" && b.id) {
          let excerpt: string | null = null;
          try {
            excerpt = b.input == null ? null : JSON.stringify(b.input);
          } catch {
            excerpt = null;
          }
          calls.set(b.id, { name: b.name ?? "?", excerpt: excerpt ? bound(excerpt, INPUT_BOUND) : null });
        } else if (b.type === "tool_result") {
          const call = b.tool_use_id ? calls.get(b.tool_use_id) : undefined;
          const text = resultText(b.content);
          const status: ToolStatus = b.is_error ? "error" : "completed";
          events.push({
            kind: "tool_result",
            at: null,
            name: call?.name ?? "?",
            text: bound(text, TEXT_BOUND),
            exit: null,
            status,
            input: call?.excerpt ?? null,
          });
        }
      }
    }
  }
  return [
    {
      id: idHint || "claude-session",
      harness: "claude-code",
      model,
      taskLabel: labelFromDir(cwd),
      dir: cwd,
      source: "session-corpus",
      events,
    },
  ];
}
