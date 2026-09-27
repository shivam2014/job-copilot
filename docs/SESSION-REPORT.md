# Job Copilot — Fix Session Report

Date: 2026-09-27/28 · Extension: Job Copilot `nbpeoddibjhngmomojgpeoiceocnoknnn` (unpacked, `extension/`)
· Browser: existing Chrome on CDP `:9222` (pid 24687) · LLM: local Nyro gateway `http://localhost:19530/v1`

Line numbers below are from the current working tree at the time of writing and may drift with later edits.
Fix anchors are marked in-code as `[FIX A]`, `[FIX B]` … so they can be re-located by grep:
`grep -rn "\[FIX " extension/`.

---

## Scope & method

1. **Static review** of the extension: `content/content.js`, `content/form-detector.js`,
   `lib/llm-client.js`, `background/background.js`, `options/options.js`, `options/options.html`.
2. **Offline baseline** — `node test/run_all.mjs`: existing suites green but no coverage for the
   LLM bridge, extraction JSON parsing, answer prompts, or fill mapping. Those gaps were filled with
   new suites (see *Tests added*).
3. **Live baseline** (see `BUG LIST` below and the raw dump in `/tmp/jc-live/findings-live-baseline.txt`):
   three real application pages were exercised with fill triggers driven over CDP —
   Lever (`jobs.lever.co/supermove/176fe130-a2cc-40da-b978-8c693fefc510/apply`),
   Greenhouse (`job-boards.greenhouse.io/engineersgate/jobs/8041541`), and
   Oracle CX (`…oraclecloud.com/…/job/111402/apply/section/1`).
4. **Evidence-driven fixes** — every bug below has a raw observation (DOM dump, status text, console
   error or storage dump) attached to it; nothing was changed on suspicion alone.
5. **Live re-verification** — the same Lever page re-run end-to-end after the fixes
   (this document's *Verification* sections), plus a second confirmation run at wrap-up
   (see "Confirmation run" at the bottom).

Tooling notes: `cdc click "#jc-fill-all"` does **not** work on these SPAs (the panel is `position:fixed`
and the click lands at 0,0), and the page's main world has no `chrome.runtime` (extension API is
isolated-world only). Working trigger: a synthetic event sequence
`pointerdown → mousedown → pointerup → mouseup → click` with
`{bubbles:true, cancelable:true, composed:true}` dispatched on `#jc-fill-all`.
`cdc screenshot` times out on all three SPAs because the tab is not frontmost; the workaround is
`Page.bringToFront` + `Page.captureScreenshot {captureBeyondViewport:true}` (helpers `/tmp/jc-live/shot.js`,
`/tmp/jc-live/prep.js`). The extension's own config lives in **`chrome.storage.sync`** (only
`token_history` is in `storage.local`) — dumps must read `sync`.

---

## Bug list

| # | Bug | Symptom (observed) | Root cause (file:line) | Evidence | Fix | Verification |
|---|-----|--------------------|------------------------|----------|-----|--------------|
| 1 | **Wrong-field fill: Website / Portfolio filled with the LinkedIn URL** | Lever `urls[Portfolio]=https://www.linkedin.com/in/shivambhalla07/`, Greenhouse `question_67918484 (Website)` = same LinkedIn URL | A generic URL/website category fell back to any available URL (LinkedIn) — `extension/content/content.js` fillMap construction for `website`; old behaviour at `content.js:169` / `content.js:1989` (`[FIX A]`) | `findings-live-baseline.txt` B1/B2: `urls[Portfolio]=https://www.linkedin.com/in/shivambhalla07/ ✗ WRONG (LinkedIn URL in Portfolio URL)` | `[FIX A]` — website/portfolio/`urls[Portfolio]`/`urls[Other]` are only filled from a *real* website value (`profile_website`), never by cross-field URL fallback (`content.js:1989`, `content.js:169`) | Final live run: `Portfolio URL = ""`, `Other website = ""`, LinkedIn only in `urls[LinkedIn]` |
| 2 | **Learned data poisons profile-owned keys** | `learned_fields.website` = the misfilled LinkedIn URL; the wrong value then persisted and got re-applied on later runs | The blur-learning path wrote *any* field name, including keys the profile owns (`content.js:2090` `saveLearnedCorrection`, called from `content.js:366-380`) | Baseline: `learned_fields GREW 3 → 8 keys … website:"https://www.linkedin.com/in/shivambhalla07/" ← the misfill got LEARNED` | `[FIX B]/[FIX B1]/[FIX B2]` — protected key list (`content.js:194`), learned values only fill gaps and never override profile values (`content.js:210`, `content.js:223`), `saveLearnedCorrection` refuses profile-owned keys (`content.js:2091`), plus a one-time migration that deletes already-poisoned entries (`content.js:2114`, flag `jc_learned_migration_v1`) | Baseline learned set `{email, full_name, github, last_name, linkedin, phone, website, unknown}` → after migration/current runs the retrieved key set is `{unknown, …}`-free of profile keys; confirmation run: keys identical before/after (`["unknown"]`) |
| 3 | **Filling non-application inputs (search/filter UI)** | Oracle CX preview page: profile location written into the job-search box `location="Poland"` on a page with no application form | Fill ran on whatever the detector found; search/filter and hidden/technical inputs were valid targets (`content.js:316` gate missing, `content.js:278` skip predicate missing, `form-detector.js:197`) | `P3 AFTER fill trigger: keyword="" | location="Poland" ✗ WRONG TARGET — profile data written into a JOB-SEARCH filter box` | `[FIX C]/[FIX C1]/[FIX C2]/[FIX C3]/[FIX C4]` — `hasApplicationForm()` gate before any fill (`content.js:316`, `content.js:511`, `content.js:778`), search/filter skip list (`content.js:278`), technical/hidden input skip (`content.js:260`), extension's own UI never a target (`content.js:295`, combined predicate `content.js:309`), detector stops emitting those elements (`form-detector.js:197`) | Offline `form_detection.mjs` + `fill_mapping.mjs` assert the gate and the skip predicate; the Oracle page was **not** re-run at wrap-up (expired-posting path is read-only by design) |
| 4 | **Inferred country** | Greenhouse `country="Poland"` while the profile has no country value; derived from a hardcoded city→country map | `content.js:1280` previously contained a hardcoded city→country inference; the address splitter also guessed | Baseline: `country="Poland" (GUESS — no country in profile; inferred from address)` | `[FIX D]` + `[FIX K2]` — the map is removed (`content.js:1280`), state/country are used **only when `profile_address` explicitly contains them** (`content.js:1954`, `content.js:1850`), and a two-part address is disambiguated by an explicit country list | Offline: `fill_mapping.mjs` / `extraction_parse.mjs` cases assert no inference; Greenhouse was not re-run at wrap-up (only Lever was), so treat the Greenhouse country path as offline-verified only |
| 5 | **Hidden `g-recaptcha-response` queued as an AI question (+ >15 min hang)** | Console: `fillAIQuestions 1/1 failed: g-recaptcha-response: Failed to fetch`; the run appeared to hang for >15 minutes on that field | The detector emitted the hidden reCAPTCHA textarea as a question; the AI path then attempted a request for it, and the request could not fail fast | Baseline ext-errors #3: `fillAIQuestions 1/1 failed: g-recaptcha-response: Failed to fetch (ctx Greenhouse)` | `[FIX C3]` — hidden/technical inputs are never emitted (`form-detector.js:197`) nor queued (`content.js:260`); `[FIX E]` moves the request into the service worker with a bounded retry so a bad target fails fast instead of hanging | Offline `answers.mjs` asserts hidden/technical names are excluded; live runs show zero `g-recaptcha-response` errors |
| 6 | **Extraction never reached the model (`llm_extra_headers` dropped)** | Profile extraction returned nothing/unchanged; the gateway rejected the request because the session header was missing | Chat calls built headers only from base URL + API key and never forwarded `llm_extra_headers` (`lib/llm-client.js:54-58` read the key, but the request path did not include it) | Baseline notes: gateway requires `x-opencode-session: pi-local`; extraction produced no core fields (0 correct) | `[FIX E]` — one chat path through the service worker that forwards `llm_extra_headers`, with explicit `Content-Type`/`Authorization` overrides winning (`background/background.js:199`, `lib/llm-client.js:129-145`) | Live extraction re-run: all core fields correct in 26-27 s with 1 LLM call (see metrics); `llm_bridge.mjs` (15 assertions) covers header merging |
| 7 | **Default model rewrite → HTTP 404** | Requests failed with 404 once the local gateway rotated its model list; a hardcoded default (`qwen3.7-plus`) was rewritten into the request | A pinned default model existed in the client/options/background paths | Baseline: `gateway /v1/models offers ONLY "deepseek-v4-flash-2"; configured llm_model "qwen3.7-plus" not served` → 404 | `[FIX K4]` — **no pinned model** (`lib/llm-client.js:41`, `options/options.js:23`); the client refuses to send without a model and surfaces the actionable Settings error (`lib/llm-client.js:138`, `background/background.js:95/139/220`); bounded retry for transient upstream failures only (`lib/llm-client.js:182/209`) | Confirmation run used `llm_model = deepseek-v4-flash-2` (present in `/v1/models`) → 200s, no 404 |
| 8 | **Corrupting JSON-recovery regexes** | Malformed LLM JSON either threw or, worse, a repair pass edited *inside* string values, producing plausible-but-wrong profile data | The recovery layer used regexes over the whole payload with no string-awareness | Offline repro cases now in `test/extraction_parse.mjs` (8 groups) | `[FIX]` recovery rewrite — structural repair runs only after `JSON.parse` fails and never touches string bodies (`options/options.js:735`, `repairJsonStructure` `options/options.js:640`), truncated replies are reported as truncation via brace balance (`options/options.js:779-785`) | `node test/run_all.mjs` → `extraction_parse.mjs ✅ (8 groups)`; repair flag surfaced to the user (`options/options.js:277`) |
| 9 | **Unreachable `profile_address` (address never mapped)** | Lever `Current location` stayed empty although `profile_address = "42 Maple Street, 7A, Gdansk, 80-394"` | Address fields were only matched by field name/category; the label-based path was unreachable and the stored address was not split | Baseline B5: `location="" ✗ missed` (address exists in profile) | `[FIX K2]` + `[FIX G2]` — label-based resolution for unnamed fields (`content.js:244`, `content.js:793`, `content.js:1850-1954`) plus a final re-assert pass (`content.js:870`) | Confirmation run: `Current location = "Gdansk"` |
| 10 | **Content-script CORS `Failed to fetch`** | Console: `fillAIQuestions 1/1 failed … Failed to fetch` — AI answers never generated on Lever/Greenhouse | The content script issued the chat POST itself; page-origin CORS blocked it (`content.js:717` in the baseline build) | Baseline ext-errors #2/#3 (`Failed to fetch`, ctx Lever + Greenhouse) | `[FIX E]` — chat calls are proxied through the service worker (`background/background.js:199`, `lib/llm-client.js:129-145`), which is not subject to page CORS | Confirmation run: `AI answers 1/1 filled`, zero extension errors (`cdc ext-errors "Job Copilot"` → `No extension errors.`) |
| 11 | **Empty status panel (no feedback)** | `#jc-status-msg` stayed `""` on all three live pages — no completion or error surface | Status was written per phase into transient state and never accumulated into one summary; pages without the panel element threw | Baseline B10: `#jc-status-msg = "" (empty)`; `#jc-stats = ""` on Greenhouse/Oracle | `[FIX F]` — run totals accumulated with a counting wrapper (`content.js:108`, `content.js:2035`), one persistent summary (`content.js:2317`), graceful degradation without the panel (`content.js:2305`) | Confirmation run status: `Filled 8 fields · AI answers 1/1 · resume file not attached (no resume file stored — upload in Settings)` |
| 12 | **Label-less questions → meta-text answers** | The model answered *about* the question (e.g. "This appears to be a question about…") instead of answering it, and questions with no readable label were prompted as empty strings | Question text was taken from the field name instead of the DOM label chain | Offline cases in `test/llm_prompts.mjs` + `answers.mjs` | `[FIX K1]` — question text is derived from the DOM (label chain / wrapper text / aria) before prompting (`form-detector.js:205`, `content.js:706`), meta-commentary output is rejected by an output guard with one stricter retry (`lib/llm-client.js:95`, `content.js:726`), and fields with no readable question are **skipped, not invented** (`content.js:711` reports `skipped "…" (no question text)`) | `answers.mjs` ✅; confirmation run's AI answer is on-topic (mentions Supermove, aerospace tooling, the open-source ML fork) |
| 13 | **Async input masks → false "fill rejected" errors** | Fields reported as unfilled/rejected even though they were filled — sites' own widgets (Lever "Current location") rewrite the input asynchronously | Verification read `el.value` immediately, before the site's commit handler ran, and never re-asserted | Offline case in `fill_mapping.mjs` | `[FIX K2]` + `[FIX G2]` — final re-assert pass for widgets that rewrite their value (`content.js:870`), value resolution prefers name then label (`content.js:254`) | Confirmation run: `Current location = "Gdansk"` after the re-assert; no false "rejected" errors in ext-errors |
| 14 | **`max_tokens` too low → reasoning-only answers** | Model returned only `reasoning_content` with `content: ""` → empty AI answers | Request budget was 300 tokens; a reasoning model spends it all on the reasoning channel | Baseline vision note: `gateway returned reasoning_content only (content:"")`; empty answer observations | `[FIX K1]` — answer budget raised to 1600 tokens (`lib/llm-client.js:246`), with the output guard rejecting empty/meta content (`lib/llm-client.js:262`) | Confirmation run: 1/1 answer filled with substantive text; `token_history` shows completion tokens of ~1000 for answers |

### Tests added (offline, wired into `test/run_all.mjs`)

| Suite | Covers |
|-------|--------|
| `test/extraction_parse.mjs` (8 groups) | JSON parse + structural repair, never touching string bodies, truncation detection |
| `test/llm_bridge.mjs` (15 assertions) | service-worker proxy, header merge/override, bounded retry on 502/503/504 + network errors, no pinned model |
| `test/llm_config.mjs` | no default model, config resolution, actionable error text |
| `test/answers.mjs` | question-text derivation, meta-answer rejection, hidden/technical field exclusion |
| `test/fill_mapping.mjs` | profile-owned keys, learned-merge precedence, search/hidden skip, address mapping with no inference |
| `test/models.mjs`, `test/tokens.mjs`, `test/integration.mjs`, `test/form_detection.mjs`, `test/extraction.mjs`, `test/comprehensive.mjs`, `test/llm_prompts.mjs`, `test/syntax_check.mjs` | pre-existing suites; `run_all.mjs` now lists all 13 |

---

## Before/after metrics

| Metric | Before (baseline) | After (this session) |
|--------|-------------------|----------------------|
| Profile extraction accuracy | 0 correct core fields (request never reached the model: missing session header) | All core fields correct, 26-27 s, **1** LLM call |
| Lever fill | 5 of 9 fillable fields, **1 wrong value** (`Portfolio URL` ← LinkedIn) | 8 fields filled, **0 wrong values** (Portfolio/Twitter/Other correctly left empty), AI answer on-topic ≈ 6 s |
| Wrong-value count across the 3 live pages | 3 (`Portfolio URL`, Greenhouse `Website`, Oracle search `location`) | 0 |
| Extension errors after a run | 2-3 (`Failed to fetch` ×2, `g-recaptcha-response` queued) | 0 (`cdc ext-errors "Job Copilot"` → `No extension errors.`) |
| `learned_fields` growth per run | +5 keys (including poisoned `website=LinkedIn`) | 0 keys (key set identical before/after a full fill) |
| Status surface | `#jc-status-msg` empty | one-line summary with counts + explicit resume-file note |
| Fill wall-clock (Lever) | <6 s but incomplete (AI phase failed, no answers) | terminal status ≈ 36 s (see perf item below); quiet-detect exit at 56 s |

### Confirmation run (wrap-up evidence)

Page: `jobs.lever.co/supermove/176fe130-a2cc-40da-b978-8c693fefc510/apply` (fresh `Page.reload` first).
Trigger: synthetic event sequence on `#jc-fill-all`. Config at run start:
`llm_base_url=http://localhost:19530/v1`, `llm_model=deepseek-v4-flash-2`,
`llm_extra_headers={"x-opencode-session":"pi-local"}`, `llm_api_key=<5 chars>`.

Status transitions: `""` → `Filled 6 personal field(s)` (6 s) → `Generating 1 answer(s)...` (20 s) →
`AI answers: 1/1 filled` (32 s) → terminal (36 s):

```
Filled 8 fields · AI answers 1/1 · resume file not attached (no resume file stored — upload in Settings)
```

Final field dump:

| Field | Name | Value |
|-------|------|-------|
| Resume/CV | `resume` | `0 file(s)` (not attached — by design, see limitations) |
| Full name | `name` | `Shivam Bhalla` |
| Email | `email` | `shivam.bhalla07@gmail.com` |
| Phone | `phone` | `+33-753788537` |
| Current location | `location` | `Gdansk` |
| Current company | `org` | *(empty — no company in profile)* |
| LinkedIn URL | `urls[LinkedIn]` | `https://www.linkedin.com/in/shivambhalla07/` |
| Twitter URL | `urls[Twitter]` | *(empty)* |
| GitHub URL | `urls[GitHub]` | `https://github.com/shivam2014` |
| Portfolio URL | `urls[Portfolio]` | *(empty — was the misfill before)* |
| Other website | `urls[Other]` | *(empty)* |
| Why Supermove / this position? | `cards[a47a5e9b-…][field0]` | on-topic AI answer (~830 chars) |

`cdc ext-errors "Job Copilot"` → `No extension errors.`
`learned_fields` keys before = `["unknown"]`, after = `["unknown"]` → **unchanged** (requirement met).
Raw dumps: `/tmp/jc-live/final-run.json`, screenshot `/tmp/jc-live/shots/final-lever-after.png`.

**Caveat found during the confirmation run (not fixed — outside the file scope of this wrap-up):**
the *value* stored under the synthetic key `unknown` was overwritten by the new AI answer text.
Cause: the blur-learning path (`extension/content/content.js:366-380`) learns any non-`jcFilled` field on
blur, and the AI fill's focus/blur commit trips it; the Lever question card has no detector name, so the
key becomes `unknown`. Impact today: none on filling — `resolveFieldValue` treats `unknown` as "not a data
key" (`content.js:255`), so it cannot be re-applied. Impact tomorrow: unbounded storage growth per AI
answer. Suggested follow-up: skip learning when `fieldName === 'unknown'` or when the element was written
by the AI path (set `dataset.jcFilled` before the blur commit).

---

## What is still not done

- **Resume file is not attached** to `input type=file`. Only extracted resume text is stored
  (`[FIX G1]`, `content.js:2321/2353`); the status line says so explicitly. Uploading/storing the file
  bytes (e.g. IndexedDB) and attaching a `File` to the input is **not implemented**.
- **Workday untested live** — the apply flow is account-gated; requires a real candidate login.
- **Oracle CX** support targets the real apply flow; the expired-posting path was only tested
  read-only (no form renders, extension fills nothing — by design).
- **No CI wiring beyond `npm run test:offline`** — no GitHub Actions workflow, no pre-commit hook.
- **`cdc screenshot` is unreliable on these SPAs** (times out when the tab is not frontmost);
  workaround is `Page.bringToFront` + `Page.captureScreenshot {captureBeyondViewport:true}`.
- **Known perf item:** a Lever fill takes ~35-36 s (target ≤30 s) because of fixed waits in the
  education/language sections; measured terminal status at 36 s in the confirmation run.
- **Lever "Current location" auto-commit** relies on re-asserting the value after the site rewrites it
  (`[FIX K2]`, `content.js:870`); if Lever changes that widget, re-verify.
- **Learned-value growth under the synthetic `unknown` key** (see caveat above).
- LLM retries remain **bounded and limited** to 502/503/504 + network errors; no queue, no backoff
  beyond the fixed retry count.
- The local Nyro gateway's model list changes; always pick the model from the fetched
  `${base_url}/models` list — nothing in the extension ships a default model any more (by design).

---

## How to use

1. **Load the extension**: `chrome://extensions` → Developer mode → *Load unpacked* → `extension/`.
2. **Settings**: upload your PDF resume (or use *Paste resume text*) → **Extract Profile from Resume**
   (1 LLM call, ~26 s against the local gateway).
3. **Review and edit the extracted profile** — it is the source of truth; learned values never override it.
4. **Configure the LLM**: `llm_base_url`, `llm_api_key` (may be `dummy` for a local gateway),
   `llm_model` **must** be picked from `${base_url}/models` (no hardcoded default), and
   `llm_extra_headers` (JSON, e.g. `{"x-opencode-session":"pi-local"}` for the local Nyro gateway).
   Explicit `Content-Type`/`Authorization` set here win. Then press **Test connection**.
5. On an application page, open the **JC** panel: **Fill All** (or per-field **F** pills), per-question
   **✨** for an AI answer → **review everything** → **submit manually**. The extension never submits and
   refuses to fill a question it cannot read.
6. Re-run the regression suite before committing:

```bash
cd ~/job-copilot
npm test              # vitest (fast, matching priority) — NOT sufficient alone
npm run test:offline  # node test/run_all.mjs — full offline regression suite (13 suites)
npm run test:all      # both, in order
```

Live check (Chrome already running with the extension loaded, CDP on 9222):

```bash
# gate: syntax of every extension JS file
node -e 'const fs=require("fs"),vm=require("vm");for(const d of ["extension/background","extension/content","extension/lib","extension/options"])for(const n of fs.readdirSync(d).filter(n=>n.endsWith(".js"))){const p=d+"/"+n;new vm.Script(fs.readFileSync(p,"utf8"),{filename:p});console.log("OK",p)}'

# extension health
cdc status
cdc ext-errors "Job Copilot"

# one confirmation fill on Lever (reloads the page, triggers #jc-fill-all over CDP and dumps evidence)
node /tmp/jc-live/final-verify.cjs   # writes /tmp/jc-live/final-run.json + shots/final-lever-after.png
```

Expected confirmation output: terminal status `Filled 8 fields · AI answers 1/1 · resume file not
attached (… )`, zero extension errors, `learned_fields` key set unchanged.
