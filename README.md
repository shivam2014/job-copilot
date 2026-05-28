# Job Copilot

AI-powered job application autofiller. Bring your own LLM endpoint.

## How it works

```
1. SETTINGS                         2. ON A JOB PAGE
   ┌────────────────────┐              ┌──────────────────────┐
   │ Paste resume text  │              │ JC button appears    │
   │ → "Extract Profile"│              │                      │
   │   ↓                │              │ "Fill Personal"      │
   │ Name, Email, Phone │   ← you     │   → from profile     │
   │ LinkedIn, GitHub…  │   verify    │                      │
   │   ↓                │              │ "Fill AI Questions"  │
   │ LLM endpoint config│              │   → generates from   │
   │ (any OpenAI API)   │              │     resume + JD      │
   └────────────────────┘              │   → saves Q&A bank   │
                                       └──────────────────────┘
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

- **Resume → Profile extraction** — paste your resume, click "Extract", LLM fills your profile fields
- **Verified profile** — you review and edit before use
- **Form autofill** — personal fields from profile, custom questions from AI
- **Bring your own LLM** — any OpenAI-compatible endpoint (OpenAI, llama.cpp, Ollama, vLLM, Nyro)
- **Saved Q&A bank** — answers auto-save, reuse across applications
- **Works on any ATS** — Workday, Greenhouse, Lever, Oracle Cloud, iCIMS, etc.
- **Review before submit** — nothing submitted automatically
- **Private** — all data in your browser, no external servers except your LLM endpoint
- **Open source** — MIT license

## Installation

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked** → select `extension/` folder
4. Pin the extension from the puzzle icon in the toolbar

## Setup

### Step 1: Paste resume
Open extension **Settings** → paste your full resume text → click **"Extract Profile from Resume"**

The AI reads your resume and pre-fills: name, email, phone, LinkedIn, GitHub, address, work authorization.

### Step 2: Review profile
Edit any field the AI got wrong. These become the **source of truth** for form filling.

### Step 3: Configure LLM
Set your OpenAI-compatible endpoint:

| Setting | Default (Nyro) | OpenAI |
|---------|----------------|--------|
| API Base URL | `http://localhost:19530/v1` | `https://api.openai.com/v1` |
| API Key | `dummy` | `sk-...` |
| Model | `deepseek-v4-flash-2` | `gpt-4o-mini` |

## Usage

1. Go to any job application page
2. A floating **JC** button appears bottom-right → click it
3. **Fill Personal** — fills name, email, phone, etc. from your verified profile
4. **Fill AI Questions** — generates answers for textareas using your resume + job description
5. Inline **✨** button on each textarea for individual AI fills
6. Review everything before hitting submit

Answers you generate are automatically saved in **Saved Answers** (Settings) for reuse.

## Development

```bash
git clone https://github.com/shivam2014/job-copilot
cd job-copilot/extension
# Edit, then reload in chrome://extensions
```

## Privacy

- API key and resume stored in `chrome.storage.sync` (encrypted by Chrome)
- No data sent anywhere except your configured LLM endpoint
- No analytics, no tracking, no third-party services

## License

MIT
