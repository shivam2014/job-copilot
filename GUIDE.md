# Guide — Job Copilot Session Workflow

> How we launch, debug, and iterate. Compact version.
> Last updated: 2026-05-27

## Launch

```bash
cd ~/job-copilot
bash scripts/dev_launch.sh
```

Uses `--remote-debugging-pipe` + `Extensions.loadUnpacked`. Opens Oracle job page with JC extension loaded.

## CDP Tools

```bash
node scripts/cdp.mjs list                       # all targets
node scripts/cdp.mjs eval "document.title"      # run JS on Oracle page
node scripts/cdp.mjs nav <url>                  # navigate page
node scripts/cdp.mjs click <x>,<y>              # CDP mouse click at coords
```

## Key Files

| File | What |
|------|------|
| `extension/content/content.js` | Panel UI, Fill All, per-field buttons, learning system, SPA observer |
| `extension/content/form-detector.js` | Field identification patterns, fill routing, Oracle combobox strategies |
| `extension/background/background.js` | Service worker, PDF extraction, LLM profile extraction |
| `extension/popup/popup.js` | Popup UI (Fill All, Clear All, field counts) |
| `extension/lib/token-tracker.js` | LLM token usage recording |
| `extension/lib/llm-client.js` | OpenAI-compatible API wrapper |
| `scripts/cdp.mjs` | Direct CDP interaction (eval, nav, click, screenshot) |

## Architecture: 3 Interactions

| Button | Where | What it does |
|--------|-------|-------------|
| **Fill All** | Panel + Popup | fillPersonal() + fillAIQuestions() + fillLearnedRadios() |
| **Per-field "F"** | Next to each field (hover) | Fills one field: textarea→LLM, others→profile |
| **Clear All** | Panel + Popup | Clears all inputs, selects, checkboxes, pills, profile tiles |

**No auto-fill.** User clicks when ready. Observer only re-injects per-field buttons on SPA transitions.

## Oracle CX Combobox Strategy

Oracle CX comboboxes resist JS `.click()` and `el.value =` because Knockout's observables don't update from synthetic events.

**Working approaches:**
1. **Character-by-char typing** (PRIMARY) — Progressive `value.substring(0, i+1)` + `input` event dispatch
2. **InputEvent per-character** — `new InputEvent('input', {inputType: 'insertText'})` per char
3. **Native value setter** + Enter + 300ms async verification
4. **DOM click** + option select (often fails due to async Knockout render)

## Profile Storage Keys

| Key | Used in |
|-----|---------|
| `profile_name` | `buildFillMap()` → `name`, `first_name`, `last_name` |
| `profile_email` | `buildFillMap()` → `email` |
| `profile_phone` | `buildFillMap()` → `phone` |
| `profile_address` | `buildFillMap()` → `address`, `street_address`, `city`, `country` |
| `resume_text` | AI question answering in `fillAIQuestions()` |
| `learned_fields` | User corrections, radio answers |
| `saved_answers` | Answer bank (max 50) |

## Syntax Checks

```bash
node -c extension/content/content.js
node -c extension/content/form-detector.js
node -c extension/background/background.js
node -c extension/lib/llm-client.js
node -c extension/lib/token-tracker.js
```

## Testing Protocol

```
1. Clear All Fields → accept dialog
2. Fill All
3. Inspect fields: what filled? what empty? what wrong?
4. Fix code, reload, repeat from step 1
```
