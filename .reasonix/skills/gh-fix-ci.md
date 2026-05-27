---
name: gh-fix-ci
description: Debug or fix failing GitHub PR checks that run in GitHub Actions. Inspect checks, summarize failures, draft a fix plan, and implement.
---
# Github PR Checks Fix

Use `gh` to locate failing PR checks, fetch GitHub Actions logs for actionable failures, summarize the failure snippet, then propose and implement a fix.

## Prerequisites

Authenticate with `gh auth login` (needs repo + workflow scopes). Verify with `gh auth status`.

## Workflow

1. **Verify gh authentication** — Run `gh auth status` in the repo.

2. **Resolve the PR** — Default to current branch PR:
   ```
   gh pr view --json number,url
   ```

3. **Inspect failing checks** — Use the bundled script:
   ```
   python3 /Users/shivam94/.codex/skills/gh-fix-ci/scripts/inspect_pr_checks.py --repo "." --pr "<number>"
   ```
   Add `--json` for machine-friendly output.

   Manual fallback:
   ```
   gh pr checks <pr> --json name,state,bucket,link,startedAt,completedAt,workflow
   gh run view <run_id> --log
   ```

4. **Scope non-GitHub Actions checks** — If `detailsUrl` is not a GitHub Actions run, label it as external and only report the URL.

5. **Summarize failures** for the user — failing check name, run URL, concise log snippet.

6. **Create a fix plan** and request approval before implementing.

7. **Implement after approval** — apply the approved plan, summarize diffs.

8. **Recheck** — After changes, suggest re-running tests and `gh pr checks` to confirm.
