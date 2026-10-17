import { sessionDigest } from "./privacy.ts";
import {
  type ShadowRecord,
  isEvaluated,
  isInstrumentFailure,
  isProbeRecord,
  isRealRecord,
} from "./parse-spool.ts";

/**
 * The derivation rules of SKL-01, fixed in SPEC.md before any code ran.
 *
 * Growth inside a session is the evidence for the property: the gate re-reads
 * the registry at each evaluation, so a capability that appeared after the
 * session started shows up as a changed `registrySize` between that session's
 * own records. A session-start snapshot would hold it constant.
 */

/** One real session, published under a digest and never in clear. */
export interface DerivedSession {
  digest: string;
  records: number;
  /** Ordered distinct registry sizes, unverified records excluded. */
  sizes: number[];
  verdicts: string[];
  first: string;
  last: string;
  /** True when a registry that could be read changed inside the session. */
  growth: boolean;
}

/** The instrument failure window, published as a gap. */
export interface InstrumentGap {
  from: string | null;
  to: string | null;
  count: number;
  reasons: Array<{ reason: string; count: number }>;
}

export interface Derived {
  source: {
    lines: number;
    malformed: number;
    firstTs: string | null;
    lastTs: string | null;
  };
  records: {
    total: number;
    real: number;
    probe: number;
    instrumentFailure: number;
    evaluated: number;
  };
  verdicts: Record<string, number>;
  realTraffic: {
    sessions: number;
    multiRecordSessions: number;
    growthSessions: number;
  };
  coverage: {
    realRecordsEvaluated: number;
    realRecordsWithRequirement: number;
  };
  instrumentGap: InstrumentGap;
  sessions: DerivedSession[];
  growth: DerivedSession[];
}

function iso(ts: number | undefined): string | null {
  return typeof ts === "number" ? new Date(ts).toISOString() : null;
}

function distinct<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function derive(records: ShadowRecord[]): Derived {
  const real = records.filter(isRealRecord);
  const probes = records.filter(isProbeRecord);
  const failures = real.filter(isInstrumentFailure);
  const evaluated = real.filter(isEvaluated);

  const verdicts: Record<string, number> = {};
  for (const record of records) {
    verdicts[record.verdict] = (verdicts[record.verdict] ?? 0) + 1;
  }

  const bySession = new Map<string, ShadowRecord[]>();
  for (const record of real) {
    const list = bySession.get(record.sessionID);
    if (list) list.push(record);
    else bySession.set(record.sessionID, [record]);
  }

  const sessions: DerivedSession[] = [];
  for (const [sessionID, group] of bySession) {
    const ordered = [...group].sort((a, b) => a.ts - b.ts);
    const read = ordered.filter((r) => !isInstrumentFailure(r));
    const sizes = distinct(read.map((r) => r.registrySize));
    sessions.push({
      digest: sessionDigest(sessionID),
      records: ordered.length,
      sizes,
      verdicts: distinct(ordered.map((r) => r.verdict)),
      first: iso(ordered[0]?.ts) ?? "",
      last: iso(ordered[ordered.length - 1]?.ts) ?? "",
      // Rule 2: a session with more than one record, where a registry that
      // could be read holds two different sizes. The unverified window wrote
      // registrySize 0 with a broken instrument, so it is excluded here, not
      // read as a registry that changed.
      growth: read.length > 1 && sizes.length > 1,
    });
  }
  sessions.sort((a, b) => b.records - a.records || a.digest.localeCompare(b.digest));

  const reasons = new Map<string, number>();
  for (const failure of failures) {
    const key = failure.reason ?? "(no reason)";
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }

  const failureTs = failures.map((r) => r.ts).sort((a, b) => a - b);
  const firstTs = records.map((r) => r.ts).filter((t) => typeof t === "number").sort((a, b) => a - b);

  return {
    source: {
      lines: records.length,
      malformed: 0,
      firstTs: iso(firstTs[0]),
      lastTs: iso(firstTs[firstTs.length - 1]),
    },
    records: {
      total: records.length,
      real: real.length,
      probe: probes.length,
      instrumentFailure: failures.length,
      evaluated: evaluated.length,
    },
    verdicts,
    realTraffic: {
      sessions: bySession.size,
      multiRecordSessions: sessions.filter((s) => s.records > 1).length,
      growthSessions: sessions.filter((s) => s.growth).length,
    },
    coverage: {
      realRecordsEvaluated: evaluated.length,
      realRecordsWithRequirement: evaluated.filter((r) => r.requirements.length > 0).length,
    },
    instrumentGap: {
      from: iso(failureTs[0]),
      to: iso(failureTs[failureTs.length - 1]),
      count: failures.length,
      reasons: [...reasons.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    },
    sessions,
    growth: sessions.filter((s) => s.growth),
  };
}

/** What the controlled arms said, in the case's own vocabulary. */
export interface ArmReadings {
  present: string;
  absent: string;
  empty: string;
  mutation: string;
  /** The capability the mutation arm created, and whether it was removed. */
  mutationCleanedUp: boolean;
}

export type ClauseVerdict = "conformant" | "non-conformant" | "unconcluded";

/**
 * Clause one: at delegation time, against the live registry, a capability
 * that appeared after the session started is resolvable.
 *
 * The real channel answers it only when the registry demonstrably changed
 * inside a session. The controlled arm corroborates the mechanism. When
 * neither can answer, the case is unconcluded, never a pass.
 */
export function clauseVerdict(derived: Derived, arms: ArmReadings): ClauseVerdict {
  const armsAgree =
    arms.present === "ready" && arms.absent === "blocked" && arms.empty === "ready" && arms.mutation === "ready";
  if (!armsAgree) return "non-conformant";
  if (derived.realTraffic.growthSessions > 0) return "conformant";
  return "unconcluded";
}
