# Handbook — Job Copilot

> Current state, known blockers, and what comes next.
> Last updated: 2026-05-27

## Core Loop

Chrome extension (MV3) that auto-fills job application forms from resume data + an LLM endpoint you bring. Upload resume → JC extracts profile → fills forms → learns from corrections.

## Current Status

### Architecture (Simplified 2026-05-27)

**3 interactions only:**
1. **Fill All** (panel button or popup) → fills personal fields + AI questions + learned radios
2. **Per-field "F" button** (hover to reveal next to each field) → fills that one field
3. **Clear All** (panel button or popup) → clears everything

**No auto-fill on page load.** User clicks when ready. No `isLoginScreen()` detection. No `watchFormChanges()`. No `fillExtras()` / `fillProfileSections()`.

### What Works
- **Form detection**: `FormDetector.detect()` identifies personal fields, textareas, selects, file uploads
- **Fill routing**: `FormDetector.fillField()` routes to `fillSelect()`, `fillTextInput()`, or `fillOracleCombobox()` based on element type
- **Oracle CX combobox**: 4-strategy fallback chain (DOM click → native setter → char-by-char → InputEvent per-char)
- **Per-field buttons**: Small "F" button on hover next to each detected field. Text inputs → profile, textareas → LLM
- **Learning**: `listenForCorrections()` saves user edits to `learned_fields`. `fillLearnedRadios()` restores learned radio answers
- **SPA support**: Observer re-injects per-field buttons on DOM changes (no auto-fill)
- **Token tracking**: `TokenTracker` now loaded as content script, records LLM usage from fill operations

### What's Broken (unresolved)

| Issue | Root Cause | Priority |
|-------|-----------|----------|
| **Phone country code combobox** gets local number instead of country code | Field detection matches `phone` pattern via name attribute, not `phone_country_code` | HIGH |
| **Title pill (Mr.) not selected** | Selector doesn't match Oracle CX page's pill structure | HIGH |
| **Employer country (countryCode) empty** | Not in field mapping or field detection doesn't find it | MEDIUM |
| **Education dates (dateAchieved) empty** | `fillDateCombo` called but dateAchieved combos not being detected | MEDIUM |
| **employerCity empty** | LLM extraction didn't include city in experience entries | MEDIUM |
| **oda-work-summary-text-area** | Required field, not in any fill mapping | LOW |
| **19x CDP click duplication** | `launch_with_ext.mjs` pipe bridge duplicates WebSocket messages — not a content script bug | LOW |

### Files

| File | Lines | Purpose |
|------|-------|---------|
| `extension/content/content.js` | 697 | Panel UI, Fill All, per-field buttons, learning, clear, SPA observer |
| `extension/content/form-detector.js` | 637 | Field detection (patterns + scoring), fill routing, combobox strategies |
| `extension/content/content.css` | 170 | Panel + per-field button styles |
| `extension/background/background.js` | 126 | PDF extraction, LLM profile extraction, options page opener |
| `extension/popup/popup.js` | 123 | Popup UI (Fill All, Clear All, field counts) |
| `extension/lib/token-tracker.js` | 79 | LLM token usage recording |
| `extension/lib/llm-client.js` | 68 | OpenAI-compatible API wrapper |
| `extension/lib/pdf-extract.js` | 61 | PDF text extraction for options page |

### Key Decisions

1. **No auto-fill on page load**: Removed from both init() and observer. Eliminated re-fill loop.
2. **`__jcFilling` guard pattern**: Fill All handler sets `window.__jcFilling = true`, observer checks and returns early.
3. **3 interactions only**: Fill All + per-field "F" buttons + Clear All. No separate "Fill Personal" / "Fill AI Questions".
4. **Per-field button routing**: Textarea → LLM, everything else → `buildFillMap()`.
5. **CDP bridge duplicates messages**: The decodeWS function in `launch_with_ext.mjs` may split messages incorrectly. Test by clicking the button manually in the browser.

## Quick Reference

```bash
# Launch Chrome with JC
bash scripts/dev_launch.sh

# CDP tools
node scripts/cdp.mjs eval "expr"          # run JS on Oracle page
node scripts/cdp.mjs nav <url>            # navigate
node scripts/cdp.mjs list                 # all targets

# Oracle URL
https://icfcjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Aerospace/job/111402

# Syntax checks
node -c extension/content/content.js
node -c extension/content/form-detector.js
node -c extension/background/background.js
```

## Architecture Notes

### Fill Flow
1. **User** clicks **Fill All** (or per-field "F" button)
2. `FormDetector.detect()` → identifies all fields on page
3. `buildFillMap()` → reads `chrome.storage.sync`, builds value map with name/address splitting
4. For each field: `fillMap[field.name]` → `skipFieldForType()` → `FormDetector.fillField()`
5. For Oracle CX comboboxes: `fillOracleCombobox()` → 4-strategy chain (DOM → native setter → char-by-char → InputEvent)
6. `listenForCorrections()` → monitors user edits for learning

### Self-Healing Fill Strategy (Fallback Chain)

| Priority | Strategy | Works On |
|----------|----------|----------|
| 1 | Direct DOM value + events | Basic HTML forms |
| 2 | Native value setter via `Object.getOwnPropertyDescriptor` | React, Vue, most SPAs |
| 3 | Character-by-char typing (progressive value + input events) | Oracle CX comboboxes (Knockout) |
| 4 | InputEvent per-character (`InputEvent` with `insertText`) | Oracle CX comboboxes, any stubborn input |

## Development Setup

```bash
bash scripts/dev_launch.sh "<oracle-job-url>"
```

Chrome launches on CDP bridge port 9222. Extension loaded automatically.

## How to Test

```
1. Clear All Fields → accept dialog
2. Fill All
3. Inspect: what's full? what's empty? what's wrong?
4. Fix the code, reload extension, repeat from step 1
```
