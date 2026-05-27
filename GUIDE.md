# Guide — Job Copilot Session Workflow

> How we launch, debug, and iterate. Compact version.
> Last updated: 2026-05-26

## Launch

```bash
cd ~/job-copilot
bash scripts/dev_launch.sh
```

This uses `--remote-debugging-pipe` + `Extensions.loadUnpacked` (Chrome 148 killed `--load-extension`). Opens Oracle job page with JC extension loaded.

## CDP Tools

### scripts/cdp.mjs (built-in CDP, targets Oracle page by URL)

```bash
node scripts/cdp.mjs list                       # all targets
node scripts/cdp.mjs eval "document.title"      # run JS on Oracle page
node scripts/cdp.mjs nav <url>                  # navigate page
node scripts/cdp.mjs click <x>,<y>              # CDP mouse click at coords
```

### scripts/cdp_adv.mjs (fresh Oracle tab with console suppression)

```bash
node scripts/cdp_adv.mjs fresh-email            # new tab → email page
node scripts/cdp_adv.mjs status                 # check page state
```

## Oracle CX Combobox Strategy

Oracle CX comboboxes (`.cx-select-input`, `role="combobox"`) **resist JS `.click()` and `el.value =`** because Knockout's observables don't update from synthetic events.

**Working approaches** (see RESEARCH.md for full comparison and sources):
1. **Character-by-character typing** (PRIMARY) — Progressive `value.substring(0, i+1)` + `input` event dispatch. Triggers autocomplete. Used by Workday autofill extensions in production. Works on all frameworks.
2. **InputEvent per-character** — `new InputEvent('input', {inputType: 'insertText', data: char})`. Real browser-level event, unfilterable by any framework.
3. **CDP `Input.insertText` via chrome.debugger** (LAST RESORT) — Confirmed to conflict with `--remote-debugging-pipe` mode. Do not rely on this strategy.

**Important**: `chrome.debugger.attach()` is unreliable when the CDP bridge is in pipe mode.
Strategies 1 and 2 are the production approaches — they require no special permissions and work
across all ATS platforms (Oracle CX, Workday, Greenhouse, etc.).

## Key Files

| File | What |
|------|------|
| `extension/content/content.js` | Auto-fill, panel UI, learning system, MutationObserver |
| `extension/content/form-detector.js` | Field identification patterns, Oracle combobox fill |
| `extension/background/background.js` | Service worker, PDF extraction, CDP combobox fill handler |
| `scripts/launch_with_ext.mjs` | Chrome launch via `--remote-debugging-pipe` + WebSocket bridge |
| `scripts/cdp.mjs` | Direct CDP interaction script (eval, nav, click, screenshot) |
| `scripts/cdp_adv.mjs` | Advanced CDP (fresh tab with console suppression) |
| `extension/manifest.json` | Permissions: storage, activeTab, scripting, **debugger** |

## Common CDP Patterns

```bash
# List all page targets
node scripts/cdp.mjs list

# Get field values
node scripts/cdp.mjs eval "document.getElementById('country-3')?.value"

# Navigate to email step
node scripts/cdp.mjs nav "https://.../apply/email"

# Activate the Oracle tab (bring to front)
node -e "require('./scripts/cdp.mjs helper')"  # use direct node eval
```

## Syntax Checks

```bash
node -c extension/content/content.js
node -c extension/content/form-detector.js
node -c extension/background/background.js
node -c lib/llm-client.js
```

## Reload Extension

```bash
# Via CDP (from extension target):
chrome.runtime.reload()

# Via Chrome Developer Private API (from any tab):
chrome.developerPrivate.reload('nbpeoddibjhngmomojgpeoiceocnoknn')

# Manual: chrome://extensions → click refresh on JC
```

## Profile Storage Keys

| Key | Source | Used in |
|-----|--------|---------|
| `profile_name` | LLM extraction → options page | `buildFillMap()` → `name`, `first_name`, `last_name`, `full_name` |
| `profile_email` | LLM extraction | `buildFillMap()` → `email` |
| `profile_phone` | LLM extraction | `buildFillMap()` → `phone` (split into `phone` + `phone_country_code`) |
| `profile_address` | LLM extraction | `buildFillMap()` → `address`, `street_address`, `city`, `country` (fallback when no granular parts) |
| `profile_linkedin` | LLM extraction | `buildFillMap()` → `linkedin` |
| `profile_github` | LLM extraction | `buildFillMap()` → `github` |
| `profile_website` | LLM extraction | `buildFillMap()` → `website` |
| `profile_work_authorization` | LLM extraction | `buildFillMap()` → `work_authorization` |
| `resume_text` | PDF extraction → `#resume_text` textarea | AI question answering context in `fillAIQuestions()` |
| `resume_full_data.extractedFields.street` | LLM extraction | `buildFillMap()` → `street_address` (preferred over address parsing) |
| `resume_full_data.extractedFields.city` | LLM extraction | `buildFillMap()` → `city` (preferred) |
| `resume_full_data.extractedFields.state` | LLM extraction | `buildFillMap()` → `state` (preferred) |
| `resume_full_data.extractedFields.postal_code` | LLM extraction | `buildFillMap()` → `postal_code` (preferred) |
| `resume_full_data.extractedFields.country` | LLM extraction | `buildFillMap()` → `country` (preferred) |

---

## Circuit Breaker Architecture

> Prevents the AI from hanging silently when the CDP bridge is down.
> Added: 2026-05-26

### Three States

| State | Meaning | Behavior |
|-------|---------|----------|
| **CLOSED** | Bridge healthy | Commands pass through normally |
| **OPEN** | Bridge failed | All commands rejected immediately with `BRIDGE_DOWN` (no timeout wait) |
| **HALF-OPEN** | Cooldown expired | One test command allowed; success → CLOSED, failure → OPEN again |

### Flow

```
Every CDP command →
  1. Check circuit state (CLOSED or HALF-OPEN? proceed. OPEN? → exit code 5)
  2. Pre-flight HTTP ping to 127.0.0.1:9222/json/version (3s timeout)
  3. Ping succeeds → connect WebSocket, run command (8s hard timeout)
  4. Ping fails → record failure, update circuit state, exit code 2
  5. Command succeeds → reset circuit to CLOSED
  6. Command fails → increment failure count, OPEN if >=2 failures
```

### Persistence

Circuit state is stored in `/tmp/jc-cdp-circuit.json` so it survives between
CLI invocations and across AI agent turns.

```bash
# View current circuit state
cat /tmp/jc-cdp-circuit.json

# Reset circuit (start fresh, e.g. after bridge restart)
rm -f /tmp/jc-cdp-circuit.json
```

### Structured Exit Codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Success | — |
| 2 | Bridge down | Restart bridge or relaunch Chrome |
| 3 | Timeout | Bridge overloaded, wait and retry |
| 4 | No Oracle page | Navigate to Oracle job URL first |
| 5 | Circuit open | Wait for cooldown or reset circuit |

### Structured Results

Every command outputs JSON with at minimum:
```json
{"status": "ok", "value": ...}
{"status": "error", "error": "...", "error_type": "bridge_down|timeout|circuit_open|no_oracle_page|js_eval_error", "retryable": true|false}
```

Parse these in calling code. NEVER treat CDP output as raw text.

### Files Using This Pattern

- `scripts/cdp.mjs` — general CDP tool
- `scripts/cdp_adv.mjs` — advanced CDP (fresh tab, console suppression)
- Both share the same `/tmp/jc-cdp-circuit.json` state file

## Session Startup

Before every session:
1. Read `SESSION_START.md` — mandatory startup checklist
2. Check `handoff/` directory for most recent handoff
3. Verify bridge health with `node scripts/cdp.mjs status`

---

## Self-Healing Fill Strategy (Fallback Chain)

> The extension must work without AI handholding. When strategy A fails, try B, then C.
> Every failure reports to the user — no silent failures.

| Priority | Strategy | How | Works On |
|----------|----------|-----|----------|
| 1 | Direct DOM: `el.value = x` + dispatch `input`/`change` | Simple value set | Basic HTML forms |
| 2 | Native value setter: `HTMLInputElement.prototype.value` setter + events | Triggers React/Vue listeners | React, Vue, most SPAs |
| 3 | Character-by-character typing (progressive value + input events) | Triggers autocomplete, works on all frameworks | Oracle CX comboboxes (Knockout), Workday dropdowns |
| 4 | InputEvent per-character (`InputEvent` with `insertText`) | Real browser event, unfilterable by frameworks | Oracle CX comboboxes, any stubborn input |
| 5 | CDP `Input.insertText` via chrome.debugger (LAST RESORT) | OS-level text insertion | Falls back when DOM/event approaches fail (blocked on pipe mode) |
| 6 | CDP `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` | Clicks at pixel positions, keyboard events | Dropdown toggles, Oracle "Next" button |

### Fill Routing Logic (in `fillField()`)

```
el.type === 'file'? → return false (security)
isOracleCombobox(el)? → strategy 3 (CDP via background)
el is SELECT? → strategy 1 + option matching (exact → startsWith → word → includes)
else? → strategy 1, then strategy 2
```

### Adding a New ATS (Workday, Lever, Greenhouse, etc.)

1. Add field patterns to `FormDetector.fieldPatterns` in `form-detector.js`
2. If the ATS uses a custom UI framework that rejects DOM events, add a new
   `is<Ats>Combobox()` detector and route `fillField()` to the appropriate strategy
3. If strategy 3 (CDP) is needed, add a new message handler in `background.js`
4. Never rewrite the fill engine — the fallback chain handles all known frameworks

---

## Error Reporting Requirements

Every component MUST report failures visibly:

- **fillField()** → returns `true`/`false`. Caller checks and shows status.
- **fillOracleCombobox()** → returns `true`/`false`. If false, content.js reports
  "Could not fill [field label]: Oracle dropdown didn't respond".
- **fillDateCombo()** → logs which date field failed and why.
- **fillProfileSections()** → reports how many sections filled, or why it couldn't.
- **LLM answers** → reports which question failed, not just a generic error.

No silent `return false` anywhere. If a field can't be filled, the user must know.
