---
name: playwright
description: Automate a real browser from the terminal (navigation, form filling, snapshots, screenshots, data extraction) via playwright-cli.
---
# Playwright CLI Skill

Drive a real browser from the terminal using `playwright-cli`. Prefer the bundled wrapper script.

## Prerequisite check

Before proposing commands, check `command -v npx >/dev/null 2>&1`. If not available, ask user to install Node.js/npm.

## Quick start

Use the wrapper script (from Codex origin):
```
PWCLI="/Users/shivam94/.codex/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" open https://playwright.dev --headed
"$PWCLI" snapshot
"$PWCLI" click e15
"$PWCLI" type "Playwright"
"$PWCLI" press Enter
"$PWCLI" screenshot
```

## Core workflow

1. Open the page.
2. Snapshot to get stable element refs.
3. Interact using refs from the latest snapshot.
4. Re-snapshot after navigation or significant DOM changes.
5. Capture artifacts (screenshot, pdf, traces) when useful.

Minimal loop:
```
PWCLI="/Users/shivam94/.codex/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" open https://example.com
"$PWCLI" snapshot
"$PWCLI" click e3
"$PWCLI" snapshot
```

## When to snapshot again

- After navigation
- After clicking elements that change the UI substantially
- After opening/closing modals or menus
- After tab switches

Refs can go stale. When a command fails due to a missing ref, snapshot again.

## Recommended patterns

### Form fill and submit
```
"$PWCLI" open https://example.com/form
"$PWCLI" snapshot
"$PWCLI" fill e1 "user@example.com"
"$PWCLI" fill e2 "password123"
"$PWCLI" click e3
"$PWCLI" snapshot
```

### Multi-tab work
```
"$PWCLI" tab-new https://example.com
"$PWCLI" tab-list
"$PWCLI" tab-select 0
"$PWCLI" snapshot
```

## Guardrails

- Always snapshot before referencing element ids like `e12`.
- Re-snapshot when refs seem stale.
- Prefer explicit commands over `eval` and `run-code` unless needed.
- Use `--headed` when a visual check will help.
- Default to CLI commands and workflows, not Playwright test specs.
