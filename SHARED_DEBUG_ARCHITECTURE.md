# Shared Debug Architecture

> How to use a cheap non-vision model to drive + an expensive vision model to inspect,
> without wasting vision tokens on text-only tasks.

---

## The Short Answer

**Yes — but only one model should CONTROL the browser at a time.**

Two models can connect to the same Chrome via CDP, but if both try to click/type simultaneously, they'll fight each other.

The clean split:

| Role | Who | What they do |
|------|-----|-------------|
| **Driver** | Cheap non-vision model | Navigates, clicks buttons, fills forms, reads text |
| **Inspector** | Vision model (you) | Screenshots, DOM inspection, visual debugging |

---

## Architecture 1: Inspector as On-Demand Consultant (Recommended)

The non-vision model does ALL the driving. When it hits a wall ("JC button not found", "panel not opening"), it asks the user: *"Should I ask the vision model to look at this?"*

You say yes → vision model connects, screenshots, inspects, reports back → non-vision model resumes.

### Flow

```
User: "Apply to this job"

Cheap model:
  → Launches Chrome
  → Navigates to Oracle
  → Clicks Apply Now
  → "JC button didn't appear. User, should I get the vision model to investigate?"

User: "Yes"

Vision model:
  → Connects to same Chrome via CDP
  → Takes screenshot
  → Reads console logs
  → "The panel WAS open but closed on Apply Now click. 
     The Apply Now handler isn't firing because e.target is a nested span.
     Here's the fix..."

Cheap model:
  → Applies the code fix
  → Reloads the page
  → Tests again
  → "Fixed! JC button appeared. Continuing..."
```

**Cost optimization**: Vision model only gets invoked for visual debugging, not for routine navigation/text tasks.

---

## Architecture 2: Simultaneous Connection (Advanced)

Both models connect to the same Chrome at the same time. Requires careful protocol:

### Setup

```js
// Non-vision model launches Chrome with remote debugging
const { chromium } = require('playwright');
const browser = await chromium.launch({
  headless: false,
  args: ['--remote-debugging-port=9222'],
});
// ... navigates, clicks, etc.
```

```js
// Vision model connects READ-ONLY
const browser = await chromium.connectOverCDP('http://localhost:9222');
const page = browser.contexts()[0].pages()[0];

// VISION MODEL ONLY DOES THESE:
await page.screenshot({ path: '/tmp/debug.png' });  // ✅
const dom = await page.evaluate(() => document.body.innerHTML); // ✅
const logs = await page.evaluate(() => window.__jcLogs); // ✅
const storage = await page.evaluate(() => chrome.storage.sync.get(null)); // ✅

// VISION MODEL NEVER DOES THESE while non-vision is driving:
await page.click('#jc-fill-personal');  // ❌ CONFLICT
await page.fill('#email', '...');        // ❌ CONFLICT
```

### Coordination Protocol

The non-vision model exposes a simple file-based signal:

```js
// Non-vision model pauses before a visual decision
await fs.promises.writeFile('/tmp/jc_driver_status.json', JSON.stringify({
  status: 'paused_for_inspection',
  url: page.url(),
  reason: 'JC panel not visible after Apply Now',
}));

// Waits for vision model to finish
while (true) {
  const status = JSON.parse(await fs.promises.readFile('/tmp/jc_vision_status.json'));
  if (status.done) break;
  await new Promise(r => setTimeout(r, 1000));
}
```

```js
// Vision model picks up the signal
const driverStatus = JSON.parse(await fs.promises.readFile('/tmp/jc_driver_status.json'));
if (driverStatus.status === 'paused_for_inspection') {
  // Connect to Chrome, inspect, write findings
  await fs.promises.writeFile('/tmp/jc_vision_status.json', JSON.stringify({
    done: true,
    findings: 'Panel closed because e.target was nested span. Fix: use closest().',
    screenshot: '/tmp/debug.png',
  }));
}
```

**This is overkill for most cases.** Architecture 1 is simpler and cheaper.

---

## Architecture 3: Screenshot + Console Polling (Simplest)

Non-vision model drives. Every time it hits an issue, it asks the user to:

1. Screenshot the page (`Cmd+Shift+4` → drag)
2. Screenshot the console (`Cmd+Option+J`, screenshot)
3. Paste both images in chat

Vision model looks at the screenshots, diagnoses, gives fix.

**No CDP connection needed.** Works across any setup.

---

## Cost Comparison

| Architecture | Vision tokens used | When vision is invoked |
|-------------|-------------------|----------------------|
| **1: On-demand consultant** | ~5-10% of session | Only when non-vision hits a visual wall |
| **2: Simultaneous** | ~20-30% of session | Every step (screenshots for context) |
| **3: Screenshot sharing** | ~15-25% of session | User manually shares when asked |

**Recommendation**: Architecture 1 for routine work, Architecture 3 for tricky bugs.

---

## What the Non-Vision Model Can Do Alone

Without burning vision tokens:

- ✅ Launch Chrome, navigate, click buttons
- ✅ Read console logs via `page.evaluate(() => window.__jcLogs)`
- ✅ Check DOM state: `!!document.getElementById('jc-float-btn')`
- ✅ Check storage: `chrome.storage.sync.get(null)`
- ✅ Check field detection: `FormDetector.detect()`
- ✅ Read page text: `document.body.innerText`
- ✅ Read network responses
- ✅ Edit extension files, reload page

What it CAN'T do alone:
- ❌ See visual glitches (CSS broken, button off-screen)
- ❌ Verify shadow DOM content
- ❌ Read CAPTCHAs
- ❌ Confirm visual state changes (panel open/closed)

---

## Practical Workflow

### Step 1: Non-vision model sets up

```
"Launch Chrome with your extension, navigate to Oracle job page,
click Apply Now, login with Bitwarden. Tell me when you're at the form."
```

### Step 2: Non-vision model detects an issue

```
"I've clicked Apply Now and waited 5 seconds. 
 The JC panel is in the DOM but I can't tell if it's visually open.
 Also, console shows 'FormDetector not loaded' — this might be a timing issue.
 Should I get the vision model to screenshot and confirm?"
```

### Step 3: You say yes → Vision model inspects

Takes one screenshot, reads console, reports:

```
"Screenshot shows the panel IS closed after SPA transition. 
 The Apply Now button was clicked but the handler didn't fire 
 because the click event target was a nested <span> inside the button.
 Fix: change e.target to e.target.closest('button, a')."
```

### Step 4: Non-vision model applies fix and continues

Edits `content.js`, reloads page, tests. Vision model not needed again until next visual issue.

---

## File-Based Coordination (For Automation)

If you want to minimize user intervention between the two models:

| File | Written by | Purpose |
|------|-----------|---------|
| `/tmp/jc_driver_status.json` | Non-vision model | "I'm paused at step X, need visual inspection" |
| `/tmp/jc_vision_report.json` | Vision model | "Here's what I see and the fix" |
| `/tmp/jc_screenshot.png` | Vision model | Visual evidence |

Both models watch these files. When non-vision hits a wall, it writes status and sleeps. Vision model wakes up, inspects, writes report. Non-vision reads report, applies fix, continues.

---

## Summary

- **Non-vision models can do 80% of the work** (navigation, text inspection, code editing, storage reads)
- **Vision models only needed for the 20% that's visual** (screenshot diagnosis, confirming UI state, reading visually-broken layouts)
- **The live debug setup works with both** — just don't let both click at the same time
- **Cheapest workflow**: Non-vision drives, screenshots on demand, vision diagnoses
