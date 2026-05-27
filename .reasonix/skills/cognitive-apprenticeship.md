---
name: cognitive-apprenticeship
description: Learn from AI's reasoning process — observations, hypotheses, debugging steps, analysis. Use when user wants to understand HOW AI solves a problem.
---
# AI Cognitive Apprenticeship

Learn from the AI's process — observations, hypotheses, debugging, analysis — not just the output.

## The 6 Methods

When activated, the AI applies one of these methods based on the user's intent:

| Method | What AI does | Trigger |
|---|---|---|
| **Modelling** | Solves the problem while narrating full reasoning aloud | "Show me how you'd solve this — observations first, then hypotheses, then fix" |
| **Coaching** | Watches user try, then critiques their *process* | "Watch my approach and tell me where my reasoning goes wrong" |
| **Scaffolding** | Gives partial solution, user fills the gaps | "Give me the first 30% to get oriented, let me take over" |
| **Articulation** | Asks user to explain reasoning, then corrects | "Ask me how I'd approach it first, then correct my reasoning step by step" |
| **Reflection** | After solving, shows what it *would have* done differently | "Now reflect — what approaches did you reject? What was misleading?" |
| **Exploration** | Points direction, user explores independently | "Don't solve it — tell me what to investigate first and what tools to use" |

## Default: Modelling Protocol

When no specific method is requested, use Modelling (the most common learning mode):

### Pass 1 — Extract the Process

Before giving any solution code:

1. **Observations** — What do you notice first about the code/error/data? Don't jump to conclusions.
2. **Hypotheses** — What could be causing this? Rank by likelihood and say why.
3. **Investigation** — What would you test or check to confirm/eliminate each hypothesis?
4. **Narrowing** — How do you identify the root cause?
5. **Solution** — What fix options do you consider? Why this one?
THEN present the solution.

### Pass 2 — Extract the Reflection

After the solution:

1. What other approaches did you consider and reject?
2. What in the codebase/data was misleading or confusing?
3. What would you do differently with more context?
4. What pattern from this should the user remember for next time?

## Debugging-with-Reasoning Protocol

When debugging, structure the response as:

```
## Observations
[what I notice looking at this — raw observations, no conclusions]

## Hypotheses (ranked)
1. [most likely] — because [evidence/reasoning]
2. [less likely] — because [evidence/reasoning]

## Investigation
[what I'd check to confirm/eliminate each hypothesis]

## Root Cause
[what the evidence points to and why]

## Fix
[the actual change + explanation of why it fixes root cause, not symptom]

## Retrospective
[what would have caught this earlier / what pattern to learn]
```

## Git Safety Net

Always pair with git checkpoints:

```
git checkout -b learn/<topic>
git add -A && git commit -m "init: state before AI reasoning session"
# ... after each insight ...
git commit -m "learn: <concept>"
# ... if AI goes bad ...
git reset --hard HEAD
# ... if total loss ...
git checkout main && git branch -D learn/<topic>
```

Commit format: `learn: <concept>` / `learn: debugging pattern — <pattern>` / `learn: rejected approach — <why>`

## Reference

- arXiv 2601.19053 — "From Answer Givers to Design Mentors: Guiding LLMs with the Cognitive Apprenticeship Model"
- arXiv 2601.16720 — "Watching AI Think: User Perceptions of Visible Thinking in Chatbots"
- Anthropic (Jan 2026) — "How AI assistance impacts the formation of coding skills"
