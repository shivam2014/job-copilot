# Job Copilot

AI-powered job application autofiller. Bring your own LLM endpoint.

## Features

- **Autofill personal fields** — name, email, phone, LinkedIn, etc.
- **AI-generated answers** for custom application questions — uses your resume + job description as context
- **Bring your own LLM** — supports any OpenAI-compatible API (OpenAI, local llama.cpp, Ollama, vLLM, etc.)
- **Review before submit** — nothing is submitted automatically
- **Works on any ATS** — Greenhouse, Workday, Lever, Oracle Cloud, iCIMS, and more
- **Private** — your API key and resume stay in your browser
- **Open source** — MIT license

## Installation

1. Download or clone this repo
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `extension/` folder

## Setup

After installing, click the extension icon → **Settings**:

### Profile
Fill in your personal details (name, email, phone, LinkedIn, GitHub, etc.).

### Resume
Paste your resume text. This is used as context for AI-generated answers.

### LLM Configuration
Configure any OpenAI-compatible endpoint:

| Setting | Example | Notes |
|---------|---------|-------|
| API Base URL | `https://api.openai.com/v1` | Or `http://localhost:8080/v1` for local |
| API Key | `sk-...` | Use `dummy` for local endpoints that don't need auth |
| Model | `gpt-4o-mini` | Or whatever your endpoint provides |

## Usage

1. Go to any job application page
2. A floating **JC** button appears in the bottom-right corner
3. Click it to open the control panel
4. Click **Fill Personal Fields** to fill basic info
5. Click **Fill AI Questions** to generate answers for custom questions
6. Review everything before hitting submit

You can also click the extension icon in the toolbar for the same controls.

### Inline AI assist
On textarea fields, a ✨ button appears. Click it to generate an AI answer for just that question.

## Architecture

```
┌──────────────────────┐
│  Chrome Extension     │
│                      │
│  ┌────────────────┐  │
│  │ Popup (toolbar) │  │  → Controls + status
│  └────────────────┘  │
│  ┌────────────────┐  │
│  │ Content script  │  │  → Form detection + filling
│  └────────────────┘  │
│  ┌────────────────┐  │
│  │ Options page    │  │  → Profile + LLM config
│  └────────────────┘  │
│  ┌────────────────┐  │
│  │ LLM Client     │  │  → Calls your API endpoint
│  └────────────────┘  │
└──────────────────────┘
         │
         ▼
  Any OpenAI-compatible API
  (OpenAI / local / Ollama / vLLM)
```

## Privacy

- Your API key is stored in `chrome.storage.sync` (encrypted by Chrome)
- Your resume is stored locally in your browser
- No data is sent to any server except your configured LLM endpoint
- No analytics, no tracking, no third-party services

## Development

```bash
git clone https://github.com/shivam2014/job-copilot
cd job-copilot/extension
# Edit files, then reload in chrome://extensions
```

## License

MIT
