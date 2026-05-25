# Guide — Job Copilot Session Workflow

> How we launch, debug, and iterate. Compact version.

## Launch

```bash
cd ~/job-copilot
bash scripts/dev_launch.sh
```

This uses `--remote-debugging-pipe` + `Extensions.loadUnpacked` (Chrome 148 killed `--load-extension`). Requires `chrome://inspect/#remote-debugging` toggle ON.

## CDP Tool

```bash
pi install git:github.com/pasky/chrome-cdp-skill@v1.0.2
scripts/cdp.mjs list                    # list pages (target = unique prefix)
scripts/cdp.mjs eval <tgt> "expr"      # run JS
scripts/cdp.mjs click <tgt> "selector" # click element
scripts/cdp.mjs nav <tgt> "url"        # navigate
scripts/cdp.mjs type <tgt> "text"      # type text
scripts/cdp.mjs html <tgt> [sel]       # get HTML
scripts/cdp.mjs clickxy <tgt> <x> <y>  # click at coordinates
```

**Note:** cdp tool daemon crashes on Oracle SPA pages (console flood kills `Runtime.enable`). For Oracle form pages, use the workaround below or direct bridge CDP.

## Oracle SPA CDP Workaround

Oracle's Knockout SPA floods the CDP with console events, making `Runtime.evaluate` time out. Fix: suppress console before page loads.

```js
// Create blank tab → enable Runtime → suppress console → navigate to Oracle
Target.createTarget { url: "about:blank" }
Runtime.enable  // on blank page (no noise)
Page.addScriptToEvaluateOnNewDocument { source: "console.log=()=>{};..." }
Page.navigate { url: "https://...oracle.../apply/section/1" }
// Wait 15s, then evaluate
```

## Debugging Oracle Pages

- Oracle uses **Knockout.js** — DOM value changes don't update observables. Use CDP `click`/`clickxy` instead of `eval` for form submissions when possible.
- Content script runs in **MV3 isolated world** — `FormDetector` not accessible from `Runtime.evaluate`. Check DOM effects instead (filled field values, button presence).
- Oracle comboboxes (`.cx-select-input`, `role="combobox"`) ignore `el.value =`. Handle via `fillOracleCombobox()` in `form-detector.js`.

## Key Files

| File | What |
|------|------|
| `extension/content/content.js` | Auto-fill, panel, learning system |
| `extension/content/form-detector.js` | Field identification, Oracle combobox |
| `scripts/launch_with_ext.mjs` | Chrome launch + CDP pipe bridge |
| `extension/background/background.js` | Service worker, PDF extraction |

## Syntax Checks

```bash
node -c extension/content/content.js
node -c extension/content/form-detector.js
node -c extension/background/background.js
node -c lib/llm-client.js
```

## Reload Extension

In the running Chrome: `chrome://extensions` → click refresh on JC. Or via CDP:
```
chrome.developerPrivate.reload('nbpeoddibjhngmomojgpeoiceocnoknn')
```
