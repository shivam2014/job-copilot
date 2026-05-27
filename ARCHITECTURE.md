# Job Copilot — Architecture Map

> Simplified 3-interaction model: Fill All, per-field button, Clear All.
> 2033 total lines across 7 files (was 3100+ before simplification).

---

## File Map

```
extension/
├── manifest.json              (33 lines)   ← Chrome MV3 manifest
├── background/
│   └── background.js          (126 lines)  ← Service worker: PDF extraction, LLM profile extraction
├── content/
│   ├── content.js             (697 lines)  ← Main brain: UI, fill logic, learning, SPA handling
│   ├── form-detector.js       (773 lines)  ← Field detection engine + fill strategy chain
│   └── content.css            (184 lines)  ← Floating button, panel, per-field button styles
├── popup/
│   ├── popup.html             (62 lines)   ← Extension popup UI
│   └── popup.js               (123 lines)  ← Popup logic: Fill All / Clear All
├── lib/
│   └── llm-client.js          (68 lines)   ← OpenAI-compatible API wrapper
└── options/
    ├── options.html                        ← Settings page
    └── options.js                          ← Settings logic
```

---

## content.js — Section Map (697 lines)

```
LINES   SECTION                         PURPOSE
─────   ──────────────────────────────  ──────────────────────────────────────
  1-5   Header                          File doc + "3 interactions only" principle
  6-9   State                           detectedFields, jcPanel, panelWasOpen
 11-36  SPA Navigation Handler          Re-inject buttons after Apply/Next/Continue
 38-62  Main Init                       Wait 1.5s → detect → inject buttons (NO auto-fill)
 63-88  injectFloatingButton()          Creates #jc-float-btn + panel, outside-click close
 90-138 createPanel()                   Panel HTML + Fill All / Clear All click handlers
139-163 updatePanel()                   Re-detect fields, update stat counts in panel
165-194 injectPerFieldButtons()         Inject "F" button next to every detected field
196-252 fillSingleField(field)          Fill ONE field: textarea→LLM, input→profile
254-288 fillPersonal()                  Fill All → personal fields + selects from profile
290-342 fillAIQuestions()               Fill All → textareas via LLM
344-383 fillLearnedRadios()             Fill All → radio buttons from learned corrections
384-426 buildFillMap()                  Parse profile_name/email/phone/address → value map
427-436 skipFieldForType()              Type-safety guard (URL field ← phone value → skip)
437-462 listenForCorrections()          Attach blur listeners → learn user edits
463-473 saveLearnedCorrection()         Persist correction to chrome.storage.sync
474-567 clearForm()                     Clear all: inputs, pills, combos, tiles, checkboxes
568-592 extractJobDescription()         Scrape JD from page DOM for LLM context
593-619 showStatus() + makeStatusClickable()  Status bar in panel
620-635 saveAnswer()                    Bank of Q&A pairs (max 50)
636-666 Message Listener               Responds to: jc_fill_all, jc_clear_form, jc_get_fields, jc_ping
668-696 SPA Observer (MutationObserver) Re-inject buttons on DOM changes (NO auto-fill)
697     init()                          Start
```

---

## form-detector.js — Section Map (773 lines)

```
LINES   SECTION                         PURPOSE
─────   ──────────────��────────��──────  ──────────────────────────────────────
  1-8   Header                          "Core detection + filling engine"
  9-180 fieldPatterns                   Pattern→profile key mapping (name, email, phone, ...)
181-220 fieldPatterns (cont.)           Experience/education patterns (employerName, major, ...)
221-230 personalFieldTypes              ['text','email','tel','url','number']
231-300 detect()                        Scan inputs/textareas/selects → {personal, questions, files, selects}
301-430 identify()                      Score element against patterns (label 4x, autocomplete 3x, ...)
431-445 isPersonalField()               Check if name is a known personal field type
446-460 isOracleCXField()               Check if element is inside Oracle CX container
461-480 fillField()                     ROUTER: select→fillSelect, oracle→fillOracleCombobox, else→fillTextInput
481-530 fillSelect()                    4-phase select matching: exact → startsWith → word-boundary → includes
531-610 fillTextInput()                 4-strategy text fill: DOM → native setter → char-by-char → InputEvent
611-660 injectAIButton()                (Legacy) sparkle button for textareas — now replaced by per-field buttons
661-773 fillOracleCombobox()            4-strategy Oracle combobox fill: DOM click → setter → char-by-char → InputEvent
```

---

## Data Flow — Fill All

```
User clicks "Fill All"
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  window.__jcFilling = true                                  │
│  (blocks MutationObserver from re-injecting during fill)    │
└─────────────────────────────────────────────────────────────┘
        │
        ├──► fillPersonal()
        │       │
        │       ├── FormDetector.detect()          → find all fields
        │       ├── buildFillMap()                  → profile → {first_name, email, phone, ...}
        │       ├── chrome.storage.sync('learned_fields')  → merge corrections
        │       │
        │       └── for each field:
        │               ├── skipFieldForType()      → type-safety check
        │               ├── FormDetector.fillField() → route to strategy chain
        │               └── listenForCorrections()  → blur → learn if user edits
        │
        ├──► fillAIQuestions()
        │       │
        │       ├── chrome.storage.sync('resume_text')  → get resume
        │       ├── extractJobDescription()              → scrape JD from page
        │       │
        │       └── for each textarea:
        │               ├── LLMClient.generateAnswer(question, jd, resume)
        │               ├── FormDetector.fillField()
        │               └── saveAnswer()                 → bank Q&A pair
        │
        ├──► fillLearnedRadios()
        │       │
        │       └── for each radio group:
        │               ├── Find question text from DOM
        │               ├── Look up 'radio_<question>' in learned_fields
        │               └── Match + check radio button
        │
        └──► window.__jcFilling = false
```

---

## Data Flow — Per-Field Button

```
User hovers field → "F" button appears
        │
        ▼
User clicks "F"
        │
        ▼
┌──────────────────────────────────────┐
│  fillSingleField(field)              │
└──────────────────────────────────────┘
        │
        ├── Is it a textarea?
        │       YES → LLMClient.generateAnswer()
        │             FormDetector.fillField()
        │             saveAnswer()
        │
        └── Everything else:
                ├── buildFillMap()
                ├── merge learned_fields
                ├── lookup fillMap[field.name]
                ├── skipFieldForType() check
                ├── FormDetector.fillField()
                └── listenForCorrections()
```

---

## FormDetector.fillField() — Strategy Router

```
fillField(field, value)
        │
        ├── <select>?        → fillSelect()       [4-phase option matching]
        │
        ├── file input?      → return false        [can't programmatically set]
        │
        ├── Oracle combobox? → fillOracleCombobox() [4-strategy Knockout chain]
        │       │
        │       ├── Strategy 1: DOM click → find dropdown option → click it
        │       ├── Strategy 2: Native setter + Enter + 300ms async verify
        │       ├── Strategy 3: Char-by-char typing (30ms intervals)
        │       └── Strategy 4: InputEvent per-character (last resort)
        │
        └── Everything else  → fillTextInput()     [4-strategy chain]
                │
                ├── Strategy 1: Direct DOM value + input/change events
                ├── Strategy 2: Native prototype setter (bypasses React/Vue)
                ├── Strategy 3: Char-by-char typing (Oracle CX only)
                └── Strategy 4: InputEvent per-character (Oracle CX only)
```

---

## Storage Schema (chrome.storage.sync)

```
profile_name              → "Shivam Bhalla"
profile_email             → "shivam@example.com"
profile_phone             → "+33-753788537"
profile_linkedin          → "https://linkedin.com/in/..."
profile_github            → "https://github.com/..."
profile_website           → "https://..."
profile_address           → "Street, City, Poland"
profile_work_authorization → "Yes" / "No"

llm_base_url              → "http://localhost:19530/v1"
llm_api_key               → "dummy"
llm_model                 → "deepseek-v4-flash-2"

resume_text               → (full resume text)
resume_full_data          → (JSON with rawSections: experience, education, skills)

learned_fields            → { "phone": "+33753788537", "radio_<question>": "Yes", ... }
saved_answers             → [{ question, answer, date }, ...]  (max 50)
```

---

## Message Protocol

```
Content Script ← Popup / Background:

  jc_fill_all        → fillPersonal + fillAIQuestions + fillLearnedRadios
  jc_clear_form      → clearForm()
  jc_get_fields      → returns FormDetector.detect() result
  jc_ping            → returns { ok: true }

Content Script → Background:

  jc_fields_detected → { count }  (notify popup of field count)
  jc_open_options    → open extension options page

Background handles:

  extract_pdf_text              → PDF → text via pdf.js
  extract_profile_from_text     → resume text → LLM → structured profile JSON
```

---

## Key Guard Patterns

```
window.__jcFilling    → Set true during Fill All / Clear All.
                        MutationObserver checks this and skips re-injection.

panelWasOpen          → Persists panel open/close state across SPA transitions.

jc-field-wrapper      → CSS class on per-field button wrapper.
                        injectPerFieldButtons() skips already-wrapped fields.

el.dataset.jcFilled   → Tag: "JC filled this field".
                        listenForCorrections() uses this to know the original value.

el.dataset.jcValue    → The value JC set. Compared against on blur to detect user edits.
```
