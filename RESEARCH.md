# Research: Autofill Extension Techniques for Oracle CX / Workday Forms

> Created: 2026-05-26
> Purpose: Inform the Job Copilot extension's fill strategies for Oracle CX (Knockout.js) and Workday (Angular) job application forms.

## Approach 1: Native Value Setter (Standard)

**Source**: [`Dev.to - FormFill Vault`](https://dev.to/ktg0215/i-built-a-chrome-extension-that-auto-fills-any-form-encrypted-no-cloud-3l90)

The most widely documented approach for filling React/Vue/Angular/Knockout forms from a Chrome extension. Direct DOM property setting (`el.value = x`) is intercepted by modern frameworks. The fix:

```javascript
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype, 'value'
)?.set;
nativeInputValueSetter?.call(el, value);
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
```

This bypasses the framework's value interceptor and calls the original browser-level setter directly, then fires the events the framework listens to.

## Approach 2: Character-by-Character Typing for Comboboxes

**Source**: [`MedaSivaManoj/workday-autofill-extension`](https://github.com/MedaSivaManoj/workday-autofill-extension) (GitHub, 19 commits, TypeScript+React)

This real-world Workday autofill extension uses this strategy for custom dropdown/combobox fields:

```typescript
async function handleCustomDropdown(inputEl: HTMLInputElement, value: string) {
  // Strategy 1: Click to open dropdown
  inputEl.focus();
  await sleep(100);
  inputEl.click();
  await sleep(300);

  // Strategy 2: Look for dropdown options
  let dropdownOptions = document.querySelectorAll(
    '[role="option"], [data-automation-id*="option"], li[role="option"]'
  );

  if (dropdownOptions.length === 0) {
    // Strategy 3: Type character-by-character to trigger autocomplete
    inputEl.value = "";
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(100);

    for (let i = 0; i < value.length; i++) {
      inputEl.value = value.substring(0, i + 1);
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(50);
    }
    await sleep(300);
    // Re-check for options
    dropdownOptions = document.querySelectorAll('[role="option"]');
  }

  // Strategy 4: Find matching option and click it
  // ... takes `valueLower`, does exact → startsWith → includes matching
}
```

Key insight: The progressive `value.substring(0, i+1)` typing approach triggers the autocomplete mechanism in Oracle CX and Workday comboboxes because each character dispatch is a real `input` event after a native setter call.

## Approach 3: Direct Knockout Observable Access

**Source**: [`StackOverflow - set knockout.js value programmatically from outside`](https://stackoverflow.com/questions/71866507/set-knockout-js-value-programatically-from-outside)

Two methods to bypass Knockout's binding without fighting DOM events:

```javascript
// Method A: Get viewmodel via ko.dataFor()
const viewModel = ko.dataFor(document.querySelector("input"));
viewModel.myObservable("New value");

// Method B: Get bindings programmatically
const bindings = ko.bindingProvider.instance.getBindings(
  myNode,
  ko.contextFor(myNode)
);
const boundValue = bindings.value;
boundValue("New value");
```

This is the most direct approach for Knockout. However, Oracle CX may not expose `ko` globally — it's bundled in their module system. Finding `ko` requires searching for it in the page's module scope.

## Approach 4: InputEvent Character-by-Character Typing

**Source**: Previous working code in Job Copilot's own `.bak` file

```javascript
for (const char of valueStr) {
  const cur = el.value;
  if (ns) ns.call(el, cur + char);
  el.value = cur + char;
  el.dispatchEvent(new InputEvent('input', {
    inputType: 'insertText', data: char, bubbles: true, cancelable: true,
  }));
  await new Promise(r => setTimeout(r, 30));
}
```

This dispatches real `InputEvent` objects with `inputType: 'insertText'` — browser-level events that frameworks cannot distinguish from real user typing. This is different from regular `Event('input')` because `InputEvent` carries actual input metadata that frameworks recognize as genuine.

## Approach 5: CDP chrome.debugger (Known Blocker)

**Source**: HANDBOOK.md (Job Copilot project docs)

```javascript
chrome.debugger.attach({ tabId }, '1.3', ...);
chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text: value });
```

**Problem**: Conflicts with `--remote-debugging-pipe` mode used by the CDP bridge. When CDP is already attached to the tab via the pipe, `chrome.debugger.attach()` fails silently. This is a documented known blocker.

## Fallback Chain Comparison

| Strategy | Permissions | Framework Bypass | CDP Pipe Conflict | Speed |
|----------|-------------|------------------|-------------------|-------|
| 1. DOM value + events | None | ❌ (intercepted) | N/A | Fast |
| 2. Native value setter | None | ✅ React/Vue/KO | N/A | Fast |
| 3. InputEvent per-char | None | ✅ All frameworks | N/A | Medium |
| 4. Character-by-char typing | None | ✅ Autocomplete | N/A | Medium |
| 5. `ko.dataFor()` | None | ✅ Knockout only | N/A | Fast |
| 6. CDP insertText | `debugger` | ✅ Browser-level | ❌ Broken | Slow |

## Structural Patterns from Other Extensions

### Workday Autofill Extension Architecture (from GitHub)
- **Content script** (`content.ts`): Main fill logic
- **Shared DOM utils** (`dom.ts`): `setInputValue()`, `setCheckbox()`, `clickByTexts()`
- **Field mapping** (`mapping.ts`): Label keyword → profile key (hundreds of mappings)
- **Storage** (`storage.ts`): Chrome storage wrapper
- **Types** (`types.ts`): Profile data types
- **Heuristic matching**: Checks `name`, `id`, `placeholder`, `aria-label`, `autocomplete`, `<label for>`, parent traversal

### FormFill Vault (from Dev.to article)
- AES-256-GCM encrypted local storage
- Native value setter for React/Vue compatibility
- Regex-based field matching with multi-language support (Japanese kanji+katakana)
- Profile-based (multiple named profiles)

## Recommended Implementation for Job Copilot

### Text Inputs / Textareas
1. DOM value + events (fast, works for basic inputs)
2. Native value setter + events (bypasses React/Vue/KO interceptors)
3. (if Oracle CX field) CDP insertText via bridge (only if bridge not in pipe mode)

### Oracle CX Comboboxes (country, phone CC, month, year, employer country)
1. DOM click + option select (if Knockout accepts clicks)
2. **Character-by-character typing** (progressive `value.substring(0, i+1)` + `input` events)
3. **InputEvent per-character** (with `inputType: 'insertText'`)
4. Native value setter + Enter (bypasses value interceptor)
5. CDP insertText (if available, blocked on pipe mode)

### Date Fields (Oracle CX month/year comboboxes)
- Month values need conversion from number ("3") to month name ("Mar") or zero-padded ("03")
- Year values need 4-digit format
- Same combobox strategy as above

### Date Achieved (Education)
- Maps from education `end_date` or `start_date`
- Uses same month/day/year combobox strategy

### Checkboxes
- Current: `el.checked = val` + dispatch `change`
- Need: Verify Knockout detects the change (may need native setter equivalent)

### Section Navigation (Experience/Education)
- Current: Find "Add Experience" / "Add Education" button, click, wait
- Workday Extension pattern: Count existing sections, click add until count matches data length

---

## Sources

| # | Source | URL | Key Finding |
|---|--------|-----|-------------|
| 1 | Workday Autofill Extension (GitHub) | https://github.com/MedaSivaManoj/workday-autofill-extension | `handleCustomDropdown()` with character-by-character typing; `setInputValue()` with native setter |
| 2 | FormFill Vault (Dev.to) | https://dev.to/ktg0215/i-built-a-chrome-extension-that-auto-fills-any-form-encrypted-no-cloud-3l90 | Native value setter for React/Vue; heuristic field matching |
| 3 | StackOverflow: Knockout programmatic set | https://stackoverflow.com/questions/71866507/set-knockout-js-value-programatically-from-outside | `ko.dataFor()` and `ko.bindingProvider.instance.getBindings()` |
| 4 | Job Copilot .bak (existing codebase) | `extension/content/form-detector.js.bak` | InputEvent per-character typing as Fallback 1 |
| 5 | MDN: Object.getOwnPropertyDescriptor | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/getOwnPropertyDescriptor | Native value setter technical reference |
| 6 | StackOverflow: React value setter | https://stackoverflow.com/questions/78781394/the-object-getownpropertydescriptor-or-the-valuetracker-dont-work-how-to-emul | React native value setter confirmation |
| 7 | SearXNG search results | `localhost:8888` via camofox-browser | Aggregated from DuckDuckGo, Google |
