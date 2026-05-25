# Job Copilot — Project Handbook

> Living document: current state, session history, known issues, roadmap.
> Update after every session.
> Last updated: 2026-05-25

---

## What Is Job Copilot

Chrome extension (MV3) that auto-fills job application forms using your resume data + an LLM endpoint you bring. Works on Oracle Cloud, Workday, Greenhouse, Lever, iCIMS, etc.

**Core loop:**
1. Upload resume → LLM extracts profile (name, email, phone, skills, experience, etc.)
2. Go to job page → JC detects form fields → fills from profile
3. For custom questions → AI generates answers from resume + job description
4. Learns from your corrections → saves for next time

---

## Current State

### What Works

| Feature | Status |
|---------|--------|
| Resume PDF upload → LLM extraction | ✅ |
| Profile fields (name, email, phone, etc.) auto-fill | ✅ |
| AI-generated answers for custom questions | ✅ |
| Saved Q&A bank (reuse across applications) | ✅ |
| Floating JC button + panel | ✅ |
| SPA form re-detection (MutationObserver) | ✅ |
| Login screen detection (skip auto-fill on login-only pages) | ✅ |
| Learning system (saves user corrections to `learned_fields`) | ✅ |
| Radio/checkbox/select learning | ✅ |
| Clear form with Oracle-specific cleanup | ✅ |
| Oracle pill selector handling (Title, skills, questions) | ✅ |
| Honeypot / framework-internal field filtering | ✅ |
| Weighted scoring for field identification (label ×4, autocomplete ×3, etc.) | ✅ |
| Select priority matching (exact > startsWith > word-boundary > includes) | ✅ |
| LLM config test + status badge | ✅ |
| Token usage tracking | ✅ |
| Learned corrections UI (view/delete individual, clear all) in Settings | ✅ |
| `scripts/reload_extension.mjs` — reload extension via CDP | ✅ |
| Persistent Chrome profile (`.chrome-profile/`) keeps config across launches | ✅ |

### What's Broken / Missing

| Issue | Priority | Details |
|-------|----------|---------|
| Extension deregistered from Chrome | 🔴 HIGH | Was using `chrome.runtime.reload()` which removed it. Need manual reload: `chrome://extensions` → Load unpacked → `extension/` |
| Oracle country combobox rejects `el.value = "Poland"` | 🔴 HIGH | Oracle's custom combobox (`role="combobox"`, `.cx-select-input`) uses internal state. Need to click → open dropdown → select option instead of setting value directly. |
| Phone country-code prefix | 🟡 MED | Profile stores `+33-753788537`. Oracle splits into country code (`+33`) and number (`753788537`). Need split logic in `buildFillMap()`. |
| No retry on fill failure | 🟡 MED | When `fillField()` fails (e.g., combobox), there's no fallback. Need `fillFieldWithRetry()` that tries alternative methods. |
| Field→profile mappings not learned | 🟡 MED | When JC fills `address` with "Gdansk, Poland" successfully, it doesn't remember that mapping for next time. |
| ClearForm → auto-fill re-fill loop | 🟡 MED | 2026-05-25 19:40 UTC | `clearForm()` removes DOM elements → MutationObserver fires → `runSpaReFill()` fills all empty fields back. Fix: `skipAutoFill` flag prevents re-fill for 3s after clearing. |
| Dependent field auto-fill | 🟢 LOW | User fills "country" → should auto-fill state/province, postal code format. |
| SPA section tracking basic | 🟢 LOW | MutationObserver works but doesn't track _which_ sections have been seen. Can re-fill already-filled sections. |
| Nyro endpoint intermittent | 🟡 MED | `http://localhost:19530/v1` was down last session. Need to check before starting. |

---

## Session History

### 2026-05-23: Initial build
**Focus:** Core extension functionality
**Done:**
- Resume PDF upload → LLM extraction pipeline
- JSON parsing with sanitization recovery
- PDF hyperlink extraction
- Settings popup works on chrome:// pages
- Auto-fill personal fields on form detection
- Auto-click "Apply Now" on Oracle
- MutationObserver for SPA re-detection
- Clear All & Reset in Full Resume Data section
- Edit buttons on experience, education, projects, publications
- Skills/languages tag-based add/delete UI
- Config status badge (⚠️/✅/❌)
- Token usage tracking

### 2026-05-24 (session 1): Debug session
**Focus:** Fix issues found via Playwright inspection
**Done:**
- Honeypot classification → `isHoneypot()` in form-detector.js
- Framework internal filtering → `isFrameworkInternal()`
- Duplicate click listeners consolidated into single handler
- Login screen detection → `isLoginScreen()` returns true if only email/unknown fields
- MutationObserver checks `isLoginScreen()` before re-injecting
- CSS injection verified (computed style: `rgb(59, 130, 246)` on button)
- **Verified:** Oracle login screen correctly blocked ("JC: Login-only screen, waiting for application form...")

### 2026-05-24 (session 2): Vision model handoff
**Focus:** Configure settings + test on Oracle
**Done:**
- Documented settings needed: API Base URL `http://localhost:19530/v1`, Key `dummy`, model `deepseek-v4-flash-2`
- Resume PDF path: `~/Documents/Resume/tailored/Honeywell_20260522/Resume_Shivam_Bhalla_Honeywell_20260522.pdf`
- Oracle job URL: `https://icfcjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Aerospace/job/111402`
- Extension ID: `nbpeoddibjhngmomojgpeoiceocnoknn`
- **Blocked:** Model dropdown selection unreliable, PDF upload→text extraction not populating storage, Oracle's 547 shadow roots, fresh temp profiles losing config

### 2026-05-25: Major refactor
**Focus:** Oracle-specific handling, learning system, persistent profile
**Done:**
- `buildFillMap()` — shared fill map builder with name/address parsing
- `skipFieldForType()` — blocks mismatched fills (non-URL into URL, phone into URL, city into street_address, etc.)
- `listenForCorrections()` + `saveLearnedCorrection()` — watches blur on filled fields, saves to `learned_fields`
- `watchFormChanges()` — global watcher: radio, checkbox, select, text input learning
- `fillLearnedRadios()` — applies learned radio answers
- `fillExtras()` — Title (Mr.), skill matching from resume, application questions (default "No")
- `runSpaReFill()` — SPA re-fill of empty fields only
- `clearForm()` — comprehensive: Oracle remove-value buttons, delete buttons, text inputs, pill selectors, combobox inputs, profile items
- Weighted scoring for field identification (label ×4, autocomplete ×3, ariaLabel ×2, name/id ×1)
- Select priority matching (exact > startsWith > word-boundary > includes)
- Oracle label fallback (`.oj-`, `.apply-flow`, `.input-row` selectors)
- Learned corrections UI in Settings (individual delete + clear all)
- Persistent `.chrome-profile/` setup with Bitwarden
- `scripts/dev_launch.sh` convenience script
- `scripts/reload_extension.mjs` for CDP-based reload
- **Issue:** Extension deregistered from Chrome by `chrome.runtime.reload()` call

### 2026-05-25 (session 2): Live co-debugging — ClearForm loop fix
**Focus:** Oracle live debugging session. clearForm() was clearing fields but MutationObserver re-filled them.
**Done:**
- Diagnosed root cause: `clearForm()` dispatches DOM mutations → MutationObserver fires after 2s → `runSpaReFill()` fills empty fields
- Fixed: Added `skipAutoFill` flag set to true after `clearForm()` completes, checked by MutationObserver and initial auto-fill
- `skipAutoFill` resets to false after 3 seconds (allows normal auto-fill on genuine SPA transitions)
- Also guarded the initial auto-fill timeout in `init()`
- Syntax check passed: `node -c extension/content/content.js`
- **Known:** Country combobox still rejects value (jcFilled=true, jcValue=Poland, but actual value is empty). Phone splitting not yet implemented.

---

## Known Issues (Detailed)

### 1. Oracle country combobox
**Symptom:** `el.value = "Poland"` doesn't work on Oracle's custom combobox.
**Root cause:** Oracle uses `<input role="combobox">` with `.cx-select-input` class. It has internal state that ignores direct value setting.
**Fix strategy (not yet implemented):**
1. Detect: `el.getAttribute('role') === 'combobox'` OR `el.closest('.cx-select')` exists
2. Click the combobox to open dropdown
3. Find `.cx-select-option` matching value (exact > startsWith > includes)
4. Click matching option
5. Dispatch `input` + `change` events

### 2. Phone number splitting
**Symptom:** Profile `+33-753788537` gets filled whole into the first phone field. Oracle splits into country code + number.
**Fix strategy (not yet implemented):**
- In `buildFillMap()`, add `phone_country_code` (extract before `-`) and `phone_number` (extract after `-`)
- In `fillPersonal()`, detect fields named `phone_country_code` or labeled "country code" and fill with split value

### 3. Extension not loaded
**Fix:** Open `chrome://extensions` → Enable Developer mode → Load unpacked → select `extension/` folder. Or run `node scripts/reload_extension.mjs`.

### 4. Nyro endpoint
Check if Nyro is running: `curl http://localhost:19530/v1/models`

---

## Profile Data (stored in chrome.storage.sync)

| Field | Value |
|-------|-------|
| profile_name | Shivam Bhalla |
| profile_email | shivam.bhalla07@gmail.com |
| profile_phone | +33-753788537 |
| profile_address | Gdansk, Poland |
| profile_work_authorization | (not set) |
| resume_full_data | 6 sections (experience, education, skills, languages, projects, publications) |
| llm_base_url | http://localhost:19530/v1 |
| llm_model | deepseek-v4-flash-2 |

---

## Roadmap

### Phase 1: Fix Oracle-Specific Issues
- [ ] Oracle combobox handler (`isOracleCombobox()`, `fillOracleCombobox()`) in form-detector.js
- [ ] Phone number splitting (`phone_country_code`, `phone_number`) in content.js
- [ ] Oracle combobox selectors (`.cx-select`, `.cx-select-container`) in `identify()`

### Phase 2: Make Auto-Fill Smarter
- [ ] Smarter SPA section detection (track detected sections in a Set)
- [ ] Auto-fill retry with fallback (`fillFieldWithRetry()`)
- [ ] Field→profile learning from successful fills
- [ ] Watch mode: user fills country → auto-fill dependent fields

### Phase 3: Live Co-Debugging Sessions
- [ ] Run live session on Oracle job page
- [ ] Iterate on combobox, phone, and other Oracle-specific issues
- [ ] Test end-to-end: launch → navigate → fill → verify

---

## How to Start a Session

1. **You:** Launch Chrome with extension: `bash scripts/dev_launch.sh`
2. **You:** Navigate to Oracle job URL, login with Bitwarden if needed, reach the application form
3. **You:** Tell me "I'm at the form" or describe what's happening
4. **Me:** Connect via codex-chrome or guide you through console snippets
5. **Together:** Debug, fix, test, iterate
6. **End:** I update this handbook with results
