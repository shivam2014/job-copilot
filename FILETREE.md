# Project Filetree

_Auto-maintained by `/filetree:update`. Each entry carries a content hash; mismatched hashes indicate stale summaries._

## (root)/

- `.gitignore` — Git ignore rules for node_modules, .chrome-profile, .reasonix, and test artifacts <!--hash:929fe5d4-->
- `AGENTS.md` — Agent contract: project map reference, architecture overview, quick commands <!--hash:3fedaf00-->
- `ARCHITECTURE_VISUAL.html` — Visual architecture diagram of extension components and data flow <!--hash:2ce06526-->
- `LICENSE` — MIT license file for the Job Copilot project <!--hash:3f202a39-->
- `README.md` — Project readme with installation instructions and feature overview <!--hash:6d9c9faa-->
- `package.json` — Node.js package config with Playwright dev dependency <!--hash:259dc9dc-->
- `test_extract.py` — Python script for resume text extraction and profile parsing <!--hash:b4e3f9da-->

## docs/

- `index.html` — CDC CLI documentation site with command reference and architecture overview <!--hash:2ce06526-->
- `research.md` — Research notes on Oracle CX form patterns and Knockout.js behavior <!--hash:f1f29311-->

## extension/

- `manifest.json` — Chrome MV3 manifest: permissions, content scripts, background worker <!--hash:35c23157-->

## extension/background/

- `background.js` — Service worker: PDF text extraction, LLM profile extraction, options page opener <!--hash:310c0031-->

## extension/content/

- `content.css` — Styles for floating JC button, panel, stats, and per-field fill buttons <!--hash:009ed7a1-->
- `content.js` — Panel UI, Fill All, per-field buttons, learning system, SPA observer <!--hash:ebe70c2c-->
- `form-detector.js` — Field detection patterns, fill routing, Oracle combobox 4-strategy chain <!--hash:b6333054-->
- `form-detector.js.bak2` — Backup of form-detector.js from before simplification <!--hash:d2362fc1-->

## extension/lib/

- `llm-client.js` — OpenAI-compatible API wrapper for chat and field extraction <!--hash:c088d4bb-->
- `pdf-extract.js` — PDF text and hyperlink extraction using pdf.js for options page <!--hash:bed16398-->
- `token-tracker.js` — Records LLM token consumption per model with history and summary <!--hash:487138ec-->

## extension/lib/pdfjs/

- `pdf.min.mjs` — Bundled pdf.js library for PDF parsing in browser <!--hash:5822350b-->
- `pdf.worker.min.mjs` — Bundled pdf.js web worker for background PDF processing <!--hash:ef580021-->

## extension/options/

- `options.css` — Styles for extension settings page layout and form elements <!--hash:323cd3a5-->
- `options.html` — Settings page: AI engine config, resume upload, profile, learned corrections <!--hash:57897b15-->
- `options.js` — Settings page logic: save/load profile, extract resume, manage corrections <!--hash:0f6ed4a1-->

## extension/popup/

- `popup.css` — Styles for extension popup layout and button states <!--hash:0238d008-->
- `popup.html` — Popup UI: field counts, Fill All, Clear All, settings link <!--hash:8f8c60d6-->
- `popup.js` — Popup logic: ping content script, show field counts, Fill All, Clear All <!--hash:84409985-->

## handoff/

- `HANDOFF-2026-05-25.md` — Session handoff from May 25: initial extension setup and Oracle CX testing <!--hash:499e3852-->
- `HANDOFF-2026-05-26.md` — Session handoff from May 26: combobox strategies, re-fill loop fix, CDP removal <!--hash:68012d30-->
- `HANDOFF-2026-05-27.md` — Session handoff from May 27: simplified architecture, per-field buttons, dead code removal <!--hash:156c8d4b-->
- `HANDOFF-2026-05-29.md` — Session handoff from May 29: combobox typeahead, radio button fixes <!--hash:3622ee8a-->
- `HANDOFF-2026-05-30-session3.md` — Session handoff from May 30 session 3: field debugging iteration <!--hash:7a89cfea-->
- `HANDOFF-2026-05-30.md` — Session handoff from May 30: CDC CLI build, extension refactoring <!--hash:cb727e1a-->
- `HANDOFF-2026-05-31.md` — Session handoff from May 31: CDC CLI completion, extension bug fixes <!--hash:d5dd5e56-->

## scripts/

- `keep_alive.mjs` — Chrome launcher with JC extension loaded, remote debugging on port 9222 <!--hash:f69889ea-->
- `reload_extension.mjs` — Thin wrapper around cdc reload-ext+page for extension hot-reload <!--hash:a30bccc0-->

## test/

- `comprehensive.mjs` — Comprehensive test suite covering all extension features <!--hash:2981a36a-->
- `e2e_runner.mjs` — Runner script for end-to-end Playwright test suite <!--hash:5ac6637d-->
- `extraction.mjs` — Tests for PDF text extraction and profile extraction <!--hash:80f3e6cc-->
- `form_detection.mjs` — Tests for FormDetector field identification and scoring <!--hash:7111128c-->
- `integration.mjs` — Integration tests for extension components working together <!--hash:5cfebec8-->
- `llm_prompts.mjs` — Tests for LLM prompt construction and response parsing <!--hash:59b98bc0-->
- `models.mjs` — Tests for model configuration and API endpoint handling <!--hash:ce59a237-->
- `run_all.mjs` — Test runner that executes all test suites sequentially <!--hash:f4b8e092-->
- `syntax_check.mjs` — Syntax validation for all JavaScript files in the extension <!--hash:ef80593d-->
- `test_apply.mjs` — Tests for job application form fill operations <!--hash:1d2c7553-->
- `test_card.mjs` — Tests for UI card rendering and layout <!--hash:9a295576-->
- `test_chat_ext.mjs` — Tests for LLM chat API integration <!--hash:aa81b5bf-->
- `test_extract_diag.mjs` — Diagnostic tests for profile extraction pipeline <!--hash:215a1f03-->
- `test_extract_diag2.mjs` — Extended diagnostic tests for extraction edge cases <!--hash:470b3299-->
- `test_extract_e2e.mjs` — End-to-end tests for resume upload to profile extraction <!--hash:8925cad0-->
- `test_extract_full.mjs` — Full extraction test with complete resume data <!--hash:15855634-->
- `test_final_v2.mjs` — Final validation test suite v2 for release readiness <!--hash:dbc86f80-->
- `test_final_verify.mjs` — Final verification checks before deployment <!--hash:878bddec-->
- `test_job_page.mjs` — Tests for Oracle CX job page detection and interaction <!--hash:490bc9cb-->
- `test_model.mjs` — Tests for individual LLM model connectivity <!--hash:c7b047ec-->
- `test_model_diag.mjs` — Diagnostic tests for model response quality <!--hash:cb2a8186-->
- `test_nyro.mjs` — Tests for Nyro ATS form detection and filling <!--hash:6721437b-->
- `test_nyro2.mjs` — Extended Nyro ATS tests with additional field types <!--hash:f2946c5b-->
- `test_nyro_ext.mjs` — Extended Nyro ATS tests for edge cases <!--hash:bf642a05-->
- `test_oracle_live.mjs` — Live tests against Oracle CX production job page <!--hash:54efdcec-->
- `test_pdf_extract_final.mjs` — Final PDF extraction tests with various resume formats <!--hash:6b0d64cf-->
- `test_pdf_final.mjs` — Final PDF parsing validation tests <!--hash:825bb733-->
- `test_repro.mjs` — Reproduction test for previously found bugs <!--hash:947004b2-->
- `test_signin.mjs` — Tests for Oracle CX sign-in flow detection <!--hash:8988914f-->
- `tokens.mjs` — Tests for token tracking and usage recording <!--hash:0fdcbbcf-->
- `ui_structure.mjs` — Tests for UI DOM structure and CSS class verification <!--hash:98183d5e-->

## test-results/

- `.last-run.json` — Playwright last test run results cache <!--hash:5fca3f84-->

## test/e2e/

- `options.spec.mjs` — End-to-end Playwright tests for options page <!--hash:de904a5e-->
