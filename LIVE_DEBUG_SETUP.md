# Live Co-Debugging Setup

> How to let YOU drive the browser while I inspect, guide, and fix issues in real time.

---

## Goal

You launch Chrome with your profile (Bitwarden, cookies, etc.), navigate to a job application, login with Bitwarden, and then we debug the JC extension together — I can see console logs, DOM state, storage, and guide you through fixes live.

---

## Method 1: Chrome Remote Debugging (Recommended — I get full access)

### Step 1: You launch Chrome with remote debugging

**Close all Chrome windows first**, then run:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="/Users/$USER/Library/Application Support/Google/Chrome" \
  --load-extension="/Users/shivam94/job-copilot/extension"
```

This launches Chrome with:
- Your real profile (Bitwarden, saved passwords, cookies)
- Job Copilot extension loaded
- Remote debugging port 9222 that Playwright can connect to

### Step 2: You do your thing

1. Navigate to the Oracle job page
2. Click "Apply Now"
3. When the login screen appears, use Bitwarden to fill credentials
4. Continue to the application form
5. Tell me "I'm at the form" or "I see an error"

### Step 3: I connect and inspect

I run a script that connects to your Chrome via the debugging port:

```js
const { chromium } = require('playwright');

(async () => {
  // Connect to YOUR Chrome instance
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  
  // Find the Oracle tab
  const pages = context.pages();
  const oraclePage = pages.find(p => p.url().includes('oraclecloud.com'));
  
  if (!oraclePage) {
    console.log('No Oracle tab found');
    return;
  }
  
  // I can now do everything:
  // - Read console logs
  // - Inspect DOM
  // - Check storage
  // - Take screenshots
  // - Read FormDetector state
  
  const state = await oraclePage.evaluate(() => ({
    hasBtn: !!document.getElementById('jc-float-btn'),
    hasPanel: !!document.getElementById('jc-panel'),
    panelOpen: document.getElementById('jc-panel')?.classList.contains('open') || false,
  }));
  console.log('JC state:', state);
  
  // Screenshot for you to see
  await oraclePage.screenshot({ path: '/tmp/jc_live_inspect.png' });
  
  // Read console logs
  const logs = await oraclePage.evaluate(() => {
    if (window.__jcLogs) return window.__jcLogs;
    // Or we can inject a console hook
    return [];
  });
  console.log('Logs:', logs);
  
  // Check storage
  const storage = await oraclePage.evaluate(() =>
    new Promise(r => chrome.storage.sync.get(null, r))
  );
  console.log('Storage keys:', Object.keys(storage));
  
  // Check detected fields
  const fields = await oraclePage.evaluate(() => {
    if (typeof FormDetector === 'undefined') return { error: 'not loaded' };
    const f = FormDetector.detect();
    return {
      personal: f.personal.map(x => ({ name: x.name, label: x.label })),
      questions: f.questions.map(x => ({ label: x.label })),
      selects: f.selects.map(x => ({ name: x.name, label: x.label })),
    };
  });
  console.log('Fields:', JSON.stringify(fields, null, 2));
})();
```

### What I can do live

| Action | How |
|--------|-----|
| See what you see | Screenshots |
| Read console errors | `page.evaluate(() => window.__jcLogs)` |
| Check if JC injected | `!!document.getElementById('jc-float-btn')` |
| Check detected fields | `FormDetector.detect()` |
| Check your stored profile | `chrome.storage.sync.get(null)` |
| Check extension errors | Navigate to `chrome://extensions/?errors=<extId>` |
| Read network requests | Playwright HAR capture |
| Fix code on the fly | You edit `content.js`, save, reload page |

---

## Method 2: You Share Screenshots + Console (Simplest)

If remote debugging feels too heavy:

### Step 1: Open DevTools before you start

Press `Cmd+Option+J` (Mac) to open Console. Keep it visible.

### Step 2: Inject the log capture snippet

Paste this in Console before navigating:

```js
window.__jcLogs = [];
const origLog = console.log;
console.log = function(...args) {
  const msg = args.join(' ');
  if (msg.includes('JC:') || msg.includes('Job Copilot') || msg.includes('FormDetector')) {
    window.__jcLogs.push(msg);
  }
  origLog.apply(console, args);
};
console.log('JC log capture active');
```

### Step 3: Do your thing, then paste logs

After you see an issue, paste this in console and screenshot the output:

```js
// Show last 20 JC logs
console.log(window.__jcLogs.slice(-20).join('\n'));

// Show JC state
({
  btn: !!document.getElementById('jc-float-btn'),
  panel: !!document.getElementById('jc-panel'),
  panelOpen: document.getElementById('jc-panel')?.classList.contains('open'),
  fields: typeof FormDetector !== 'undefined' ? FormDetector.detect() : 'not loaded'
});
```

### Step 4: Screenshot the results

Screenshots of:
1. The job page with the JC panel visible
2. Console output after running the snippets
3. Extension options page (`chrome-extension://<extId>/options/options.html`)

I can diagnose from those.

---

## Method 3: codex-chrome Plugin (If Native Host Works)

The codex-chrome plugin can connect to your actual Chrome browser, but it requires the Codex Chrome Extension + native messaging host to be installed.

Currently the native host manifest is missing on this machine. If you install it from the Codex plugin UI, I can:

```js
// List your open tabs
const tabs = await browser.user.openTabs();
// Claim the Oracle tab
const oracleTab = await browser.user.claimTab(tabs.find(t => t.url.includes('oracle')));
// Full programmatic control
await oracleTab.playwright.evaluate(() => FormDetector.detect());
```

**To enable:** Open Codex app → Plugins → Chrome → Reinstall if needed.

---

## Quick Reference: What to Check When Something Breaks

Run these in Console and paste results:

```js
// 1. Is JC loaded?
console.log('JC loaded?', !!document.getElementById('jc-float-btn'));

// 2. What fields were detected?
console.log('Fields:', FormDetector.detect());

// 3. What's in my profile?
chrome.storage.sync.get(['profile_name','profile_email','profile_phone','resume_full_data'], r => console.log(r));

// 4. Any console errors?
console.log('Errors:', window.__jcLogs?.filter(l => l.includes('Error') || l.includes('❌')));

// 5. Is it a login screen?
const f = FormDetector.detect();
const appFields = f.personal.filter(x => x.name !== 'email' && x.name !== 'unknown');
console.log('Login screen?', appFields.length === 0 && f.selects.length === 0);
```

---

## Extension Options Page

To check your stored profile without screenshots:

```
chrome-extension://nbpeoddibjhngmomojgpeoiceocnoknn/options/options.html
```

Bookmark this. It shows:
- LLM config
- Extracted profile fields
- Full resume data sections
- Saved answers
- Token usage

---

## File Map (For Live Editing)

| If this is broken... | Edit this file |
|---------------------|----------------|
| JC button doesn't appear | `extension/content/content.js` → `init()` |
| Panel closes on SPA nav | `extension/content/content.js` → `panelWasOpen` logic |
| Wrong fields detected | `extension/content/form-detector.js` → `identify()` |
| Fill doesn't work | `extension/content/content.js` → `fillPersonal()` |
| AI answers fail | `extension/content/content.js` → `fillAIQuestions()` |
| Styles wrong on Oracle | `extension/content/content.css` |
| Model dropdown broken | `extension/options/options.js` |
| Resume extraction fails | `extension/options/options.js` → `runExtraction()` |

**Edit → Save → Reload page → Test.** No extension reload needed.
