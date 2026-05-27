---
name: gh-address-comments
description: Help address review/issue comments on the open GitHub PR for the current branch using gh CLI.
---
# PR Comment Handler

Guide to find the open PR for the current branch and address its comments with gh CLI.

Prereq: ensure `gh` is authenticated — run `gh auth status`. If not, `gh auth login`.

## 1) Inspect comments needing attention

Run the bundled script:
```
python3 /Users/shivam94/.codex/skills/gh-address-comments/scripts/fetch_comments.py
```

This prints all the comments and review threads on the PR.

## 2) Ask the user for clarification

- Number all the review threads and comments
- Provide a short summary of what would be required to apply a fix for each
- Ask the user which numbered comments should be addressed

## 3) Apply fixes

- Apply fixes for the selected comments

**Note:** If `gh` hits auth/rate issues mid-run, prompt the user to re-authenticate with `gh auth login`, then retry.
