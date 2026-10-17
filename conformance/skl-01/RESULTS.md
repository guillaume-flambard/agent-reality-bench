# SKL-01 results

## Verdict

| Clause | Verdict |
|---|---|
| At delegation time, against the live registry, a capability that appeared after the session started is resolvable | **conformant** |
| An unresolved requirement stops the spawn | **scoped out**, no external reference implements it and the deployed sensor is in shadow mode by ADR-001, see `SPEC.md` |

Clause one is conformant on two independent readings, and neither is a model
run: two real sessions show the registry the gate reads changing inside the
session, and the controlled mutation arm resolves a capability that did not
exist at the preceding listing from the same adapter instance.

## The run

| Item | Value |
|---|---|
| Spool | `~/.local/share/opencode/cuesheet/shadow.ndjson`, 1075 lines, 340667 bytes, sha256 `b9fc646ff35c...` |
| Spool window | 2026-09-29T17:00:49Z to 2026-10-17T19:43:08Z |
| Sensor | `~/.config/opencode/plugins/cuesheet-shadow.ts`, deployed on disk 2026-10-14, hooks the message boundary, re-reads the registry per evaluation |
| Core under test | `cuesheet` checkout, branch `wip/pre-audit-snapshot-2026-10-04`, `6efd331`, 4 files modified by another session. Imported read only, nothing written there |
| Harness | `opencode` v2.0.32, Node v24.21.0 |
| Model backend | none. No inference is in the loop for this case, which is why the run has no model column |

## Counts

| Reading | Value |
|---|---|
| Records | 1075 total, 1074 real, 1 probe, 639 instrument failure, 435 evaluated |
| Verdicts | `allowed` 435, `unverified` 639, `would_block` 1 |
| Real sessions | 291, of which 56 hold more than one record |
| Sessions with in-session registry growth | **2** |
| Evaluated records carrying a requirement | **0 of 435** |
| Instrument failure window | 2026-09-30T09:04:33Z to 2026-10-09T14:21:18Z, 639 records |
| Controlled arms | `present` ready, `absent` blocked, `empty` ready, `mutation` ready, scratch directory removed |

The one `would_block` belongs to `ses_probe`, the sensor's own self-test, and is
not counted as traffic. The sensor's self-test names a capability that does not
exist and reads `would_block`, which is the gate's block path exercised by
construction, not by a delegation.

## Hand-read of the two growth sessions

Every session published in the derived table was read against the raw spool.
The two that carry the property:

```text
digest 057837c052, 8 records, 2026-10-09T20:25:08Z to 21:29:44Z
  22:25:08  226  allowed
  22:25:51  226  allowed
  22:51:14  226  allowed
  22:51:39  226  allowed
  22:52:47  226  allowed
  23:02:05  226  allowed
  23:27:56  226  allowed
  23:29:44  227  allowed     <- one more capability, same session

digest 5b4387b549, 7 records, 2026-10-09T21:28:23Z to 2026-10-10T10:29:13Z
  23:28:23  226  allowed
  23:44:22  227  allowed     <- the same change, seen by a second session
  00:10:11  227  allowed
  00:12:44  227  allowed
  00:14:34  227  allowed
  00:24:10  227  allowed
  12:29:13  227  allowed
```

A session-start snapshot would have held `registrySize` at 226 for the whole
session. It did not. The registry the gate reads is taken at evaluation time,
so a capability that appeared after the session started is visible to the next
evaluation. The second session confirms it is a change in the world and not an
arithmetic slip in one process.

No record in either sequence carries a requirement, so this reading is about the
mechanism and not about a decision: the gate saw the new capability, and nothing
in the traffic asked for anything.

## Instrument findings, recorded here and never scored as a conformance verdict

These are measurements of our own instrument. No external standard is being
violated by any of them, so promoting any of them to `non-conformant` would be
the misreporting this suite forbids in its first paragraph.

1. **639 of 1075 records are `unverified`**, and the window is closed. Two
   failure reasons: 637 read
   `evaluation failed: available.every is not a function`, in the sensor's own
   catch block, and 2 read
   `core not loadable: ResolveMessage: Cannot find module '/Users/memo/projects/tools/cuesheet/...'`.
   That path stopped existing on 2026-10-14, and the two records predate it, so
   they are a hard reference to the pre-reorganisation layout. No record since
   2026-10-10 is unverified.
2. **The extractor reads an English directive shape and not a French one.**
   `Use the \`adversarial-qa\` skill to attack this change.` yields the
   requirement. `Tu dois utiliser la skill \`adversarial-qa\` avant de merger.`
   yields nothing. Prose that mentions a skill without naming one, such as
   `The writing skill rules are in the Vault.`, yields nothing, correctly.
3. **The extractor produces a requirement from ordinary English prose.**
   `There is no skill named here at all.` yields a requirement named `here`.
   This is a false positive generated inside the gate's own sensor, before any
   outcome is joined, and it is the reason a `would_block` count cannot be read
   as a false-positive rate for the gate.
4. **The registry the gate reads refuses 52 of 290 skill folders.** The adapter
   reports `Skill manifest resolves outside its configured root.` for each: the
   folder holds a `SKILL.md` that is a symlink into `~/.claude/skills`, so the
   manifest resolves outside `~/.agents/skills`. The refusal is deliberate and
   it is also blindness: the whole `gstack` family, and 52 folders with it, is
   absent from what the gate can resolve. The gate also reads exactly one root,
   while this machine exposes skills from at least three. Fixing either is a
   decision about what the capability registry is, not a bug fix.

## What this does not claim

It does not claim the runtime hot-reloads. It does not claim the gate is
correct, only that it reads the registry live. It does not claim any
false-positive rate: 0 of 435 evaluated records carried a requirement, so the
traffic in this window cannot produce that number. It does not claim the 2026-09-29
incident is fixed in the runtime that produced it, only that the observation
path this case checks now behaves as the reference does. `github-readme` is
present and readable in today's registry; it was the session snapshot that made
it invisible then.

## Harness feedback

Running the case produced two hand-offs and one decision not to act.

The four findings about our own instrument are filed as `memolabs-dev/cuesheet#77`:
the capability registry refuses 52 of 290 skill folders whose `SKILL.md` resolves
outside its root, the gate reads one root of the three this machine exposes, and
the extractor both misses French directives and manufactures a requirement named
`here` out of ordinary English prose.

Regenerating the frontier for this session found that `frontier-cli` publishes an
empty portfolio: `DEFAULT_PROJECTS_ROOT` still points at `~/projects`, removed on
2026-10-14, and `parseRegistry` returns `[]` when the registry file is missing, so
"not where I looked" is indistinguishable from "the portfolio declares no
repository". Filed as `memolabs-dev/cuesheet#78`.

The regenerated frontier was therefore not written. `~/Vault/Harness/FRONTIER.md`
stays as it was, and the durable objects were corrected instead
(`shadow_delegations` from 0 to 1075, plus `shadow_evaluated_with_requirement: 0`,
with the shadow wake condition now requiring a delegation that carries a
requirement). A hand-edited frontier is a second place for the portfolio to be
wrong, and the regenerated one would have said the portfolio was empty.

## Reproduce

```bash
node conformance/skl-01/driver/run.ts        # rewrites derived/skl-01-derived.json
node --test "conformance/skl-01/test/*.test.ts"
npm test
```

The spool path, the skill root and the `cuesheet` checkout can be pointed
elsewhere with `SKL01_SPOOL`, `SKL01_SKILL_ROOT` and `SKL01_CUESHEET_ROOT`. The
derived table is a function of the spool it names, and it publishes the spool's
sha256 so a reader can tell whether a rerun is over the same input.
