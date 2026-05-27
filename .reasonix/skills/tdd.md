---
name: tdd
description: Test-driven development with red-green-refactor loop. Use when building features or fixing bugs using TDD, or test-first development.
---
# Test-Driven Development

## Philosophy

**Core principle**: Tests should verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't.

**Good tests** are integration-style: they exercise real code paths through public APIs. They describe _what_ the system does, not _how_ it does it. A good test reads like a specification — "user can checkout with valid cart" tells you exactly what capability exists. These tests survive refactors because they don't care about internal structure.

**Bad tests** are coupled to implementation. They mock internal collaborators, test private methods, or verify through external means. The warning sign: your test breaks when you refactor, but behavior hasn't changed.

## Anti-Pattern: Horizontal Slices

**DO NOT write all tests first, then all implementation.** This is "horizontal slicing" — treating RED as "write all tests" and GREEN as "write all code."

This produces **crap tests**:

- Tests written in bulk test _imagined_ behavior, not _actual_ behavior
- You end up testing the _shape_ of things (data structures, function signatures) rather than user-facing behavior
- Tests become insensitive to real changes — they pass when behavior breaks, fail when behavior is fine
- You outrun your headlights, committing to test structure before understanding the implementation

**Correct approach**: Vertical slices via tracer bullets. One test → one implementation → repeat. Each test responds to what you learned from the previous cycle.

## The Loop

### RED — Write a failing test

1. Identify the smallest piece of user-facing behavior not yet implemented
2. Write a test that expresses it through a public API
3. Run the test — it must fail (this confirms the test is testing something real)

### GREEN — Make it pass

1. Write the simplest implementation that makes the test pass
2. Do NOT refactor yet — this phase is about getting to green as fast as possible
3. Run the test — it must pass

### REFACTOR — Clean up

1. Now that the test passes, clean up both the implementation and the test
2. Remove duplication, improve naming, simplify logic
3. Run the test again to confirm it still passes

### Repeat

Each cycle adds one piece of behavior. Each cycle is driven by what you learned in the previous one.

## Commit Cadence

- Commit after GREEN: `test: add test for X` + `feat: implement X`
- Squash the two before PR if preferred, but the separation matters during development

## Working with Existing Code

- When adding to tested code: add the test first, then implement
- When fixing a bug: write a failing test that reproduces the bug first, then fix
- When refactoring: ensure tests exist in GREEN, refactor, confirm they still pass
