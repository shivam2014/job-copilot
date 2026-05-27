---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up and continue.
---
# Handoff

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save it in a `handoff/` directory in the project root, named like `handoff/HANDOFF-YYYY-MM-DD.md`.

Suggest the skills to be used, if any, by the next session.

Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
