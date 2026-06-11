# Session Handoff — 2026-06-06

## Session Goal
Fix autofill bugs in job-copilot extension for Oracle CX job applications. Prioritized in order.

---

## Orchestrator/Worker Protocol (MANDATORY)

### Orchestrator Role
- **DO**: Break bugs into single-function tasks. Write delegation specs. Validate returns. Synthesize.
- **DO NOT**: Write code, read implementation files, or debug. You are NOT a worker.
- **If tempted to write code**: Stop. Create a worker task instead.
- **Flow**: Plan → Delegate → Validate → Integrate. Repeat for each bug.

### Worker Role
- **DO**: Receive one function/file task. Implement it. Run syntax check. Return code.
- **DO NOT**: Analyze other bugs, change scope, spawn sub-agents, or suggest architectural changes.
- **If tempted to extend scope**: Stop. Return what was asked. The orchestrator decides next steps.
- **Flow**: Read spec → Read target file → Edit → Syntax check → Return.

### Escalation Rule
- Worker fails 2x on same task → DO NOT retry. Return "BLOCKED: reason" to orchestrator.
- Orchestrator blocked → Pause. Search for alternative approach. Do not brute-force.

---

## Current State

### Committed
- `cdc layout` improvements: full-page scan, Form Fields section, `--show-empty` flag
- Comprehensive audit document: `handoff/AUDIT-2026-06-06.md`

### Uncommitted (in working tree)
- `extension/content/form-detector.js`: JC-TRACE logging + partial Bug #1 fix (aria-expanded check for combobox confirmation)

### Test Scripts Created
- `scripts/test/dump-storage.mjs` — dump all extension storage
- `scripts/test/dump-full-storage.mjs` — full resume data structure
- `scripts/test/dump-raw.mjs` — rawSections content
- `scripts/test/test-combobox-confirmation.mjs` — test combobox fill with trace
- `scripts/test/fill-all-monitor.mjs` — monitor Fill All with field snapshots

---

## Bug Task Queue (Priority Order)

### Task 1: Fix combobox confirmation (Bug #1)
**File:** `extension/content/form-detector.js`
**What:** `fillOracleCombobox()` — after typeahead finds and clicks a match, the code checks `el.value` and toggle text. Oracle doesn't set either after typeahead click, so confirmation fails. Partial fix already applied (added `aria-expanded === 'false'` check in two places — lines ~656 and ~707). **Needs testing.**
**Test:** Open Oracle page. Use `cdc layout` to find country combobox. Fill it with "Poland". Check if value is confirmed (not falling through to paste/char-by-char).
**Worker spec:**
```
FUNCTION: fillOracleCombobox — fix typeahead confirmation
FILE: extension/content/form-detector.js
INPUTS: el (DOM element), value (string)
OUTPUT: boolean (true if fill succeeded)
BEHAVIOR: After clicking a typeahead-matched option, verify success by checking aria-expanded changed to false. If match was clicked AND dropdown closed, treat as success. Return true.
CURRENT STATE: Line ~707 has aria-expanded check added but untested.
TEST: cdc fill oracle country Poland → verify value="Poland" in Form Fields
```

### Task 2: Clear learned-field pollution (Bug #8)
**File:** Extension storage (no code change — data cleanup)
**What:** `learned_fields.street_address = "Bhalla"` and `learned_fields.street_address2 = "91"` are polluting every fill. The street extracted data is empty, so addressLine1 should stay empty.
**Fix:** Delete those two keys from `chrome.storage.sync` via service worker eval.
**Test:** Run Fill All → verify addressLine1 and addressLine2 are empty (not "Bhalla"/"91").

### Task 3: Fix experience "No Add Experience trigger" (Bug #5)
**File:** `extension/content/content.js` — `fillExperience()` function
**What:** Only 1 experience entry added. Log says "No Add Experience trigger found — skipping" after first entry. Resume has 3 experience entries in rawSections. Need to investigate trigger detection logic.
**Worker spec:**
```
FUNCTION: fillExperience — fix "Add Experience" trigger detection
FILE: extension/content/content.js
INPUTS: Reads rawSections.experience from storage
OUTPUT: Fills all experience entries
BEHAVIOR: After submitting one experience entry, the "Add Experience" button should appear again to add the next one. Current code can't find the trigger after first submission.
DEPENDENCY: Requires Task 1 (combobox confirmation) to work first, otherwise date/country comboboxes will fail.
```

### Task 4: Fix education level dropdown mapping (Bug #3)
**File:** `extension/content/content.js` — `fillEducation()` or degreeMap
**What:** "Masters Degree" doesn't match Oracle's actual dropdown options. The typeahead found 2 options but "no match". Need to check actual Oracle options with `cdc options` and add to degreeMap.
**Worker spec:**
```
FUNCTION: Add education level mapping
FILE: extension/content/content.js
INPUTS: Education level strings from rawSections
OUTPUT: Correctly mapped Oracle dropdown option
BEHAVIOR: Before filling educationLevel combobox, map strings like "Masters of Science" → Oracle's actual text. Use cdc options to discover actual dropdown values.
```

### Task 5: Fix education date fields (Bug #4)
**File:** `extension/content/content.js` — `fillEducation()` date handling
**What:** Education start/end month/year remain empty. Comboboxes not filling.
**Worker spec:**
```
FUNCTION: Fix education date field filling
FILE: extension/content/content.js (fillEducation)
INPUTS: education[].start_date, end_date (format "MM/YYYY")
OUTPUT: Fills month/year comboboxes for each education entry
BEHAVIOR: Split dates into month/year. Fill month combobox with month name (e.g., "September") and year combobox with year (e.g., "2016").
```

### Task 6: Fix skills typeahead match (Bug #6)
**File:** `extension/content/form-detector.js`
**What:** "GUI" matched "Strategic Guidance" via typeahead. `startsWith` matching in listbox options is too loose. Should prefer exact or word-boundary match.
**Worker spec:**
```
FUNCTION: Fix typeahead option matching in findMatch
FILE: extension/content/form-detector.js
INPUTS: Listbox option elements, target value string
OUTPUT: Best matching option element or null
BEHAVIOR: Change priority: exact match first, then word-boundary, only then startsWith. Prevents "GUI" matching "Strategic Guidance".
```

### Task 7: Fix ISAE-SUPAERO school fallback (Bug #7)
**File:** `extension/content/content.js` — `fillEducation()` school handling
**What:** ISAE-SUPAERO not in Oracle school dropdown. Typeahead found 0 options. Needs fallback to type full name as text input and accept without dropdown confirmation.
**Worker spec:**
```
FUNCTION: Add school name fallback for missing dropdown options
FILE: extension/content/content.js (fillEducation)
INPUTS: School name string
OUTPUT: School field filled
BEHAVIOR: If school combobox typeahead returns 0 options, fall back to filling as plain text input and submitting without dropdown selection.
```

---

## Worker Spawning Templates

### For code changes:
```
Task(subagent_type="worker",
     isolation="none",
     prompt="FUNCTION: <function name>\nFILE: <path>\nINPUTS: ...\nOUTPUT: ...\nBEHAVIOR: ...\nTEST: ...\nSYNTAX_CHECK: node -c extension/content/form-detector.js")
```

### For data cleanup (no code change):
```
Task(subagent_type="worker",
     isolation="none",
     prompt="TASK: Clear learned field\nFILE: chrome.storage.sync\nSTEPS:\n1. Connect to CDP port 9222 via Playwright\n2. Access service worker context\n3. Run: chrome.storage.sync.get('learned_fields', d => {... delete d.street_address ... chrome.storage.sync.set({learned_fields: d})})\n4. Verify deletion")
```

---

## Validation Gates (after each worker)

1. Syntax check: `node -c extension/content/content.js` or `node -c extension/content/form-detector.js`
2. Test on ONE specific field (not Fill All): use `cdc fill` or click F button for that field
3. Verify with `cdc layout oracle --show-empty` to check field value
4. If pass: commit. If fail: debug or escalate.

---

## Key Commands

```bash
# Launch Chrome
node scripts/keep_alive.mjs &

# Check page state
cd ~/tools/chrome-cdp && cdc layout oracle

# Test ONE field fill
cd ~/tools/chrome-cdp && cdc fill oracle country Poland

# Clear fields
cd ~/tools/chrome-cdp && cdc eval oracle "
for (const f of document.querySelectorAll('input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), textarea, select')) {
  if (f.offsetParent && f.value) { f.value=''; f.dispatchEvent(new Event('input',{bubbles:true})); }
}"

# Run Fill All and monitor
node scripts/test/fill-all-monitor.mjs

# Syntax check
node -c extension/content/content.js
node -c extension/content/form-detector.js
```
