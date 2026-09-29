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

/**
 * Input excerpt, bounded to INPUT_BOUND.
 *
 * Rule revision 5 (forced by driven trace drv-opencode-p1-injected):
 * OpenCode serializes tool input as a JSON object whose `filePath` comes
 * first and whose `content` can be kilobytes; bounding from the end stripped
 * the path out entirely, and artifact-readback evidence silently died for
 * any file whose write payload was long. The excerpt therefore hoists any
 * filePath/command key to the head before bounding: truncation may drop
 * payload text, never the identity of the file or command the tool acted on.
 */
export function inputExcerpt(input: unknown, inputBound: number = INPUT_BOUND): string | null {
  if (input == null) return null;
  let s: string;
  try {
    s = typeof input === "string" ? input : JSON.stringify(input);
  } catch {
    return null;
  }
  if (!s) return null;
  const hoisted = s.match(/"(?:filePath|command)"\s*:\s*"(?:[^"\\]|\\.)*"/);
  if (hoisted) {
    const head = hoisted[0].slice(0, 180);
    const room = Math.max(0, inputBound - head.length - 2);
    const tail = room > 0 ? bound(s.replace(hoisted[0], " "), room) : "";
    return `${head} … ${tail}`.slice(0, inputBound);
  }
  return bound(s, inputBound);
}

export function parseOpencodeExport(
  raw: string,
  idHint: string,
  opts: { inputBound?: number } = {},
): Trace[] {
  const data: OpencodeExport = JSON.parse(raw);
  const inputBound = opts.inputBound ?? INPUT_BOUND;
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
          input: inputExcerpt(st.input, inputBound),
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
