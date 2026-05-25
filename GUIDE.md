# Job Copilot — Session Guide

> Single source of truth for how we work on this project.
> Covers: launch, debug, co-debugging session workflow, Feynman dev approach, quick reference.
> Last updated: 2026-05-25

---

## 1. Project Structure

```
job-copilot/
├── extension/
│   ├── manifest.json          # MV3 manifest
│   ├── content/
│   │   ├── content.js         # Injected content script — form detection, auto-fill, floating panel
│   │   ├── form-detector.js   # Field identification logic (pattern matching, scoring)
│   │   └── content.css        # Floating panel styles
│   ├── popup/                 # Toolbar popup
│   ├── options/               # Settings page (resume, profile, LLM config)
│   ├── background/           # Service worker
│   └── lib/                  # llm-client.js, pdf-extract.js, token-tracker.js
├── scripts/
│   ├── dev_launch.sh         # Launch Chrome for Testing with extension loaded
│   ├── reload_extension.mjs  # Reload extension in Chrome via CDP
│   └── jc_launch.js          # Programmatic Playwright launch
├── GUIDE.md                  # ← You are here
├── HANDBOOK.md               # Project state, history, known issues
└── README.md                 # Project overview
```

---

## 2. Launch Chrome

### Method A: Quick launch (recommended for testing)

```bash
cd /Users/shivam94/job-copilot
bash scripts/dev_launch.sh
```

Launches Chrome for Testing with:
- **JC extension** loaded from `extension/` folder
- **Persistent profile** at `.chrome-profile/` (keeps storage, cookies, Bitwarden)
- **CDP port 9222** (for remote debugging)

### Method B: Manual launch

```bash
CHROME_FT="$HOME/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google\ Chrome for Testing.app/Contents/MacOS/Google\ Chrome for Testing"
open -n -a "$CHROME_FT" --args \
  --user-data-dir=".chrome-profile" \
  --load-extension="extension" \
  --remote-debugging-port=9222 \
  '--remote-allow-origins=*' \
  --no-first-run \
  --new-window "about:blank"
```

### Method C: For live co-debugging (I connect to your Chrome)

You just use Chrome normally. I connect via codex-chrome plugin:

```js
const browser = await agent.browsers.get("extension");
const tabs = await browser.user.openTabs();
const oracleTab = tabs.find(t => t.url?.includes('oraclecloud.com'));
const tab = await browser.user.claimTab(oracleTab);
// Now I can evaluate, inspect, debug
```

**Prerequisite:** codex-chrome native host must be installed:
```bash
cd /Users/shivam94/.codex/plugins/cache/chrome-local/codex-chrome/latest
node -e "import('./scripts/installManifest.mjs').then(m => m.install())"
```

---

## 3. Live Co-Debugging Session Workflow

### How a session works

| Who | What they do |
|-----|-------------|
| **You** | Drive the browser. Launch Chrome, navigate Oracle, login with Bitwarden, reach the application form. Tell me "I'm at the form" or describe what you see. |
| **Me (AI)** | Connect via codex-chrome or instruct via console snippets. Inspect DOM, storage, console logs. Diagnose issues. Propose fixes. Show BEFORE→AFTER diffs. |

### Session flow

1. **Orient** (2-3 sentences): What we're solving. Which file(s) need changes.
2. **Execute**: I make edits. For every edit, I show BEFORE→AFTER diff and trace one concrete input through the code path.
3. **Verify**: `node -c <file>` syntax check on every edit. You reload extension + page. We test together.

### After session ends

I update `HANDBOOK.md` with:
- What changed (files, diffs)
- What's working / what's not
- Known issues
- Next steps

---

## 4. Debug Commands (paste in Chrome console)

### Check extension state

```js
// Is JC loaded?
{
  btn: !!document.getElementById('jc-float-btn'),
  panel: !!document.getElementById('jc-panel'),
  panelOpen: document.getElementById('jc-panel')?.classList.contains('open') || false,
  formDetector: typeof FormDetector !== 'undefined',
}
```

### Inspect form field detection

```js
const f = FormDetector.detect();
console.table({
  personal: f.personal.map(x => ({name: x.name, label: x.label, tag: x.el.tagName, type: x.el.type})),
  questions: f.questions.map(x => ({label: x.label})),
  selects: f.selects.map(x => ({name: x.name, label: x.label})),
  unknown: f.unknown.map(x => ({name: x.name, label: x.label})),
});
```

### Check storage

```js
chrome.storage.sync.get(null, console.log);
```

### Check extension errors

Navigate to: `chrome://extensions/?errors=<extId>` (find extId from the URL when viewing the extension card)

---

## 5. Installation (for new setups)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked** → select `extension/` folder
4. Pin the extension from the puzzle icon in the toolbar

### Settings setup

1. Open extension **Settings** → paste your resume text → click **"Extract Profile from Resume"**
2. Review and edit extracted fields
3. Configure LLM endpoint:
   - API Base URL: `http://localhost:19530/v1` (Nyro) or `https://api.openai.com/v1`
   - API Key: `dummy` (Nyro) or `sk-...` (OpenAI)
   - Model: pick from dropdown

---

## 6. Quick Reference

### Console log prefixes

| Prefix | Source | Meaning |
|--------|--------|---------|
| `JC:` | content.js | Main content script messages |
| `🔍 Job Copilot loaded` | content.js | Startup confirmation |
| `🔍 Job Copilot — Form Detection Report` | form-detector.js | Field detection dump |
| `SW:` | background.js | Service worker messages |

### Key DOM selectors

| Selector | Element |
|----------|---------|
| `#jc-float-btn` | Floating JC toggle button |
| `#jc-panel` | Floating panel container |
| `#jc-fill-personal` | Fill Personal button |
| `#jc-fill-all` | Fill AI Questions button |
| `.jc-status` | Status message display |

### Key files

| File | Purpose |
|------|---------|
| `extension/content/content.js` | Content script — injection, auto-fill, panel, learning system |
| `extension/content/form-detector.js` | Field identification, Oracle combobox detection |
| `extension/options/options.js` | Settings, resume extraction, learned corrections UI |
| `scripts/dev_launch.sh` | Launch Chrome with extension |

### Oracle test URL

```
https://icfcjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Aerospace/job/111402
```

### Reload extension after edits

```bash
node scripts/reload_extension.mjs
```

Or manually: `chrome://extensions` → find Job Copilot → click refresh icon.

### Syntax check after edits

```bash
node -c extension/content/content.js
node -c extension/content/form-detector.js
```
