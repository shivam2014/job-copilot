# AGENTS.md — Job Copilot

## Project
Chrome extension (MV3) auto-fills job application forms from resume data + BYO LLM endpoint. Targets Oracle CX (Knockout.js) and similar ATS.

## Quick Commands
```bash
node -c extension/content/content.js          # syntax check
node -c extension/content/form-detector.js    # syntax check
node scripts/test/inspect.mjs                 # inspect tiles + fields
node scripts/test/clear.mjs                   # clear all fields + tiles
node scripts/test/fill.mjs                    # run Fill All + report (polls __jcFilling)
node scripts/test/fill_section.mjs experience # fill one section only (via service worker)
node scripts/test/fill_section.mjs --list     # show available sections
node scripts/test/check_ext_errors.mjs        # read extension errors from chrome://extensions
node scripts/test/trace_combobox_options.mjs --list  # list all comboboxes
node scripts/test/test_skills_section.mjs     # inspect skills section UI
node scripts/test/reload_extension.mjs        # reload ext + refresh page
node scripts/test/reload_extension.mjs --ext-only    # reload ext only (no page refresh)
node scripts/keep_alive.mjs &                 # launch Chrome with extension
```

## Architecture
```
extension/
├── content/content.js       — Panel UI, Fill All, F buttons, learning, CSS injection
├── content/form-detector.js — Field detection, fill routing, Oracle combobox strategies
├── content/content.css      — Styles (also injected via content.js)
├── background/background.js — Service worker: PDF extraction, LLM profile extraction
├── popup/popup.js           — Popup UI (Fill All, Clear All)
├── lib/llm-client.js        — OpenAI-compatible API wrapper
├── lib/token-tracker.js     — LLM token usage recording
└── manifest.json            — Chrome MV3 manifest
scripts/
├── keep_alive.mjs           — Chrome launcher (viewport:null, remote-debugging-port)
├── reload_extension.mjs     — Reload ext + refresh page (Playwright CDP)
├── test/lib.mjs             — Shared: connect(), getVisibleFields(), screenshot()
├── test/inspect.mjs         — List tiles + fields, values, headings
├── test/clear.mjs           — Delete tiles + clear inputs (with timing)
├── test/fill.mjs            — Click Fill All, poll __jcFilling, report
├── test/fill_section.mjs    — Fill one section via service worker message
├── test/check_ext_errors.mjs — Read extension errors from chrome://extensions
├── test/trace_combobox_options.mjs — Inspect combobox dropdown options
├── test/test_skills_section.mjs — Inspect skills section UI structure
└── test/screenshot.mjs      — Take screenshot
```

## 3 Interactions
1. **Fill All** (panel + popup) → fillPersonal + fillExperience + fillEducation + fillSkills + fillAIQuestions + fillApplicationQuestions + fillLearnedRadios
2. **Per-field "F" button** (hover) → fills one field
3. **Clear All** (panel + popup) → double-click confirmation, deletes tiles, clears inputs

## Fill Strategy (form-detector.js)
- **Text inputs**: Paste first (`InputEvent insertFromPaste`), char-by-char fallback
- **Comboboxes**: Click toggle button (`#{id}-toggle-button`) → poll `aria-expanded` → wait for options to render in `#{id}-listbox` → find matching option by text → click. Falls back to paste, then char-by-char. Check toggle button text (Oracle stores value there, not input.value)
- **Selects**: 4-phase matching: exact → startsWith → word-boundary → includes
- **Tiles**: Hover → click Delete button (force click for Oracle React)
- **Real mouse events**: Oracle React ignores synthetic `click()`. Skills suggestions, language pills, education Add, and submit buttons need PointerEvent + mousedown + mouseup + click sequence

## Key Learnings

**Extension Reload (CRITICAL):** chrome://extensions reload button works but you MUST `page.reload()` the target page afterward for new content script to inject. Without it, old code keeps running. Always: reload extension → reload page → wait 8s. Use `reload_extension.mjs` (default: full reload). Only use `--ext-only` for options/popup-only changes.

**Content Script Debugging:** Use numbered `console.log('JC-TRACE: N:description')` to trace execution. Content scripts run in isolated world — `page.evaluate()` can't access their variables. Read storage from service worker or options page instead.
- **CSS injection**: Manifest CSS unreliable after reload. Inject via `<style>` tag in content.js
- **Chrome lifecycle**: Two-process: keep_alive.mjs (owns Chrome) + connect.mjs (connect/disconnect). Never kill Chrome between commands
- **Viewport**: Always `viewport: null` + `--start-maximized`
- **Oracle combobox**: Click toggle button (`#{id}-toggle-button`), not input. Options render in `#{id}-listbox` ~600ms after open. Value in toggle button text, not input.value. `aria-haspopup="grid"`, options are `role="gridcell"` with class `cx-select__list-item`
- **Oracle React buttons**: Synthetic `click()` doesn't work. Use PointerEvent + mousedown + mouseup + click. Applies to: skill suggestions, language pills, education Add, all submit buttons
- **Clear All**: Double-click confirm. Handles tiles (hover→Delete with force click), open forms (Cancel), inputs
- **Overflow**: Oracle uses `overflow:hidden` on ancestors. Override ALL up to body for F button positioning
- **F button**: Inside parent container with `position:absolute; right:-28px`. Combobox offset: `right:40px`
- **Paste fill**: `InputEvent(insertFromPaste)` works for text fields. Comboboxes need toggle button click + option selection
- **Learning system**: Saves on blur (every blur, not just first). Uses generic category keys (`street_address`, `city`, etc.) for cross-portal compatibility. `setFilling()` syncs state to `document.documentElement.dataset.jcFilling` for external polling
- **LLM not configured**: `fillAIQuestions()` early-returns silently. Don't use `console.error` — causes extension error badge

## Session Workflow
1. Launch: `node scripts/keep_alive.mjs &`
2. Inspect: `node scripts/test/inspect.mjs`
3. Clear: `node scripts/test/clear.mjs`
4. Test fields one by one: F button → verify visually → fix if broken
5. Run Fill All at end: `node scripts/test/fill.mjs`
6. Commit after each fix
7. Create handoff doc at session end

## Storage Keys
```
profile_name, profile_email, profile_phone, profile_address, profile_linkedin
llm_base_url, llm_api_key, llm_model
resume_text, resume_full_data (JSON with rawSections)
learned_fields, saved_answers (max 50)
```

## Handoff
See `handoff/HANDOFF-YYYY-MM-DD.md` for current state and next steps.
