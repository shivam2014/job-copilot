# AGENTS.md instructions for /Users/shivam94/job-copilot

@FILETREE.md

@/Users/shivam94/.codex/RTK.md

## Project

Chrome extension (MV3) that auto-fills job application forms from resume data + a bring-your-own LLM endpoint. Targets Oracle CX (Knockout.js) and similar ATS platforms.

## Architecture

- `extension/content/content.js` — Panel UI, Fill All, per-field "F" buttons, learning system, SPA observer
- `extension/content/form-detector.js` — Field detection (patterns + scoring), fill routing, Oracle combobox 4-strategy chain
- `extension/content/content.css` — Panel + per-field button styles
- `extension/background/background.js` — Service worker: PDF extraction, LLM profile extraction, options page opener
- `extension/popup/popup.js` — Popup UI (Fill All, Clear All, field counts)
- `extension/options/options.js` — Settings page: AI config, resume upload, profile editor, learned corrections
- `extension/lib/llm-client.js` — OpenAI-compatible API wrapper
- `extension/lib/token-tracker.js` — LLM token usage recording
- `extension/manifest.json` — Chrome MV3 manifest

## 3 Interactions

1. **Fill All** (panel + popup) → fillPersonal + fillAIQuestions + fillLearnedRadios
2. **Per-field "F" button** (hover) → fills one field (textarea→LLM, others→profile)
3. **Clear All** (panel + popup) → clears everything

No auto-fill on page load. User clicks when ready.

## Quick Commands

```bash
node -c extension/content/content.js          # syntax check
node -c extension/content/form-detector.js    # syntax check
bash scripts/dev_launch.sh                    # launch Chrome with extension
python3 ~/.codex/skills/filetree/scripts/filetree.py lint  # check FILETREE.md drift
```
