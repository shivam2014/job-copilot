---
name: keep-codex-fast
description: Safe local Codex state maintenance — inspect session/worktree/log bloat, archive instead of delete, with backups.
---
# Keep Codex Fast

Inspect and safely maintain local Codex state. Reduces local drag without surprising the user or losing continuity.

## Safety Rules

- Inspect before mutating
- First run must be report-only (read-only, no changes)
- Back up before applying changes
- Archive or move files instead of deleting them
- If Codex is running, default to report-only
- Never modify credential files unless explicitly asked
- Do not print raw thread IDs or paths unless user asks for details

## Default Workflow

1. Run the bundled script in report mode:
   ```
   python3 /Users/shivam94/.codex/skills/keep-codex-fast/scripts/keep_codex_fast.py
   ```

2. Summarize:
   - Active session size
   - Archived session size
   - Largest active sessions
   - Stale worktree candidates
   - Log size
   - Config project prune candidates

3. For large active chats the user wants to continue, create handoff docs and reactivation prompts.

4. If user wants to apply maintenance (after closing Codex):
   ```
   python3 /Users/shivam94/.codex/skills/keep-codex-fast/scripts/keep_codex_fast.py --apply --archive-older-than-days 10 --worktree-older-than-days 7
   ```

5. Verify after applying:
   ```
   python3 /Users/shivam94/.codex/skills/keep-codex-fast/scripts/keep_codex_fast.py
   ```

## What Apply Does

- Backs up metadata to `~/Documents/Codex/codex-backups/keep-codex-fast-*`
- Archives old non-pinned sessions to `~/.codex/archived_sessions/`
- Prunes missing project blocks from `config.toml`
- Moves stale worktrees to `~/.codex/archived_worktrees/`
- Rotates large log files

## Recommended Policy

- Keep only last 7-10 days of non-pinned chats active
- Use handoff docs for important old threads
- Run maintenance weekly if Codex is used daily across many repos

## Anti-Patterns

- Never delete sessions, logs, worktrees, memories permanently
- Never apply changes while Codex is writing the DB
- Never archive important chats before creating handoff docs
- Never kill Node/dev processes automatically
