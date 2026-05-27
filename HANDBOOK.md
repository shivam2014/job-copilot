# Handbook — Job Copilot

> Current state, known blockers, and what comes next.
> Last updated: 2026-05-26

## Core Loop

Chrome extension (MV3) that auto-fills job application forms from resume data + an LLM endpoint you bring. Upload resume → JC extracts profile → fills forms → learns from corrections.

## Current Status

### Fixed This Session (2026-05-26)

| Issue | Fix |
|-------|-----|
| **Re-fill infinite loop (~3s dropdown clicks)** | Added `window.__jcFilling` guard to `MutationObserver` — skips DOM-triggered fills while JC is actively filling. Also wrapped `runSpaReFill()` + auto-fill with the flag. |
| **Oracle country combobox not filling** | Added `"debugger"` permission + background CDP handler (`jc_cdp_fill_combobox`) that types via `chrome.debugger.sendCommand`. Country field fills "Poland" correctly. |
| **Phone number not split** | `buildFillMap()` now splits `+33-753788537` into `phone_country_code: "+33"` and `phone: "753788537"` via regex. |
| **Oracle field detection missing** | Added `country-codes`, `addressLine1/2/3`, `region2`, `postalCode` patterns to `FormDetector.fieldPatterns`. |
| **Oracle combobox opening via JS `.click()`** | `fillOracleCombobox()` now uses `chrome.debugger` CDP `Input.insertText` instead of DOM events (Knockout rejects synthetic events). |
| **`resume_text` not stored for AI questions** | `handlePDF()` now populates the `resume_text` textarea after PDF extraction — auto-save persists it to storage. "Fill AI Questions" can now access the resume text. |
| **Granular address not extracted** | LLM prompt updated to extract `street`, `city`, `state`, `postal_code`, `country` separately. `buildFillMap()` reads granular parts from `resume_full_data.extractedFields`, falling back to comma-splitting `profile_address`. |

### Known Blockers

| Issue | Why It's Stuck |
|-------|----------------|
| **Phone country code dropdown may not fill** | `chrome.debugger.attach` conflicts with `--remote-debugging-pipe`. **Deferred** — use character-by-character typing (Strategy 3) or InputEvent typing (Strategy 4) instead. |
| **Oracle "Next" button can't be clicked** | Knockout's `submit: next` binding on the form resists all synthetic events — JS `.click()`, CDP mouse events, and form submit dispatches. User must click manually. |
| **Bridge crashes on console flood** | Oracle SPA floods `Runtime.enable` with console events. Mitigated with fresh-tab + console suppression approach, but the bridge itself is fragile under pipe load. |
| **Month values need format conversion** | Oracle CX month comboboxes expect month names (Jan/Feb) or zero-padded numbers (01-12), not bare numbers (1-12). `parseDateParts()` must format months accordingly. |

### What Works
- Extension loads via `--remote-debugging-pipe` + `Extensions.loadUnpacked`
- JC button + panel injects on Oracle pages
- **Fill All** fills: `firstName`, `lastName`, `email`, `phone` (local), `fullName`, `skills`, `job-alerts-checkbox`
- **Country, phone CC, month/year dates, employer country** — Oracle CX comboboxes: use character-by-char typing + InputEvent strategy chain
- **AI Questions** now works — resume text stored for LLM context
- **Address filling** uses granular parts (street/city/postal/state) when extracted by LLM
- Panel doesn't minimize during fill/clear
- Error messages clickable (opens settings)
- `cdp.mjs` works for non-SPA pages and Oracle with console suppression
- Re-fill loop eliminated (no more random dropdown clicks)
- Phone number splitting (+33-753788537 → +33 + 753788537)

## Quick Reference

```bash
# Launch Chrome with JC
bash scripts/dev_launch.sh

# CDP tools
node scripts/cdp.mjs eval "expr"          # run JS on Oracle page
node scripts/cdp.mjs nav <url>            # navigate
node scripts/cdp.mjs list                 # list all targets

# Oracle URL
https://icfcjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Aerospace/job/111402

# Extension ID
nbpeoddibjhngmomojgpeoiceocnoknn

# Reload extension
chrome.developerPrivate.reload('nbpeoddibjhngmomojgpeoiceocnoknn')

# Check syntax
node -c extension/content/content.js
node -c extension/content/form-detector.js
node -c extension/background/background.js
```

## Architecture Notes

### Fill Flow
1. **User** clicks **Fill All** (or MutationObserver auto-fill triggers)
2. `FormDetector.detect()` → identifies all fields on page
3. `buildFillMap()` → reads `chrome.storage.sync` (including `resume_full_data`), builds value map with name/phone/address splitting. Address uses granular parts from LLM extraction (street/city/state/postal/country) when available, falls back to comma-splitting `profile_address`.
4. For each field: `fillMap[field.name]` → `skipFieldForType()` → `FormDetector.fillField()`
5. For Oracle CX comboboxes: `fillOracleCombobox()` → `chrome.runtime.sendMessage()` → background `chrome.debugger` → CDP `Input.insertText` + `Enter`
6. `listenForCorrections()` → monitors user edits for learning

### Key Protections
- `window.__jcFilling` — blocks MutationObserver re-trigger during fill
- `skipAutoFill` — cleared after `clearForm()` to prevent auto-re-fill
- `fillOracleCombobox()` pre-checks — won't open dropdown for phone-number-length values

## Remaining Work

### Priority
1. **Fix phone country code CDP fill** — `chrome.debugger.attach` conflicts with `--remote-debugging-pipe` mode when a second debugger tries to attach. Needs alternate CDP approach or connection pooling.
2. **Make bridge more robust** — WebSocket reconnection logic, pipe buffer management to handle Oracle SPA console flood.
3. **Multi-section SPA support** — fill fields across all sections (experience, education, skills, languages) instead of just the first visible section.
4. **Oracle "Next" button on email step** — Knocks out all synthetic events. Possible approach: CDP `Input.dispatchMouseEvent` at real coordinates of the button. 

### Circuit Breaker Pattern

**Added**: 2026-05-26 — structural solution to prevent AI from getting stuck in loops when CDP fails.

**What it is**: A three-state circuit breaker (CLOSED → OPEN → HALF-OPEN) embedded in `scripts/cdp.mjs` and `scripts/cdp_adv.mjs` that prevents silent hangs.

**Before**: CDP commands could hang for 25s or indefinitely. The AI would try 5-10 workarounds before giving up.

**After**: Every CDP call has:
1. Pre-flight HTTP ping (3s timeout) → bridge dead? return `BRIDGE_DOWN` instantly
2. Hard 8s timeout per command → timeout? return structured error
3. Consecutive failures (≥2) → circuit opens → all subsequent calls return `CIRCUIT_OPEN` immediately
4. 15s cooldown → circuit transitions to HALF_OPEN → one test call decides recovery

**Persistence**: State stored in `/tmp/jc-cdp-circuit.json`, shared between `cdp.mjs` and `cdp_adv.mjs`.

**Discovery**: This is documented in `SESSION_START.md` (startup checklist), `GUIDE.md` (architecture), and `HANDBOOK.md` (this entry). All new sessions should read these files first.

**Impact**: The AI cannot silently hang anymore. If bridge is down, the tool itself returns a clear signal, preventing wheel-spinning.

---

## Core Architecture Principle: Self-Sufficient Extension

> The extension must work without AI handholding every session. The AI's job is to
> improve the extension structurally — not to babysit it through every form.

### Rules

1. **No manual CDP workarounds per session**. If a field doesn't fill, the fix is
   to update the extension code (form-detector.js, content.js, background.js), not
   to manually type values via CDP scripts. The extension must handle it natively.

2. **Report, don't hide**. Every fill failure must surface to the user via
   `showStatus()` or console.log. No silent `return false` without feedback.
   - Oracle combobox fails? → show "Country field: CDP fill failed, check debugger"
   - Date field fails? → show "Start date: could not open month dropdown"
   - AI question fails? → show which question and why

3. **Multi-ATS ready**. The `FormDetector.fieldPatterns` and `fillField()` routing
   must be designed so that adding a new ATS (Workday, Lever, Greenhouse, etc.)
   means adding pattern entries — not rewriting the fill engine.

4. **Self-healing fill strategies**. When strategy A fails, try B, then C, then D.
   Each strategy reports success/failure via console.log. The fallback chain is:
     1. Direct DOM value + events (works for basic inputs)
     2. Native value setter via `Object.getOwnPropertyDescriptor` (bypasses React/Vue/KO interceptors)
     3. Character-by-character typing with progressive `value.substring(0, i+1)` + `input` events (triggers autocomplete on Oracle CX/Workday comboboxes)
     4. InputEvent per-character typing `new InputEvent('input', {inputType: 'insertText'})` (real browser-level event, all frameworks)
     5. CDP `Input.insertText` via chrome.debugger (last resort — may conflict with `--remote-debugging-pipe`)
   **Note**: Strategy 5 (CDP) is unreliable on pipe mode. Do not rely on it. Strategies 3 and 4 are the
   primary approaches for Knockout/Oracle CX comboboxes — confirmed by real-world autofill extensions.

### How to Test (Same Every Time)

```
1. Clear All Fields → accept dialog
2. Fill All
3. Inspect: what's full? what's empty? what's wrong?
4. Fix the code, reload extension, repeat from step 1
```

No guessing, no assumptions. The form state after Fill All is the ground truth.
