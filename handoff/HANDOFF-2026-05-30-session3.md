# Handoff — 2026-05-30 (Session 3)

## Session Focus
Fix all remaining autofill bugs, add learning system, improve settings UI, optimize fill speed.

## What Was Done

### Bug Fixes (7 total)

**Fix 1: Oracle CX combobox toggle button click** ✅
- `fillOracleCombobox()` clicks toggle button (`#{id}-toggle-button`), not input element
- Added `cx-select-container` and `cx-select-input` to `isOracleCombobox()`
- Added wait for options to render after dropdown opens (options appear ~600ms, not at `aria-expanded` time)
- **Result:** All comboboxes (dates, country, school, degree, level, language) fill correctly

**Fix 2: Skills suggestion buttons — real mouse events** ✅
- Oracle React ignores synthetic `click()`
- Uses `PointerEvent` + `mousedown` + `mouseup` + `click`

**Fix 3: Skills "Add More Skills" path** ✅
- Combobox selector: `[name="contentItemId"]` → `[name="skills"]`
- Submit button text: `"Add More Skills"` → `"Add Skill"`
- Real mouse events for trigger and submit

**Fix 4: Combobox paste verification** ✅
- Paste now checks toggle button text, not just `el.value`
- Falls through to char-by-char when toggle is empty

**Fix 5: Education degree mapping** ✅
- `degreeMap`: "Bachelor of Technology" → "Bachelor of Engineering" (Oracle's actual option)
- Added "bachelors" and "masters" mappings

**Fix 6: Language fill** ✅
- Fixed combobox options render wait (was missing, options load ~600ms after dropdown opens)
- Real mouse events for proficiency pill buttons
- Real mouse events for submit button

**Fix 7: LLM error suppression** ✅
- `fillAIQuestions()` early-returns when no LLM configured
- Changed `console.error` to `console.log` to avoid error badge

### Learning System (cross-portal)

- `attachGlobalLearning()` captures ALL field edits (not just extension-filled ones)
- Saves on every blur (not just first) — corrections always win
- `fieldCategoryMap`: maps portal-specific field names to generic categories
  - Oracle `addressLine1` → `street_address`, Workday `streetAddress` → `street_address`
  - Covers: address, city, state, postal code, country, phone, email, name, links
- `saveLearnedCorrection()` saves under both portal-specific key AND generic category
- `buildFillMap()` merges learned_fields with category fallback
- Stable storage keys: uses `field.name` (not `el.id` which is dynamic)
- Fixed stale `countryCode-147` entry from previous session

### Settings UI

- Merged "Saved Answers" into "Learned Data" section (was two separate sections)
- Field Values + AI Answers shown together with section headers
- `✏️` pencil + `✕` delete icons matching Experience card layout
- Inline edit with Save/Cancel for field corrections
- "Clear All" clears both `learned_fields` and `saved_answers`
- Updated description: "Works across all portals (Oracle, Workday, Greenhouse)"
- Added `.rd-card-edit` CSS class with hover state

### Popup Fix

- Settings and Refresh buttons attach BEFORE ping check (were after early `return`)
- "Loading... try refreshing the page" no longer blocks Settings/Refresh buttons
- Reload with page refresh by default (`--ext-only` for options-only changes)

### Speed Optimizations

| Component | Before | After |
|---|---|---|
| Experience entry | 5.4s | 3.7s |
| Form open wait | 1500ms fixed | 300ms + poll |
| Submit wait | 2000ms | 500ms |
| Combobox fill | ~400ms | ~355ms + option wait |

### New Test Scripts

| Script | Purpose |
|---|---|
| `scripts/test/fill_section.mjs` | Fill individual sections via service worker |
| `scripts/test/check_ext_errors.mjs` | Read extension errors from chrome://extensions |
| `scripts/test/trace_combobox_options.mjs` | Inspect combobox dropdown options |
| `scripts/test/test_skills_section.mjs` | Inspect skills section UI |

### Infrastructure

- `setFilling()` helper syncs fill state to `document.documentElement.dataset.jcFilling` for external polling
- `inspect.mjs` now reports tile content first, then form fields
- `fill.mjs` polls `dataset.jcFilling` instead of fixed 10s wait (timeout: 180s)
- `clear.mjs` with timing, force click for delete buttons, stale element handling
- `reload_extension.mjs` rewritten with Playwright CDP

## Verified Working

- 3 experience entries with dates and companies ✅
- 2 education entries (Master of Science + Bachelor of Engineering) ✅
- 15+ skills (suggestions + custom) ✅
- 4 languages (English, Hindi, French, German) ✅
- 8 application questions answered "No" ✅
- No extension errors ✅

## Known Remaining Issues

- `postalCode`, `region2`, `addressLine1/2/3` empty — no profile data in settings
- Fill All total time ~90-120s (28 skills × 2.7s each = ~75s for skills alone)
- `educationalEstablishment` and `educationLevel` use char-by-char fallback (Oracle dropdown doesn't have exact matches for all schools/levels)
- Vision model (`mimo-v2.5-vision`) times out on screenshots — separate issue to debug

## Files Changed

| File | Changes |
|---|---|
| `extension/content/form-detector.js` | Toggle click, option render wait, paste verification, timing |
| `extension/content/content.js` | Real mouse events, degreeMap, LLM exit, setFilling, learning system, timing |
| `extension/options/options.html` | Merged Learned Data section |
| `extension/options/options.js` | Inline edit, pencil+cross icons, answer-delete handler |
| `extension/options/options.css` | `.rd-card-edit` styles |
| `extension/popup/popup.js` | Button handlers before ping check |
| `scripts/test/fill_section.mjs` | New: per-section fill via service worker |
| `scripts/test/check_ext_errors.mjs` | New: extension error reader |
| `scripts/test/trace_combobox_options.mjs` | New: combobox option inspector |
| `scripts/test/test_skills_section.mjs` | New: skills section inspector |
| `scripts/test/inspect.mjs` | Added tile content reporting |
| `scripts/test/clear.mjs` | Force click, timing, stale element handling |
| `scripts/test/fill.mjs` | Poll dataset.jcFilling, 180s timeout |
| `scripts/reload_extension.mjs` | Rewritten with Playwright CDP |
| `AGENTS.md` | Updated scripts list and key learnings |
