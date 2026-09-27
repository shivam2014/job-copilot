# Job Copilot

AI-powered job application autofiller. Bring your own LLM endpoint.

## How it works

```
1. SETTINGS                         2. ON A JOB PAGE
   ┌────────────────────┐              ┌──────────────────────┐
   │ Upload PDF resume  │              │ JC panel appears     │
   │ → "Extract Profile"│              │                      │
   │   ↓                │              │ "Fill All"           │
   │ Name, Email, Phone │   ← you     │   → from profile     │
   │ LinkedIn, GitHub…  │   verify    │   → AI answers for   │
   │   ↓                │   + edit    │     readable Qs      │
   │ LLM endpoint config│              │   → saves Q&A bank   │
   │ pick model from    │              │                      │
   │ ${base_url}/models │              │ you submit manually  │
   └────────────────────┘              └──────────────────────┘
```

## Architecture

Interactive visual architecture covering the full extension internals:

**[📐 View Interactive Architecture](https://shivam2014.github.io/job-copilot/)**

Four diagrams with clickable nodes and detail panels:

| Diagram | What it shows |
|---------|--------------|
| Extension Architecture | File structure, data flow between modules, Chrome Storage, LLM endpoint |
| Fill All Trace | Step-by-step execution from button click through detection, filling, and learning |
| Clear All Trace | All 7 clear phases — Oracle comboboxes, profile tiles, inputs, radios |
| Resume Data Flow | PDF upload → LLM extraction → storage → fill map → form fields |

Also available locally: open `ARCHITECTURE_VISUAL.html` in any browser.

## Features

- **Resume → Profile extraction** — upload your PDF resume, click "Extract", LLM fills your profile fields
- **Verified profile** — you review and edit before use
- **Form autofill** — personal fields from profile, custom questions from AI
- **Bring your own LLM** — any OpenAI-compatible endpoint (OpenAI, llama.cpp, Ollama, vLLM, Nyro)
- **Saved Q&A bank** — answers auto-save, reuse across applications
- **Targets the big ATSes** — Greenhouse, Lever and Oracle CX verified live; Workday and iCIMS flows implemented but not verified (Workday is account-gated)
- **Review before submit** — nothing submitted automatically, ever
- **Private** — all data in your browser, no external servers except your LLM endpoint
- **Open source** — MIT license

## Installation

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked** → select `extension/` folder
4. Pin the extension from the puzzle icon in the toolbar

## Setup

### Step 1: Extract from resume
Open extension **Settings** → upload your PDF resume (a **Paste resume text**
option exists for plain text) → click **"Extract Profile from Resume"**

The AI reads your resume and pre-fills: name, email, phone, LinkedIn, GitHub, address, work authorization.

### Step 2: Review profile
Edit any field the AI got wrong. These become the **source of truth** for form filling.

### Step 3: Configure LLM
Set your OpenAI-compatible endpoint:

| Setting | Example (local Nyro gateway) | OpenAI |
|---------|------------------------------|--------|
| API Base URL | `http://localhost:19530/v1` | `https://api.openai.com/v1` |
| API Key | `dummy` (the local gateway ignores it) | `sk-...` |
| Model | *pick one from `${base_url}/models`* | `gpt-4o-mini` |
| Extra Headers (JSON) | `{"x-opencode-session":"pi-local"}` | *(clear it)* |

There is **no hardcoded default model**. The extension asks your endpoint for
`${base_url}/models` and you must pick a model from that list — a model name the
endpoint does not serve returns HTTP 404 from the provider. Use **Test
connection** in Settings to confirm base URL + key + model before filling a form.

The local Nyro gateway rotates its model list, so re-open the Settings page and
pick the model from the freshly fetched list instead of typing an old name.

**Extra Headers** are sent with every LLM request. `{"x-opencode-session":"pi-local"}`
is required by the local Nyro gateway (it rejects requests without that header)
and is harmless against other OpenAI-compatible endpoints. An explicit
`Content-Type` or `Authorization` you set here always wins over the values the
extension derives from Base URL / API Key; other unknown headers may be dropped
or rejected by strict endpoints, so clear the field if your provider complains.

LLM requests retry a bounded number of times, and only on HTTP 502/503/504 or
network errors — a 4xx (bad model, bad key) fails immediately instead of
hammering the endpoint.

## Usage

1. **Settings** → upload/extract your **PDF resume**: the resume text is sent to
your LLM, which proposes profile values (name, email, phone, LinkedIn, GitHub,
address, work authorization).
2. **Review and edit the extracted profile.** Your edited profile is the source
of truth for every fill — the extension prefers it over anything learned from
previous applications.
3. Open a job application page. A floating **JC** button appears bottom-right;
click it (or keep the panel open) to show the control panel.
4. **Fill All** fills the profile-derived fields; the per-field **F** pills fill a
single field, and the per-question **✨** button generates an AI answer for that
one question (resume + job description are sent to your LLM).
5. **Review every value.** Then submit the application **yourself**.

The extension **never submits** an application, never clicks Submit/Add-entry
buttons, and refuses to fill a question it cannot read — a field with no
readable question text is skipped (the status line reports
`skipped (no question text)`) rather than answered with invented text.
Answers you generate are saved in **Saved Answers** (Settings) for reuse.

### Known limitations

- **The resume file itself is not attached** to `input type=file`. Only the
extracted resume *text* is stored; the status line says so explicitly
(`resume file not attached (no resume file stored — upload in Settings)`).
- **Workday is not exercised live**: its apply flow is account-gated, so it
cannot be tested without a real candidate login.
- **Oracle CX support targets the real apply flow.** An expired or cancelled
posting renders no application form, and the extension fills nothing (by
design) — it must not write profile data into job-search filter boxes.
- **A Lever fill takes ~35–36 s**, above the 30 s target, because of fixed waits
in the education/language sections. Known perf item, not a correctness bug.
- **Lever's "Current location" auto-commit** works by re-asserting the value
after the site's own widget rewrites it. If Lever changes that widget,
re-verify this path.
- The local Nyro gateway's model list changes over time — always pick the model
from the fetched `${base_url}/models` list, never hardcode one.
- LLM retries are **bounded and limited** to 502/503/504 + network errors; there
is no retry on other failures and no request queue.

## Development

```bash
git clone https://github.com/shivam2014/job-copilot
cd job-copilot/extension
# Edit, then reload in chrome://extensions
```

Tests:

```bash
npm test            # vitest — fast, single spec file, matching-priority checks
npm run test:offline # node test/run_all.mjs — full offline regression suite
npm run test:all     # both, in order
```

`npm test` alone is **not sufficient**: it covers the vitest spec only. The real
regression coverage for extraction, form detection, fill mapping, the LLM bridge
and prompt handling lives in `test/run_all.mjs` — always run
`npm run test:offline` (or `npm run test:all`) before committing.

## Privacy

- API key and resume stored in `chrome.storage.sync` (encrypted by Chrome)
- No data sent anywhere except your configured LLM endpoint
- No analytics, no tracking, no third-party services

## License

MIT
