/**
 * Reader for the admission sensor's NDJSON spool.
 *
 * One line is one evaluation, written by the cuesheet shadow plugin at the
 * message boundary. The reader is deliberately dumb: it classifies, it does
 * not decide. Every reading that carries a verdict lives in derive.ts, where
 * the derivation rules are testable in isolation.
 */

/** One requirement the extractor found in the evaluated text. */
export interface ShadowRequirement {
  kind: string;
  name: string;
}

/** Verdicts the sensor's vocabulary fixes. `unverified` is first class. */
export type ShadowVerdict = "allowed" | "would_block" | "unverified";

/** One record written by the cuesheet shadow sensor. */
export interface ShadowRecord {
  v: number;
  kind: string;
  sessionID: string;
  ts: number;
  agent?: string;
  requirements: ShadowRequirement[];
  matches: Array<{ name: string; directive: boolean; snippet?: string }>;
  verdict: ShadowVerdict;
  missing: string[];
  registrySize: number;
  registryUnverified: boolean;
  reason?: string;
}

/** The sensor's own self-test. Never counted as traffic. */
export const PROBE_SESSION = "ses_probe";

/** The message boundary the sensor hooks. */
export const DELEGATION_KIND = "delegation_evaluated";

export interface ParsedSpool {
  records: ShadowRecord[];
  /** Lines that were not valid JSON. Published, never silently dropped. */
  malformed: number;
}

/**
 * Parse the spool. A malformed line is counted and skipped: reading a broken
 * line as a record would be the conversion of an inability to read into a
 * fact.
 */
export function parseSpool(text: string): ParsedSpool {
  const records: ShadowRecord[] = [];
  let malformed = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as ShadowRecord;
      if (parsed && typeof parsed === "object" && "kind" in parsed) {
        records.push(parsed);
      } else {
        malformed += 1;
      }
    } catch {
      malformed += 1;
    }
  }
  return { records, malformed };
}

/** A record at the message boundary, other than the sensor's self-test. */
export function isRealRecord(record: ShadowRecord): boolean {
  return record.kind === DELEGATION_KIND && record.sessionID !== PROBE_SESSION;
}

/** The sensor's self-test record. */
export function isProbeRecord(record: ShadowRecord): boolean {
  return record.kind === DELEGATION_KIND && record.sessionID === PROBE_SESSION;
}

/**
 * A record where the gate could not read the registry, so it said nothing.
 *
 * In this dataset every `unverified` record carries `registryUnverified: true`
 * and a reason string. Two distinct failures produced them, and both mean the
 * instrument was down, not that the property failed.
 */
export function isInstrumentFailure(record: ShadowRecord): boolean {
  return record.verdict === "unverified";
}

/** A record the gate evaluated against a registry it could actually read. */
export function isEvaluated(record: ShadowRecord): boolean {
  return isRealRecord(record) && !isInstrumentFailure(record);
}
