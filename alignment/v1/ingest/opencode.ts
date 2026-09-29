/**
 * Ingest OpenCode session exports into normalized V1 traces.
 *
 * Source format: `opencode export <sessionID>` JSON, i.e.
 *   { info: { id, model:{id,providerID}, directory },
 *     messages: [ { info:{ role }, parts:[ ... ] } ] }
 * Part types other than assistant `text` and `tool` are ignored (reasoning,
 * step-start/finish). Tool state carries output/error/metadata.exit, which
 * is the only harness here that exposes a real exit code per result.
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

export interface OpencodeExport {
  info?: {
    id?: string;
    slug?: string;
    directory?: string;
    model?: { id?: string; providerID?: string };
  };
  messages?: Array<{
    info?: { role?: string; modelID?: string };
    parts?: Array<{
      type?: string;
      text?: string;
      tool?: string;
      state?: {
        status?: string;
        output?: string;
        error?: string;
        metadata?: { exit?: number };
        input?: unknown;
      };
    }>;
  }>;
}

export function statusOf(status?: string): ToolStatus {
  if (status === "error") return "error";
  if (status == null) return null;
  return "completed";
}

export function inputExcerpt(input: unknown): string | null {
  if (input == null) return null;
  let s: string;
  try {
    s = typeof input === "string" ? input : JSON.stringify(input);
  } catch {
    return null;
  }
  if (!s) return null;
  return bound(s, INPUT_BOUND);
}

export function parseOpencodeExport(raw: string, idHint: string): Trace[] {
  const data: OpencodeExport = JSON.parse(raw);
  const events: TraceItem[] = [];
  for (const msg of data.messages ?? []) {
    const role = msg.info?.role ?? "?";
    for (const part of msg.parts ?? []) {
      if (part.type === "text") {
        if (role !== "assistant") continue;
        const text = bound(part.text ?? "", TEXT_BOUND);
        if (text.trim()) events.push({ kind: "model_turn", at: null, text });
      } else if (part.type === "tool" && role === "assistant") {
        const st = part.state ?? {};
        events.push({
          kind: "tool_result",
          at: null,
          name: part.tool ?? "?",
          text: bound(st.output ?? st.error ?? "", TEXT_BOUND),
          exit: st.metadata?.exit ?? null,
          status: statusOf(st.status),
          input: inputExcerpt(st.input),
        });
      }
    }
  }
  return [
    {
      id: idHint || data.info?.id || "opencode-export",
      harness: "opencode",
      model: data.info?.model?.id ?? null,
      taskLabel: labelFromDir(data.info?.directory ?? null),
      dir: data.info?.directory ?? null,
      source: "session-corpus",
      events,
    },
  ];
}
