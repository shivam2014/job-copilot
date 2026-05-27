# Session Start — Job Copilot

> Read this file first at the beginning of EVERY session. It contains the startup
> checklist and critical context that prevents the AI from repeating past mistakes.

## Before Doing Anything

### 1. Check handoff/ directory
```bash
ls -lt handoff/  # most recent handoff file first
```
Read the most recent handoff file for session state, blockers, and next steps.

### 2. Check circuit breaker state
```bash
cat /tmp/jc-cdp-circuit.json 2>/dev/null || echo "No circuit state (fresh start)"
```
If circuit is OPEN, find out why before attempting any CDP commands.

### 3. Verify bridge is alive
```bash
curl -s http://127.0.0.1:9222/json/version
```
If this fails → bridge is down. Don't try CDP tools yet.
If it succeeds → circuit breaker will auto-transition to CLOSED.

### 4. Check what page is open
```bash
node scripts/cdp.mjs status
```

### 5. Read the documentation
- `GUIDE.md` — architecture, CDP tools, combobox strategy, circuit breaker pattern
- `HANDBOOK.md` — known blockers, fixed issues, remaining work

---

## Golden Rules (NEVER Violate)

1. **CDP bridge health first**: If a CDP command hangs, check bridge health with
   `curl -s http://127.0.0.1:9222/json/version`. Do NOT try 5+ workarounds.
   Report BRIDGE_DOWN immediately.

2. **Circuit breaker is not optional**: The circuit breaker in `scripts/cdp.mjs`
   and `scripts/cdp_adv.mjs` prevents silent hangs. If a result says
   `"error_type": "bridge_down"` — stop and ask the user to restart the bridge.
   Do NOT try to connect via a different method.

3. **Don't modify content.js to bypass dialogs**: The `confirm()` dialog is
   handled via CDP's `Page.handleJavaScriptDialog`, not by overriding
   `window.confirm`.

4. **Always check handoff/ first**: The handoff files contain the exact state
   from the previous session. Don't rediscover issues that are already documented.

5. **Structured results from CDP**: All CDP commands return `{status, value?,
   error?, error_type?, retryable?}` — parse these. Never treat CDP output as
   raw text.

6. **CDP insertText is unreliable on pipe mode**: `chrome.debugger.attach()` conflicts
   with `--remote-debugging-pipe`. For Oracle CX combobox fill, use the character-by-character
   typing or InputEvent approaches (Strategies 3-4 in the fallback chain). See RESEARCH.md
   for details on what real-world autofill extensions use.

---

## Quick Diagnostic Commands

```bash
# Bridge health
curl -s http://127.0.0.1:9222/json/version
curl -s http://127.0.0.1:9222/json

# CDP commands
node scripts/cdp.mjs status              # full state + circuit info
node scripts/cdp.mjs eval "expr"         # run JS on Oracle page
node scripts/cdp.mjs nav <url>           # navigate
node scripts/cdp.mjs list                # all CDP targets
node scripts/cdp.mjs click <x>,<y>       # CDP mouse click

# Circuit breaker
cat /tmp/jc-cdp-circuit.json             # current circuit state
rm -f /tmp/jc-cdp-circuit.json           # RESET circuit (start fresh)

# Extension reload
node scripts/reload_extension.mjs

# Syntax checks
node -c extension/content/content.js
node -c extension/content/form-detector.js
node -c extension/background/background.js
```

---

## Testing Protocol — How to Verify Extension Health

Before debugging a suspected fill failure, ALWAYS run this exact test:

### 1. Clear all fields
Click **Clear All Fields** in the JC panel. If the browser `confirm()` dialog appears, accept it (this clears the form to a blank slate).

### 2. Fill all
Click **Fill All** in the JC panel. Wait 3-5 seconds for the fill cycle to complete.

### 3. Inspect what filled vs what didn't
```bash
node scripts/cdp.mjs eval "
JSON.stringify(Array.from(document.querySelectorAll('input:not([type=\"file\"]):not([type=\"hidden\"]), select, textarea')).filter(el => el.offsetParent !== null).map(el => ({
  id: el.id,
  name: el.name,
  type: el.type,
  value: (el.value || '').substring(0, 30)
})), null, 2);
"
```

### 4. Diagnose
- **Filled correctly** → no action needed
- **Empty field** → check if `buildFillMap()` has the value, then check if `fillField()` is routing correctly (Oracle combobox vs text input)
- **Wrong value** → check `buildFillMap()` source order, check learned corrections
- **Field not found** → the field may be in a different SPA section (navigate to next page first)

### Golden Rule
Always test this way first. Do NOT guess or assume which fields are broken — let the data tell you.
