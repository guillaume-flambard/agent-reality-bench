# SKL-01 spec, pinned before any code ran

## WHY

SKL-01 is the first case of the conformance suite, and it is the incident that
created the suite. On 2026-09-29 three agents were briefed to use a skill that
none of them could resolve, and none of them reported the requirement as
unsatisfiable. Their session-start snapshot predated the skill.

The case definition lives in `conformance/README.md`. The property it measures,
narrowed to the clause that has a reference outside us:

> At delegation time, against the live registry, a capability that appeared
> after the session started is resolvable.

This is a conformance question and not a research question: the property is
already implemented elsewhere, we match it and do not claim to beat it. A
failure here is our own regression against a known property, and it must never
be reported as a discovery.

## Scoping decision, taken before the run

The `conformance/README.md` row for SKL-01 carries a second clause: "a missing
skill blocks before spawn", and says the case passes when resolution happens
live **and** a missing skill blocks before spawn. That second clause is scoped
out of this verdict and recorded as a deferral.

The reason is the suite's own binding rule: verdicts here are always against a
named standard and a named reference implementation. Clause one has one.
Clause two has only our own intent (`cuesheet` ADR-001), and the deployed
sensor is deliberately in shadow mode: it records what the gate would say and
refuses nothing. Scoring a `non-conformant` against our own design intent would
be a research claim wearing a conformance label, which this suite forbids in
its first paragraph. The clause stays open, is recorded in RESULTS.md, and
returns to this case when either an external reference exists or enforcement
stops being deferred.

The README row is corrected in the same packet, so the suite's own text stops
asserting a verdict it cannot support.

## Evidence channels

Two, and they are not interchangeable. Neither substitutes for the other.

**Real traffic.** The admission sensor already runs inside the harness at the
message boundary and writes one NDJSON record per evaluation to
`~/.local/share/opencode/cuesheet/shadow.ndjson`. At the time of writing it
holds 1075 records over 291 real sessions, from 2026-09-29 to 2026-10-17. The
sensor re-reads the registry at each evaluation, so a registry change inside one
session is visible as a `registrySize` change between that session's records.
A session-start snapshot would hold `registrySize` constant for the session,
which is what makes this channel able to answer the question at all.

**Controlled arms.** The same core the sensor loads (`src/core/capability.ts`,
`src/core/extract.ts`, `src/adapters/skills.ts` in the `cuesheet` checkout) is
driven directly: a listing, a resolve, and a mutation of the registry between
two listings. This exercises the resolver's discrimination with no model in the
loop.

Explicitly not used: no model run, no driven session, no prompt sampling, no
organic corpus.

## Derivation rules, fixed before the run

1. **A real record** has `kind == "delegation_evaluated"` and a `sessionID`
   other than `ses_probe`. The probe is the sensor's own self-test and is never
   counted as traffic.
2. **Registry growth inside a session** means: a session with more than one real
   record, at least two of those records carry different `registrySize` values,
   and neither of those records has verdict `unverified`. The second condition
   is binding. Between 2026-09-30 and 2026-10-09 the sensor wrote
   `registrySize: 0` with verdict `unverified` and one identical failure reason;
   that is a broken instrument, not a registry that changed. Reading it as growth
   would be converting an inability to observe into a fact, which is the exact
   conversion this repository exists to refuse.
3. **Clause one is `conformant`** when at least one real session shows in-session
   registry growth, and the controlled mutation arm resolves a capability that
   was absent from the preceding listing. It is `non-conformant` when the real
   channel holds records for a session with a registry that demonstrably changed
   and no growth is visible in them, or when the mutation arm reads blocked for a
   capability that exists.
4. **A cell where the instrument failed is not a cell where the property
   failed.** Unverified records are excluded from growth and from coverage, and
   their window is published as a gap.

## Arms

| Arm | Construction | Expected reading |
|---|---|---|
| `present` | a requirement naming a capability in the live listing | `ready` |
| `absent` | a requirement naming a name absent from the live listing | `blocked` |
| `empty` | no requirement at all | `ready` |
| `mutation` | list, add one capability in a temporary root, list again with the same adapter, resolve it | `ready` at the second evaluation, absent at the first |

`empty` is recorded because `isSpawnable([])` reads false while the gate's
verdict for an empty requirement list is `ready`. The two answer different
questions and the packet must not collapse them.

## The control, and the both-arms rule transposed

The alignment suite's control matrix does not cover this suite, so the
equivalent is stated here. The resolver is the instrument, and a resolver that
says yes to everything measures nothing. The control is the `absent` arm: if it
ever reads `ready`, the rule is wrong and the case is invalid until the rule is
fixed. Symmetrically, if the `mutation` arm reads `blocked` for a capability
that exists on disk, the instrument is broken and the run stops. Both
directions are pinned by tests.

## Instrument findings recorded here, never scored as conformance

These are measurements of our own instrument. Recording them beside the verdict
is deliberate, because a conformance pass would otherwise hide them.

1. **639 of 1075 records are `unverified`**, all from a single failure,
   `evaluation failed: available.every is not a function`, across
   2026-09-30 to 2026-10-09. The window is closed: 274 records since
   2026-10-10 carry no unverified verdict. Published as a gap with its window,
   never as a `non-conformant`.
2. **The extractor reads an English directive shape and misses a French one.**
   `Use the \`adversarial-qa\` skill to attack this change.` yields the
   requirement; `Tu dois utiliser la skill ...` yields none.
3. **The extractor produces a requirement from ordinary prose.**
   `There is no skill named here at all.` yields a requirement named `here`.
   This is a false-positive source in the gate's own sensor.

Findings 2 and 3 belong to the shadow measurement, not to this verdict: no
external standard is being violated, our own sensor is wrong. They are evidence
lines for the packet and they must not be promoted to a conformance failure.

## Privacy rules

This repository is public. Published per real session: a truncated digest of the
session id, the record count, the ordered distinct `registrySize` values, the
verdict set, and the first and last timestamps. Never published: the session id
in clear, prompt text, matched phrases, requirement names drawn from traffic,
tool output, file paths, raw traces. The raw spool is never copied into the
repository.

## Acceptance criteria

1. This SPEC is committed in its own commit, before any driver code exists.
2. The derived table is reproducible by one command from the spool, with no
   network access and no dependency beyond the Node built-ins.
3. RESULTS.md carries one verdict per clause, the counts it rests on, and the
   hand-read note.
4. Tests cover the derivation rules in both directions: the instrument-failure
   window does not count as growth, a deliberately inverted resolver reads
   `non-conformant`, and the `absent` arm cannot read `ready`.
5. A test proves no clear session id reaches the derived table.
6. No write outside the case directory, except reads of the spool and of the
   `cuesheet` checkout, both read-only.

## Verification plan

```bash
node --test "conformance/skl-01/test/*.test.ts"
node conformance/skl-01/driver/run.ts          # writes derived/skl-01-derived.json
npm test                                        # all cases, existing ones included
```

The derived table is regenerated and diffed for reproducibility, and every real
session published in RESULTS.md is hand-read against the raw spool.

## Non-goals

No S1, C1 or K1 work. No model run. No enforcement decision and no change to the
sensor: this case observes the observation path, it does not alter it. No claim
about `cuesheet` as a product, and no claim that a count is a cause.

## STOP conditions

1. No real session shows in-session registry growth and the mutation arm cannot
   run: the case measured nothing. Publish `unconcluded`, not a pass.
2. The mutation arm reads `blocked` for a capability that exists on disk:
   instrument defect. Stop, report, and do not adjust the expectation to fit.
3. One evidence channel cannot be read: report that channel as missing. Never
   substitute one channel for the other.
