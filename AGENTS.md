# AGENTS.md instructions for /Users/shivam94/job-copilot

<INSTRUCTIONS>
Always load $feynman-workflow from ~/.codex/skills/feynman-workflow as the default workflow for every task.

## Commands

@/Users/shivam94/.codex/RTK.md

<!-- codex-plusplus:co.Arconte112.followup:start -->
## TWEAKS: Codex Follow-up

Always include a Follow-up payload at the end of every final assistant response.

Generate exactly 4 follow-up items by default. Use 5 only when the context clearly has more high-value continuations.

Prioritize usefulness over variety. Every item must be grounded in the current conversation, user intent, visible work, files, decisions, blockers, people, projects, dates, money, or risks.

Each item should be one of:
- a concrete next action the user can ask Codex to perform
- a verification step that confirms the work actually succeeded
- an unresolved decision or tradeoff worth resolving
- a context-aware continuation that saves the user effort

Avoid generic filler such as "Let me know if you need anything else", "Review the changes", "Ask another question", or broad suggestions that could apply to any conversation.

Each item needs only `prompt`: a concise, specific instruction that can be inserted into the composer and sent directly.

The prompt should be short enough to scan in the Follow-up panel, but specific enough to tell Codex exactly what to do next.

For very small or factual answers, still produce 4 items, but make them practical: clarify, verify, apply, compare, summarize, or continue from the user's likely intent.

Keep the main answer focused. Put follow-up-only information only in the Follow-up payload, not repeated in the visible prose.

## LOCKED TWEAK FORMAT: Codex Follow-up

Do not edit or remove this locked section manually. It is required by the Codex++ Follow-up tweak.

For every final assistant response, append exactly one fenced JSON block at the very end. Do not emit this payload in reasoning, progress updates, tool logs, drafts, or intermediate messages.

The visible answer must not repeat information that is meant only for Follow-up. If a detail belongs in Follow-up, put it only in the payload.

Required payload format:

```json
{
  "codex_follow_up": true,
  "title": "Follow-up",
  "items": [
    {
      "prompt": "Specific follow-up instruction the user can click and send"
    }
  ]
}
```

Rules: always emit the JSON block in final assistant responses; use 1 to 5 items; each prompt must be concise and useful; do not explain that the JSON exists.
<!-- codex-plusplus:co.Arconte112.followup:end -->

--- project-doc ---

# AGENTS.md instructions for /Users/shivam94/job-copilot

@FILETREE.md

@/Users/shivam94/.codex/RTK.md

## Project

Chrome extension (MV3) that auto-fills job application forms from resume data + a bring-your-own LLM endpoint. Targets Oracle CX (Knockout.js) and similar ATS platforms.

## Architecture

- `extension/content/content.js` — Panel UI, Fill All, per-field "F" buttons, learning system, SPA observer, CSS injection via `<style>` tag
- `extension/content/form-detector.js` — Field detection (patterns + scoring), fill routing, Oracle combobox 4-strategy chain with `.cx-select__list-item` selectors
- `extension/content/content.css` — Panel + per-field button styles (also injected via content.js)
- `extension/background/background.js` — Service worker: PDF extraction, LLM profile extraction, options page opener
- `extension/popup/popup.js` — Popup UI (Fill All, Clear All, field counts)
- `extension/options/options.js` — Settings page: AI config, resume upload, profile editor, learned corrections
- `extension/lib/llm-client.js` — OpenAI-compatible API wrapper
- `extension/lib/token-tracker.js` — LLM token usage recording
- `extension/manifest.json` — Chrome MV3 manifest
- `scripts/keep_alive.mjs` — Chrome launcher with extension, viewport:null, remote-debugging-port
- `scripts/test/` — Reusable Playwright test scripts (inspect, clear, fill, screenshot, lib)

## 3 Interactions

1. **Fill All** (panel + popup) → fillPersonal + fillExperience + fillEducation + fillSkills + fillAIQuestions + fillApplicationQuestions + fillLearnedRadios
2. **Per-field "F" button** (hover) → fills one field (textarea→LLM, others→profile)
3. **Clear All** (panel + popup) → double-click confirmation, deletes tiles, clears inputs

No auto-fill on page load. User clicks when ready.

## Quick Commands

```bash
node -c extension/content/content.js          # syntax check
node -c extension/content/form-detector.js    # syntax check
bash scripts/dev_launch.sh                    # launch Chrome with extension
python3 ~/.codex/skills/filetree/scripts/filetree.py lint  # check FILETREE.md drift
node scripts/test/inspect.mjs                 # inspect current form state
node scripts/test/clear.mjs                   # clear all fields + tiles
node scripts/test/fill.mjs                    # run Fill All and report
```

## Key Learnings

- **CSS injection**: Manifest CSS sometimes doesn't inject after extension reload. Inject CSS via `<style>` tag in content.js instead.
- **Chrome lifecycle**: Use two-process architecture — keep_alive.mjs launches Chrome, connect.mjs inspects. Chrome stays alive between inspector runs.
- **Viewport**: Always use `viewport: null` + `--start-maximized` for proper resize behavior.
- **Extension reload**: Reload via chrome://extensions → click reload button. NEVER touch devMode toggle.
- **Oracle combobox**: Options are `.cx-select__list-item` inside `.cx-select__list`. Value stored in toggle button text, not input.value.
- **Clear All**: Uses double-click confirmation (first click shows message, second clears). Handles tiles, open forms, and input fields.
- **Paste fill**: `InputEvent(insertFromPaste)` works for text fields. Comboboxes need dropdown click approach.

## Session Workflow

1. Launch Chrome: `node scripts/keep_alive.mjs` (background)
2. Connect: `node scripts/test/inspect.mjs` (verify state)
3. Test fields one by one: click F button → verify visually → fix if broken
4. Run Fill All at end to verify everything works together
5. Commit changes after each successful fix

## Handoff

Always create/update `handoff/HANDOFF-YYYY-MM-DD.md` at end of session.
