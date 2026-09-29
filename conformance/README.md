# Conformance suite

No research claims live here. The question is narrow:

> Is our system at least as correct as the standards and harnesses that
> already exist?

A failure here is our own regression against a property that is already known
and already implemented elsewhere. It must never be reported as a discovery.

## Reference implementations, which we match but do not claim to beat

| Property | Reference | Where it is specified |
|---|---|---|
| Tool list changes mid-connection | MCP `tools.listChanged: true` + `notifications/tools/list_changed`, client refs `tools/list` | MCP specification, server/tools |
| A skill added after a session starts becomes usable | Claude Code v2.1.152: `/reload-skills`, and a `SessionStart` hook returning `reloadSkills: true`, described as decoupling capability discovery from context accumulation | Claude Code changelog, 2026-05-27 (verify against the primary changelog) |
| Injecting into a live run | Microsoft Agent Framework message-injection middleware, Python 1.11.0 (2026-07-10) | shipped, documented |
| A step that must block for a human | LangGraph `interrupt()` with a checkpointer, resumed with `Command(resume=...)` | shipped, documented |
| Boundary on dangerous verbs | Skill approval (MAF .NET 1.13.0), OpenAI guardrails | shipped, documented |

## Cases

### SKL-01, a skill added after a session starts becomes resolvable

The incident that created this suite: on 2026-09-29 three agents were briefed
to use the `github-readme` skill and none could resolve it, and none reported
the requirement as unsatisfiable. Their session-start snapshot predates the
skill.

What the case measures: at delegation time, against the live registry, is a
newly created skill resolvable, and does an unresolved requirement stop the
spawn? This is the property `resolveCapabilities()` in
`guillaume-flambard/cuesheet` implements. The case passes when resolution
happens live and a missing skill blocks before spawn.

What it deliberately does not claim: the runtime's own hot reload. Mid-turn
reload inside a foreign runtime is a runtime property, and making that claim
here would be a conformance suite pretending to be research.

### MCP-01, tools/list_changed is honoured, not just emitted

The server side declares `listChanged` and sends the notification. The question
is whether the **client** re-issues `tools/list` without a reconnect, and
whether a tool removed mid-connection stops being callable.

### CTX-01, an injected directive reaches its named target and is acked

Inject mid-run, then verify the directive lands on the target agent and produce
an acknowledgement count (`3/3 agents`). The variance in the field is whether
consuming the directive is guaranteed by the next model call, or only promised.

### MOD-01, a model switch preserves canonical state

Switch the model between two inferences of the same task and check that the
canonical state, not the previous provider's transcript, carries forward. The
failure signature is state that only makes sense to the outgoing provider.

## Verdicts, and the words that are allowed here

`conformant` and `non-conformant`, always against a named standard and a named
reference implementation. Runs are recorded with harness version and model
backend, because the same harness may differ across models.

## What is not in this suite

Latency, throughput, cost. Those belong to a comparison benchmark, and mixing
them with correctness dilutes both.
