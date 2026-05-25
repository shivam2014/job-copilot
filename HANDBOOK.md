# Handbook — Job Copilot

> Current state, known blockers, and what comes next.
> Last updated: 2026-05-25

## Core Loop

Chrome extension (MV3) that auto-fills job application forms from resume data + an LLM endpoint you bring. Upload resume → JC extracts profile → fills forms → learns from corrections.

## Current Status

### Known Blockers (next session)

| Issue | Why It's Stuck |
|-------|----------------|
| **Oracle `firstName`/`lastName` not filled** | `fillPersonal()` detects 8 personal fields, fills `fullName` and phone, but `firstName`/`lastName`/`email` stay empty. Likely `identify()` mapping or `fillMap` mismatch — needs isolated-world debugging. |
| **Knockout forms resist CDP** | Oracle uses Knockout.js observables. Setting `el.value` or `el.checked` doesn't update observables. "Next" and "Verify" buttons throw "Uncaught". User has to click these manually. |
| **`fillOracleCombobox()` untested** | Code written (click-to-open-dropdown) but never tested on live Oracle combobox because we couldn't get past the Knockout email form. |
| **Phone splitting not implemented** | `phone_country_code` patterns added to `form-detector.js` but `buildFillMap()` doesn't split `+33-753788537` yet. |
| **Bridge crashes under load** | `scripts/launch_with_ext.mjs` pipe bridge is fragile — Oracle SPA console flood kills it (`Runtime.enable` times out). Workaround: create new tab with console suppression + navigate. |

### What Works
- Extension loads via `--remote-debugging-pipe` + `Extensions.loadUnpacked`
- JC button appears on Oracle form, Fill All fills `fullName`, phone, skills
- Panel doesn't minimize during fill/clear (fixed)
- Error messages clickable (opens settings)
- `cdp.mjs` works for non-SPA pages

## Quick Reference

```bash
# Launch Chrome with JC
bash scripts/dev_launch.sh

# After launch, sync CDP tool:
# File at ~/Library/Application Support/Google/Chrome/DevToolsActivePort
# Format: 9222\n/devtools/browser

# CDP tool (installed via pi install)
scripts/cdp.mjs list
scripts/cdp.mjs eval <target> "expression"
scripts/cdp.mjs click <target> "selector"
scripts/cdp.mjs nav <target> "url"

# Oracle URL
https://icfcjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Aerospace/job/111402

# Extension ID
nbpeoddibjhngmomojgpeoiceocnoknn

# Oracle SPA CDP workaround (new tab with console suppression):
# 1. Target.createTarget about:blank
# 2. Runtime.enable + Page.enable
# 3. Page.addScriptToEvaluateOnNewDocument suppress console
# 4. Page.navigate to Oracle URL
# 5. Wait 15s, then Runtime.evaluate
```

## Notes for Next Session

- `FormDetector` is in MV3 isolated world — not accessible from `Runtime.evaluate` (main world). To debug: use `chrome.scripting.executeScript` or log from within content script.
- Profile data IS stored (name, email, phone in `chrome.storage.sync`). Resume was extracted ("✅ Already extracted from PDF" shown).
- Raw `resume_text` NOT stored — only structured profile fields. So "Fill AI Questions" shows "No resume uploaded."
- `handoff/HANDOFF-2026-05-25.md` has full session dump.
