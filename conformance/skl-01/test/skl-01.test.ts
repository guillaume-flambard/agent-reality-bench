/**
 * SKL-01 rules, tested in both directions.
 *
 * The point of these tests is not coverage. It is that the derivation cannot
 * quietly read an instrument failure as a registry that changed, and that the
 * case can actually come out wrong: a resolver that says yes to everything
 * must score non-conformant, not conformant.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { clauseVerdict, derive, type ArmReadings } from "../driver/derive.ts";
import { isInstrumentFailure, isProbeRecord, isRealRecord, parseSpool, type ShadowRecord } from "../driver/parse-spool.ts";
import { sessionDigest } from "../driver/privacy.ts";

function record(over: Partial<ShadowRecord> = {}): ShadowRecord {
  return {
    v: 1,
    kind: "delegation_evaluated",
    sessionID: "ses_fixture0000aaaa",
    ts: 1_700_000_000_000,
    requirements: [],
    matches: [],
    verdict: "allowed",
    missing: [],
    registrySize: 226,
    registryUnverified: false,
    ...over,
  };
}

function failure(over: Partial<ShadowRecord> = {}): ShadowRecord {
  return record({
    verdict: "unverified",
    registrySize: 0,
    registryUnverified: true,
    reason: "evaluation failed: available.every is not a function. (In 'available.every((c) => c.version === \"unverified\")', 'available.every' is undefined)",
    ...over,
  });
}

const goodArms: ArmReadings = {
  present: "ready",
  absent: "blocked",
  empty: "ready",
  mutation: "ready",
  mutationCleanedUp: true,
};

test("the sensor's self-test is not traffic", () => {
  const probe = record({ sessionID: "ses_probe", verdict: "would_block", missing: ["writing"], registrySize: 202 });
  const real = record();
  assert.equal(isProbeRecord(probe), true);
  assert.equal(isRealRecord(probe), false);
  assert.equal(isRealRecord(real), true);
  const derived = derive([probe, real]);
  assert.equal(derived.records.real, 1);
  assert.equal(derived.records.probe, 1);
  assert.equal(derived.realTraffic.sessions, 1);
});

test("in-session registry growth is the evidence", () => {
  const session = "ses_fixturegrowth";
  const derived = derive([
    record({ sessionID: session, ts: 1, registrySize: 226 }),
    record({ sessionID: session, ts: 2, registrySize: 226 }),
    record({ sessionID: session, ts: 3, registrySize: 227 }),
  ]);
  assert.equal(derived.realTraffic.growthSessions, 1);
  assert.deepEqual(derived.growth[0]?.sizes, [226, 227]);
});

test("a registry that did not change is not growth", () => {
  const session = "ses_fixturestable";
  const derived = derive([
    record({ sessionID: session, ts: 1, registrySize: 248 }),
    record({ sessionID: session, ts: 2, registrySize: 248 }),
  ]);
  assert.equal(derived.realTraffic.growthSessions, 0);
  assert.equal(derived.realTraffic.multiRecordSessions, 1);
});

test("the instrument failure window is not growth", () => {
  // The 2026-09-30 shape: a readable registry, then a broken instrument
  // writing registrySize 0 with verdict unverified. Reading this as a
  // registry that changed would be reading a broken instrument as evidence.
  const session = "ses_fixturebroken";
  const broken = failure({ sessionID: session, ts: 2 });
  assert.equal(isInstrumentFailure(broken), true);
  const derived = derive([record({ sessionID: session, ts: 1, registrySize: 248 }), broken]);
  assert.equal(derived.realTraffic.growthSessions, 0);
  assert.equal(derived.instrumentGap.count, 1);
  assert.equal(derived.records.evaluated, 1);
});

test("one instrument failure is not one uncovered delegation", () => {
  const derived = derive([failure(), failure(), record()]);
  assert.equal(derived.records.instrumentFailure, 2);
  assert.equal(derived.records.evaluated, 1);
  assert.equal(derived.coverage.realRecordsEvaluated, 1);
});

test("a resolver that says yes to everything scores non-conformant", () => {
  const derived = derive([
    record({ sessionID: "ses_a", ts: 1, registrySize: 226 }),
    record({ sessionID: "ses_a", ts: 2, registrySize: 227 }),
  ]);
  assert.equal(clauseVerdict(derived, goodArms), "conformant");
  assert.equal(clauseVerdict(derived, { ...goodArms, absent: "ready" }), "non-conformant");
  assert.equal(clauseVerdict(derived, { ...goodArms, mutation: "blocked" }), "non-conformant");
  assert.equal(clauseVerdict(derived, { ...goodArms, present: "blocked" }), "non-conformant");
});

test("no growth and agreeing arms is unconcluded, never a pass", () => {
  const derived = derive([record({ sessionID: "ses_flat", ts: 1 }), record({ sessionID: "ses_flat", ts: 2 })]);
  assert.equal(clauseVerdict(derived, goodArms), "unconcluded");
});

test("a malformed line is counted, not read as a record", () => {
  const parsed = parseSpool(`${JSON.stringify(record())}\n{not json\n\n`);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.malformed, 1);
});

test("a session id never reaches the published table in clear", () => {
  const raw = "ses_thisMustNotAppearInTheDerivedTable";
  const derived = derive([record({ sessionID: raw, ts: 1 }), record({ sessionID: raw, ts: 2 })]);
  const published = JSON.stringify(derived);
  assert.equal(published.includes(raw), false);
  assert.equal(derived.sessions[0]?.digest, sessionDigest(raw));
  assert.equal(derived.sessions[0]?.digest.length, 10);
});
