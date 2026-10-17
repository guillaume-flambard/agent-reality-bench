#!/usr/bin/env node
/**
 * SKL-01: does a capability that appeared after the session started resolve at
 * delegation time?
 *
 * One command, two evidence channels, one derived table. Reads the sensor's
 * spool and the cuesheet checkout, both read only, writes only inside this
 * case directory, and prints the reading it is about to publish.
 *
 *   node conformance/skl-01/driver/run.ts [cuesheetRoot]
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runArms, DEFAULT_SKILL_ROOT } from "./arms.ts";
import { clauseVerdict, derive } from "./derive.ts";
import { parseSpool } from "./parse-spool.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the deployed sensor writes. The raw spool is never copied here. */
export const DEFAULT_SPOOL = join(homedir(), ".local", "share", "opencode", "cuesheet", "shadow.ndjson");

function resolveCuesheetRoot(): string {
  const given = process.argv[2] ?? process.env.SKL01_CUESHEET_ROOT;
  if (given) return given;
  try {
    return execFileSync("proj", ["path", "cuesheet"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("cuesheet root not given: pass it as an argument, set SKL01_CUESHEET_ROOT, or have `proj path cuesheet` work");
  }
}

export function buildPacket(spoolText: string, spoolSha: string, arms: Awaited<ReturnType<typeof runArms>>) {
  const parsed = parseSpool(spoolText);
  const derived = derive(parsed.records);
  derived.source.malformed = parsed.malformed;
  const clause1 = clauseVerdict(derived, arms.readings);
  return {
    case: "skl-01",
    generated: new Date().toISOString(),
    property: "a capability that appeared after the session started is resolvable at delegation time",
    source: { spool: DEFAULT_SPOOL, sha256: spoolSha, ...derived.source },
    records: derived.records,
    verdicts: derived.verdicts,
    realTraffic: derived.realTraffic,
    coverage: derived.coverage,
    instrumentGap: derived.instrumentGap,
    growth: derived.growth,
    sessions: derived.sessions,
    arms: arms.readings,
    armNotes: arms.details,
    registry: arms.registry,
    clause1,
    clause2: "scoped-out: no external reference implements it and the deployed sensor is in shadow mode by ADR-001, see SPEC.md",
  };
}

async function main() {
  const cuesheetRoot = resolveCuesheetRoot();
  const spoolPath = process.env.SKL01_SPOOL ?? DEFAULT_SPOOL;
  const spoolText = readFileSync(spoolPath, "utf8");
  const spoolSha = createHash("sha256").update(spoolText).digest("hex");

  const arms = await runArms(cuesheetRoot, process.env.SKL01_SKILL_ROOT ?? DEFAULT_SKILL_ROOT);
  const packet = buildPacket(spoolText, spoolSha, arms);

  // Guard, and the tests pin it: a raw session id never reaches the table.
  for (const session of packet.sessions) {
    if (session.digest.length !== 10) throw new Error("session digest is not ten characters, refusing to publish");
  }

  const outDir = join(HERE, "..", "derived");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "skl-01-derived.json");
  writeFileSync(outFile, `${JSON.stringify(packet, null, 2)}\n`, "utf8");

  const r = packet.records;
  console.log(`spool        ${spoolPath}`);
  console.log(`             ${packet.source.lines} lines, sha256 ${spoolSha.slice(0, 12)}`);
  console.log(`records      ${r.total} total, ${r.real} real, ${r.probe} probe, ${r.instrumentFailure} instrument failure`);
  console.log(`verdicts     ${Object.entries(packet.verdicts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`traffic      ${packet.realTraffic.sessions} sessions, ${packet.realTraffic.multiRecordSessions} multi-record, ${packet.realTraffic.growthSessions} with in-session registry growth`);
  console.log(`coverage     ${packet.coverage.realRecordsWithRequirement}/${packet.coverage.realRecordsEvaluated} evaluated records carried a requirement`);
  console.log(`gap          ${packet.instrumentGap.count} unverified from ${packet.instrumentGap.from} to ${packet.instrumentGap.to}`);
  console.log(`arms         present=${packet.arms.present} absent=${packet.arms.absent} empty=${packet.arms.empty} mutation=${packet.arms.mutation} cleaned=${packet.arms.mutationCleanedUp}`);
  console.log(`registry     ${packet.registry.capabilities} capabilities, ${packet.registry.unreadable} unreadable, root ${packet.registry.root}`);
  console.log(`clause 1     ${packet.clause1}`);
  console.log(`clause 2     ${packet.clause2}`);
  console.log(`written      ${outFile}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
