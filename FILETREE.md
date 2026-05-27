# Project Filetree

_Auto-maintained by `/filetree:update`. Each entry carries a content hash; mismatched hashes indicate stale summaries._

## (root)/

- `.gitignore` — Git ignore rules for node_modules, .chrome-profile, and test artifacts <!--hash:fa87c4b5-->
- `ARCHITECTURE.md` — Project architecture overview and component relationships <!--hash:2ca879c0-->
- `GUIDE.md` — Session workflow guide: launch, debug, CDP tools, testing protocol <!--hash:e85d7b12-->
- `HANDBOOK.md` — Current state, known blockers, architecture notes, and development setup <!--hash:01494538-->
- `LICENSE` — MIT license file for the Job Copilot project <!--hash:3f202a39-->
- `README.md` — Project readme with installation instructions and feature overview <!--hash:a3b33d21-->
- `RESEARCH.md` — Research on autofill techniques for Oracle CX and Workday forms <!--hash:f1f29311-->
- `SESSION_START.md` — Startup checklist and golden rules for every session <!--hash:578a08bd-->
- `package.json` — Node.js package config with Playwright dev dependency <!--hash:5df512b6-->
- `playwright.config.mjs` — Playwright test configuration for browser automation tests <!--hash:9d096707-->
- `test_extract.py` — Python script for resume text extraction and profile parsing <!--hash:b4e3f9da-->

## .reasonix/skills/

- `caveman.md` — Reasonix skill: ultra-compressed communication mode to cut token usage <!--hash:5f8c16db-->
- `cognitive-apprenticeship.md` — Reasonix skill: learn from AI reasoning process and debugging approach <!--hash:0172152a-->
- `diagnose.md` — Reasonix skill: disciplined diagnosis loop for hard bugs and regressions <!--hash:56732757-->
- `doc.md` — Reasonix skill: create and edit .docx documents with formatting fidelity <!--hash:62b58c3a-->
- `drawio-skill.md` — Reasonix skill: generate .drawio diagrams and export to PNG/SVG/PDF <!--hash:edd99a9e-->
- `electron.md` — Reasonix skill: automate Electron desktop apps via Chrome DevTools Protocol <!--hash:819408c6-->
- `excalidraw-diagram.md` — Reasonix skill: create Excalidraw diagram JSON for visual arguments <!--hash:45bab54d-->
- `feynman-workflow.md` — Reasonix skill: ship fast and learn deep development methodology <!--hash:3dfcccfe-->
- `gh-address-comments.md` — Reasonix skill: address review and issue comments on GitHub PRs <!--hash:f428fce2-->
- `gh-fix-ci.md` — Reasonix skill: debug and fix failing GitHub Actions CI checks <!--hash:80b1ebb6-->
- `grill-me.md` — Reasonix skill: interview user about plan or design until shared understanding <!--hash:893b6f57-->
- `grill-with-docs.md` — Reasonix skill: grill plan against existing domain model and update docs <!--hash:4ec69d7a-->
- `handoff.md` — Reasonix skill: compact conversation into handoff document for another agent <!--hash:ecb906d7-->
- `html-effectiveness.md` — Reasonix skill: create single-file HTML pages for any purpose <!--hash:bec3219f-->
- `humanizer.md` — Reasonix skill: remove signs of AI-generated writing from text <!--hash:8c2b4208-->
- `improve-codebase-architecture.md` — Reasonix skill: find deepening opportunities in codebase architecture <!--hash:c77ca62e-->
- `jupyter-notebook.md` — Reasonix skill: create, scaffold, or edit Jupyter notebooks <!--hash:d900d5c5-->
- `keep-codex-fast.md` — Reasonix skill: safe maintenance for Codex Desktop/CLI state <!--hash:72428974-->
- `local-latex.md` — Reasonix skill: compile LaTeX documents to PDF using local TinyTeX <!--hash:c04f724c-->
- `overleaf.md` — Reasonix skill: sync and manage Overleaf LaTeX projects from command line <!--hash:2971e36e-->
- `pdf.md` — Reasonix skill: read, create, or review PDF files with layout fidelity <!--hash:0688b3c6-->
- `playwright.md` — Reasonix skill: automate real browser from terminal via playwright-cli <!--hash:98f8d472-->
- `scrapling-official.md` — Reasonix skill: scrape web pages with anti-bot bypass and stealth browsing <!--hash:b6ef7442-->
- `sysml-modeling.md` — Reasonix skill: SysML modeling for Model-Based Systems Engineering <!--hash:8f2db0ea-->
- `tdd.md` — Reasonix skill: test-driven development with red-green-refactor loop <!--hash:5bf17a81-->
- `youtube-transcript-extractor.md` — Reasonix skill: fetch and save YouTube video transcripts <!--hash:e4fc3420-->

## extension/

- `manifest.json` — Chrome MV3 manifest: permissions, content scripts, background worker <!--hash:35c23157-->

## extension/background/

- `background.js` — Service worker: PDF text extraction, LLM profile extraction, options page opener <!--hash:25673550-->

## extension/content/

- `content.css` — Styles for floating JC button, panel, stats, and per-field fill buttons <!--hash:f461339d-->
- `content.js` — Panel UI, Fill All, per-field buttons, learning system, SPA observer <!--hash:fb5b97b7-->
- `form-detector.js` — Field detection patterns, fill routing, Oracle combobox 4-strategy chain <!--hash:350d1c29-->
- `form-detector.js.bak2` — Backup of form-detector.js from before simplification <!--hash:d2362fc1-->

## extension/lib/

- `llm-client.js` — OpenAI-compatible API wrapper for chat and field extraction <!--hash:0bee1411-->
- `pdf-extract.js` — PDF text and hyperlink extraction using pdf.js for options page <!--hash:bed16398-->
- `token-tracker.js` — Records LLM token consumption per model with history and summary <!--hash:487138ec-->

## extension/lib/pdfjs/

- `pdf.min.mjs` — Bundled pdf.js library for PDF parsing in browser <!--hash:5822350b-->
- `pdf.worker.min.mjs` — Bundled pdf.js web worker for background PDF processing <!--hash:ef580021-->

## extension/options/

- `options.css` — Styles for extension settings page layout and form elements <!--hash:c21deced-->
- `options.html` — Settings page: AI engine config, resume upload, profile, learned corrections <!--hash:70e9e43f-->
- `options.js` — Settings page logic: save/load profile, extract resume, manage corrections <!--hash:67b64d5f-->

## extension/popup/

- `popup.css` — Styles for extension popup layout and button states <!--hash:0238d008-->
- `popup.html` — Popup UI: field counts, Fill All, Clear All, settings link <!--hash:8f8c60d6-->
- `popup.js` — Popup logic: ping content script, show field counts, Fill All, Clear All <!--hash:5af9d26e-->

## handoff/

- `HANDOFF-2026-05-25.md` — Session handoff from May 25: initial extension setup and Oracle CX testing <!--hash:499e3852-->
- `HANDOFF-2026-05-26.md` — Session handoff from May 26: combobox strategies, re-fill loop fix, CDP removal <!--hash:68012d30-->
- `HANDOFF-2026-05-27.md` — Session handoff from May 27: simplified architecture, per-field buttons, dead code removal <!--hash:156c8d4b-->

## scripts/

- `cdp.mjs` — CDP tool: eval JS, navigate, click on Oracle page via WebSocket bridge <!--hash:295bd4c0-->
- `cdp_adv.mjs` — Advanced CDP: fresh Oracle tab with console suppression <!--hash:416f6ff0-->
- `cdp_connect.mjs` — CDP WebSocket connection helper for bridge communication <!--hash:940db050-->
- `dev_launch.sh` — Launch Chrome with JC extension via CDP pipe bridge <!--hash:f0b8895f-->
- `email_step.mjs` — Navigate to and interact with Oracle CX email step <!--hash:60d1a58a-->
- `jc_demo_setup.js` — Automated demo setup: fill form fields for screenshots <!--hash:aa58d8a7-->
- `jc_launch.js` — Chrome launch script with extension loading for development <!--hash:fc0d1a8e-->
- `jc_quick_test.js` — Quick test script for form detection and filling <!--hash:8a8574ba-->
- `launch_persistent.mjs` — Launch Chrome with persistent user profile for extension testing <!--hash:335b4c48-->
- `launch_with_ext.mjs` — Chrome launch via --remote-debugging-pipe with Extensions.loadUnpacked CDP <!--hash:20db3035-->
- `quick_test.mjs` — Minimal test script for rapid extension validation <!--hash:2e64865c-->
- `reload_extension.mjs` — Reload extension via Chrome Developer Private API <!--hash:4e350da9-->

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
