# Job Copilot — Developer Workflow

> Last updated: 2026-05-25
> This doc exists so future sessions can iterate fast without re-learning the Chrome/Playwright setup.

---

## Fast Iteration Loop (REUSE the profile)

**Never re-upload the resume.** The Chrome profile keeps extension storage persistent.

```bash
cd /Users/shivam94/job-copilot

# Reuse this profile — it already has the resume extracted and LLM configured
USER_DATA_DIR=/tmp/jc-playwright-profile-v4

# Extension path
EXT_PATH=/Users/shivam94/job-copilot/extension
```

### One-shot test script template

Create a throwaway script, run it, delete it. The profile stays intact.

```js
// test.js — copy-paste template
const { chromium } = require('playwright');

(async () => {
  const context = await chromium.launchPersistentContext('/tmp/jc-playwright-profile-v4', {
    headless: false,
    args: [
      `--disable-extensions-except=/Users/shivam94/job-copilot/extension`,
      `--load-extension=/Users/shivam94/job-copilot/extension`,
    ],
  });

  await new Promise(r => setTimeout(r, 3000));

  // Get extension ID from service worker
  const serviceWorkers = context.serviceWorkers();
  let extId = null;
  for (const sw of serviceWorkers) {
    const m = sw.url().match(/chrome-extension:\/\/([a-z]+)/);
    if (m) extId = m[1];
  }
  console.log('Extension ID:', extId);

  // --- YOUR TEST CODE HERE ---
  const page = await context.newPage();
  await page.goto('https://icfcjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Aerospace/job/111402');
  await page.waitForTimeout(4000);

  // Click Apply Now
  const applyNow = page.locator('text=/Apply Now/i');
  if (await applyNow.isVisible().catch(() => false)) {
    await applyNow.click();
    await page.waitForTimeout(5000);
  }

  // Open JC panel
  await page.click('#jc-float-btn');
  await page.waitForTimeout(800);

  // Do stuff...

  await page.screenshot({ path: '/tmp/test_result.png', timeout: 5000 });

  await new Promise(r => setTimeout(r, 5000));
  await context.close();
})();
```

Run it:
```bash
node test.js
```

---

## Extension ID

The extension ID is **derived from the absolute path** of the unpacked extension directory. It is stable as long as the path doesn't change.

- Current ID: `nbpeoddibjhngmomojgpeoiceocnoknn`
- If you move the extension directory, the ID changes.
- Detection: look at service worker URLs from Playwright context.

---

## What persists in the profile

| Data | Persisted? | Notes |
|------|-----------|-------|
| `chrome.storage.sync` (profile, resume, LLM config) | ✅ Yes | Stored in profile, survives relaunches |
| Extension code changes (content.js, etc.) | ✅ Yes | `--load-extension` reads from disk each launch |
| Service worker state | ❌ No | Fresh each launch |
| Content script console logs | ❌ No | Lost on navigation |

**This means:** Edit `extension/content/content.js`, save, run a test script — the changes are live immediately. No reload needed.

---

## Pre-configured state (already in the profile)

The profile at `/tmp/jc-playwright-profile-v4` already has:

- **LLM endpoint**: `http://localhost:19530/v1`
- **API key**: `dummy`
- **Model**: `deepseek-v4-flash-2`
- **Resume**: Extracted from `Resume_Shivam_Bhalla_Honeywell_20260522.pdf`
- **Profile fields**: Name, email, phone, etc. all populated

**You do NOT need to visit the options page again.** Just open the job page and test.

---

## Oracle test URL

```
https://icfcjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Aerospace/job/111402
```

Flow:
1. Navigate → JC button appears
2. Click JC button → panel opens
3. Click "Apply Now" → SPA transition, panel auto-reopens (since 2026-05-25 fix)
4. Click "Fill Personal Fields" → email auto-filled

---

## Common Playwright snippets

### Read panel state
```js
const state = await page.evaluate(() => ({
  hasBtn: !!document.getElementById('jc-float-btn'),
  hasPanel: !!document.getElementById('jc-panel'),
  panelOpen: document.getElementById('jc-panel')?.classList.contains('open') || false,
  stats: document.getElementById('jc-stats')?.innerText?.trim() || null,
}));
```

### Read detected fields
```js
const fields = await page.evaluate(() => {
  if (typeof FormDetector === 'undefined') return { error: 'not loaded' };
  const f = FormDetector.detect();
  return {
    personal: f.personal.length,
    questions: f.questions.length,
    selects: f.selects.length,
    files: f.files.length,
  };
});
```

### Click Fill Personal via JS (avoids visibility issues)
```js
await page.evaluate(() => {
  const btn = document.getElementById('jc-fill-personal');
  if (btn) btn.click();
});
```

### Read storage
```js
const storage = await page.evaluate(() =>
  new Promise(r => chrome.storage.sync.get(null, r))
);
```

### Capture console logs
```js
const logs = [];
page.on('console', msg => {
  if (msg.text().includes('JC:')) logs.push(msg.text());
});
// ... do stuff ...
console.log('Logs:', logs);
```

---

## Key files to edit

| File | Purpose |
|------|---------|
| `extension/content/content.js` | Floating button, panel, fill logic, SPA transitions |
| `extension/content/form-detector.js` | Field identification, honeypot filtering |
| `extension/content/content.css` | Panel styles (use `!important` for Oracle overrides) |
| `extension/options/options.js` | Settings page, model dropdown, resume extraction |
| `extension/lib/llm-client.js` | LLM API calls |

**After editing:** Save, run a test script. Content scripts reload with the page. No manual extension reload needed.

---

## Known quirks

1. **Oracle has 547 shadow roots** — Playwright locators can't pierce them easily. Use `page.evaluate()` for DOM inspection.
2. **`resume_text` in storage is empty** after PDF upload — this is normal. PDF upload stores structured data in `resume_full_data` instead. The extension uses `resume_full_data` for AI context.
3. **FormDetector not accessible from Playwright context** — It's a content script global. Use `page.evaluate(() => typeof FormDetector)` to check.
4. **Screenshot timeout** — Oracle pages are heavy. Use `{ timeout: 5000 }` or skip full-page screenshots.

---

## LLM endpoint check (before testing)

```bash
curl -s http://localhost:19530/v1/models | python3 -c "import sys,json; d=json.load(sys.stdin); [print(m['id']) for m in d.get('data',[])]"
```

Expected models include: `deepseek-v4-flash-2`, `deepseek-v4-pro-2`, `kimi-k2.6-2`, etc.

---

## Session handoff notes

- Always check `/Users/shivam94/job-copilot/handoff/` for the latest session notes.
- The `DEVELOPER_WORKFLOW.md` (this file) is the ground truth for fast iteration.
- If the profile gets corrupted, delete `/tmp/jc-playwright-profile-v4` and re-run the full setup once.
