# agent-reality-bench

Measuring when an agent's knowledge, observations and actions stop describing
the same reality.

An agent fails when what it **knows**, what the world **says**, and what it
**does** stop describing the same reality. This benchmark measures that gap.
It does not score capability, and it does not rank models.

Two suites live here, and they never share a results language.

```text
conformance/    Is our system at least as correct as the standards and harnesses
                that already exist? A failure here means our system disrespects
                a property that is already known.

alignment/      Where does plausible reasoning stop being coupled to tool
                feedback, workspace state, evidence, or a verifiable output
                contract? This is the research question.
```

Separating them is structural, not stylistic. A conformance failure is our own
regression against a known standard. An alignment failure is a candidate
discovery. Mixing the two languages is how projects talk themselves into
calling their bug list "research".

## The suites

| Suite | Question | Verdicts | Cases |
|---|---|---|---|
| `conformance/` | are we as correct as what already exists | `conformant`, `non-conformant`, standard named | MCP-01, SKL-01, CTX-01, MOD-01 |
| `alignment/` | did cognition decouple from reality | `observed` / `aligned`, with the measurement | V1, E1, S1, C1, K1 |

## Controls are written before cases

Every alignment case has a benign twin: same shape, same channel, no defect.
A case with a failing injected arm and a passing control arm is evidence. A
case with both arms failing measures indifference, and is reported as
nothing. This rule exists because a sibling benchmark measured injection
resistance as `0/6` against an injected script and `0/6` against the benign
control, which is indifference to the channel, not resistance.

## Method

1. Write the control first. If the control cannot fail, the case cannot prove
   anything.
2. Run the case against the system as it exists today. Early failures are the
   point: a benchmark that passes on the first run proves nothing.
3. Record the trace, the verdict, and the control side by side.
4. Only then consider an intervention, and re-measure after it.

## Status

Measurement first, deliberately. No runtime, no daemon, no app is being
built here. A runtime is a possible conclusion of this benchmark, not a goal.
See [ADR note](https://github.com/guillaume-flambard/cuesheet/blob/main/docs/decisions/ADR-001-measure-before-runtime.md).

## Licence

MIT. See [LICENSE](LICENSE).
