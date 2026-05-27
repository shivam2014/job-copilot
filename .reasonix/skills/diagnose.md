---
name: diagnose
description: Disciplined diagnosis loop for hard bugs and performance regressions. Reproduce → minimise → hypothesise → instrument → fix → regression-test.
---
# Diagnose

A discipline for hard bugs. Skip phases only when explicitly justified.

When exploring the codebase, use the project's domain glossary to get a clear mental model of the relevant modules, and check ADRs in the area you're touching.

## Phase 1 — Build a feedback loop

**This is the skill.** Everything else is mechanical. If you have a fast, deterministic, agent-runnable pass/fail signal for the bug, you will find the cause — bisection, hypothesis-testing, and instrumentation all just consume that signal. If you don't have one, no amount of staring at code will save you.

Spend disproportionate effort here. **Be aggressive. Be creative. Refuse to give up.**

### Ways to construct one — try them in roughly this order

1. **Failing test** at whatever seam reaches the bug — unit, integration, e2e.
2. **Curl / HTTP script** against a running dev server.
3. **CLI invocation** with a fixture input, diffing stdout against a known-good snapshot.
4. **Headless browser script** (Playwright / Puppeteer) — drives the UI, asserts on DOM/console/network.
5. **Replay a captured trace.** Save a real network request / payload / event log to disk; replay it through the code path in isolation.
6. **Throwaway harness.** Spin up a minimal subset of the system (one service, mocked deps) that exercises the bug code path with a single function call.
7. **Property / fuzz loop.** If the bug is "sometimes wrong output", run 1000 random inputs and look for the failure mode.
8. **Bisection harness.** If the bug appeared between two known states (commit, dataset, version), automate "boot at state X, check, repeat" so you can `git bisect run` it.
9. **Differential loop.** Run the same input through old-version vs new-version (or two configs) and diff outputs.

### Phase 2 — Minimise

Once you have a feedback loop, reduce the reproduction to its minimal form. Strip away everything not needed to trigger the bug.

- Remove test cases, reduce inputs, delete unrelated code paths
- Keep reducing until removing anything else makes the bug disappear
- The minimal reproduction tells you where the bug lives

### Phase 3 — Hypothesise

Generate ranked hypotheses for the root cause. Each hypothesis must answer: "Given what I know about the code, what mechanism could produce this failure?"

Rank by:
1. How well it explains the observed symptoms
2. How easy it is to test (instrument → confirm/eliminate)
3. Prior experience with similar bugs in this area

### Phase 4 — Instrument

Add observability to confirm or eliminate your top hypothesis. Prefer the cheapest test first:
- Add a log/trace/print at the critical decision point
- Write a focused assertion that would fail if your hypothesis is wrong
- Run a targeted experiment (swap impl, pass mock, change config)
- If the instrumentation confirms → move to fix. If it eliminates → move to next hypothesis.

### Phase 5 — Fix

Apply the minimal change that addresses the root cause (not the symptom). Then:
- Run the feedback loop to confirm it passes
- Check that existing tests still pass
- Add a regression test that would catch this specific failure mode

### Phase 6 — Learn

One-sentence what the root cause was and why it escaped earlier detection. Consider:
- Would a different test have caught this?
- Is there a lint/type/pattern that flags this class of bug?
- Is the module too shallow (interface as complex as impl)?
