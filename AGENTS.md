# AGENTS.md — Job Copilot

Chrome extension (MV3) autofills job apps from resume + BYO LLM. Targets Oracle CX (Knockout.js).

## Commands
```bash
node scripts/keep_alive.mjs &                  # launch Chrome + ext
node scripts/test/inspect.mjs                  # inspect page fields
node scripts/test/clear.mjs                    # clear tiles + fields
node scripts/test/fill.mjs                     # Fill All + report
node scripts/test/fill_section.mjs experience  # fill one section
node scripts/test/reload_extension.mjs         # reload ext + page
node scripts/test/dump-storage.mjs             # read storage values
node scripts/test/check_ext_errors.mjs         # read ext errors
node scripts/test/fill-verify-cycle.mjs        # expected vs actual
node -c extension/content/content.js           # syntax check
node -c extension/content/form-detector.js     # syntax check
```

## Files
| File | Purpose |
|------|---------|
| `content/content.js` | Panel UI, F buttons, Fill All, learning |
| `content/form-detector.js` | Field detection, fill routing, Oracle strategies |
| `background/background.js` | PDF + LLM profile extraction |
| `lib/llm-client.js` | OpenAI-compatible API wrapper |
| `popup/popup.js` | Popup Fill All / Clear All |
| `manifest.json` | MV3 manifest |

External: `cdc` (`~/tools/chrome-cdp/`) — Chrome DevTools CLI.

## Fill Strategy
- **Text**: Paste via `InputEvent insertFromPaste` → char-by-char fallback
- **Oracle combobox**: Click `#{id}-toggle-button` → poll `aria-expanded` → match option in `#{id}-listbox` → click. Value in toggle button text, NOT input.value.
- **Oracle typeahead**: Type prefix → poll options → match → click. For comboboxes where toggle doesn't open dropdown (e.g., postalCode).
- **Selects**: 3-phase match: exact → word-boundary → startsWith
- **Oracle React buttons**: `click()` ignored. Use PointerEvent + mousedown + mouseup + click.
- **Tiles**: Hover → click Delete (force click for Oracle React)

## Fill All Order
`fillPersonal` → `fillExperience` → `fillEducation` → `fillSkills` → `fillAIQuestions` → `fillApplicationQuestions` → `fillLearnedRadios`

## Pitfalls
- **Extension reload**: MUST `page.reload()` after ext reload. Old content script stays.
- **F button clicks**: `page.evaluate()` can't trigger content script handlers. Use Playwright `page.click()`.
- **Overflow**: Oracle uses `overflow:hidden`. Override all ancestors for F button positioning.
- **cdc ext-errors**: Close `chrome://extensions` tab in `finally` block.
- **`console.error`**: Don't use in content script — causes ext error badge.
- **Two-process**: `keep_alive.mjs` owns Chrome. Don't kill between commands.

## Never
- Modify `manifest.json` permissions w/o ask
- Change fill strategies w/o testing on real Oracle page
- Add dependencies w/o discussion
- Kill Chrome between commands

## Session Workflow
1. `node scripts/keep_alive.mjs &`
2. `node scripts/test/dump-storage.mjs` — check profile data
3. Navigate to Oracle apply page
4. `node scripts/test/inspect.mjs` — study fields
5. `node scripts/test/clear.mjs` — start clean
6. `node scripts/test/fill_section.mjs <name>` — test one section
7. Verify via inspect / screenshot
8. Fix → reload → verify loop
9. `node scripts/test/fill.mjs` — final full run
10. Commit after each fix

## Oracle Test Page
Job #111402 — Aerospace Careers on Oracle CX Cloud.
```
Apply: https://icfcjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Aerospace/job/111402/apply/section/1
Base: https://icfcjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Aerospace/job/111402
```

## Fixes Applied This Session

### form-detector.js
- **`fillTextInput()`** — Added non-Oracle strategies: direct DOM assignment + native prototype setter. Previously only Oracle CX had working strategies; Workday/Greenhouse/generic forms fell through to "ALL strategies failed".
- **Field patterns** — Added `'address line 1'`, `'addressline1'` to street_address; `'address line 2'` to street_address2; `'address line 3'`, `'addressline3'` to apt_number; `'region1'`, `'region2'` to state. These fix identification of Oracle CX address fields.
- **`identify()`** — Added context-aware routing override: if `fieldName === 'address'` and autocomplete/label matches `address-line1`/`-line2`/`-line3`, routes to `street_address`/`street_address2`/`apt_number`.
- **`isOracleCXField()`** — Static function added next to `isOracleCombobox`. Needed by the non-Oracle fill strategies.
- **`fillOracleCombobox()`** — Strategy 2 confirmation no longer requires non-empty toggleText (Oracle icon-only toggles have `textContent === ""`).

### content.js
- **`fillPersonal()`** — Added fill-order sorting: text inputs priority 0, comboboxes 1, selects 2. Prevents Oracle country/state re-render from invalidating text field references.
- **`fillPersonal()`** — Added re-detection pass after main fill loop. Oracle CX re-renders address sections when country changes, clearing already-filled fields. Re-detects and re-fills any cleared fields.
- **`buildFillMap()`** — Fixed `parseAddr2` extraction for addressLine2. Added postal code detection (numeric trailing parts used as postal_code, not country). Added `street_address_2`, `apt_number` to return.
- **`fieldCategoryMap`** — Added `'address' → street_address`, `'region1' → state`, `'addressline1/2/3'` mappings. Removed harmful `'apt_number' → street_address` mapping. Fixed `'street_address2' → street_address_2`.
- **`fillSkills()`** — Added visibility check (`offsetHeight > 0 && offsetParent !== null`) before clicking "Add More Skills" button. Fixed bug where only 1 skill was added (hidden button on iteration 2+ was no-op).
- **`fillLanguages()`** — Added to `jc_fill_all` message handler (was only in panel button handler).
- **`fillLicenses()`** — Created new function following `fillLanguages` pattern. Handles Oracle "Add License" → combobox → submit flow. Added to Fill All sequence.
- **`attachGlobalLearning()`** — Added `el.dataset.jcFilled === 'true'` guard in blur handler. Previously saved any JC-filled field as "learned", causing accumulated data pollution across sessions.

### Results
- Personal/address fields: **10→14 filled** (addressLine1, addressLine2, city, region2 now fill correctly)
- Skills: **1→15** added per fill (was limited by hidden button bug)
- Extension errors: **2→0** (TDZ bug was stale V8 code cache)
- Country: Now uses resume-extracted value over learned pollution
- Fill All reliably fills personal info, address, skills, links, languages, education
