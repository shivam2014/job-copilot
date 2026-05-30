# Session Start — Job Copilot

## Before You Start

1. Check `handoff/HANDOFF-latest.md` for current state
2. Read `AGENTS.md` for architecture and quick commands
3. Load `$feynman-workflow` and `$caveman` for communication style
4. Load `$chrome-ext-test` for browser automation knowledge

## Quick Start

```bash
# Launch Chrome with extension (background)
node scripts/keep_alive.mjs &

# Verify extension loaded and form visible
node scripts/test/inspect.mjs

# If no form visible, navigate to Oracle CX and log in
# URL: https://icfcjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Aerospace/job/111402

# Test field-by-field
node scripts/test/clear.mjs    # clear all first
# Then click F buttons one by one, verify visually

# Run Fill All at end
node scripts/test/fill.mjs
```

## Rules

- Always clear before testing — verify empty first
- Test one field at a time — visual verification required
- Use Playwright scripts, not inline node -e
- Never kill Chrome between commands — use connect/disconnect
- Never touch devMode toggle on chrome://extensions
- Check for extension errors after every reload
- Commit after each successful fix
- Update handoff document at session end

## Skills

| Skill | Purpose |
|-------|---------|
| `$feynman-workflow` | Default workflow — Before/During/After for every action |
| `$caveman` | Terse communication mode |
| `$chrome-ext-test` | Browser automation knowledge + gotchas |
| `$skill-creator` | Update skills as you learn |
