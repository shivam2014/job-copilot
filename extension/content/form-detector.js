// ═══════════════════════════════════════════════════════════════
// Form Detector — THE DETECTION AND FILL ENGINE
// ═══════════════════════════════════════════════════════════════
//
// FILE ROLE:
//   This file is the pure engine. It has two responsibilities:
//   1. DETECTION: identify what fields exist on the page and what they are
//   2. FILLING: take a field and a value, and make the value stick
//
// WHY THIS FILE EXISTS SEPARATELY:
//   This file has no opinions about UI, timing, storage, or user interaction.
//   It doesn't know about the panel, the popup, the learning system, or the
//   SPA observer. Content.js (the orchestrator) decides WHEN to call it and
//   WHAT data to feed it. This separation means you can test the fill engine
//   against mock DOMs without needing Chrome storage or the panel.
//
// DETECTION FLOW (Steps 2-3 in the execution trace):
//   detect() scans every <input>, <textarea>, <select> on the page.
//   For each element, identify(el) reads six sources (label, autocomplete,
//   aria-label, name, id, placeholder), runs them against fieldPatterns
//   using weighted word-boundary regex scoring, and returns the field identity.
//
// FILL FLOW (Steps 6-7 in the execution trace):
//   fillField(field, value) inspects the element type and routes:
//     <select>           → fillSelect()         (4-phase option matching)
//     Oracle combobox    → fillOracleCombobox()  (4-strategy Knockout chain)
//     everything else    → fillTextInput()       (4-strategy chain)
// ═══════════════════════════════════════════════════════════════

// ── Trace logging (toggle via FormDetector.trace = true/false) ─────
// Set to true to see JC-TRACE logs in console. Default: off.
// Toggle from console: FormDetector.trace = true
// Toggle from popup:   chrome.storage.sync.set({jc_trace: true})
let _traceEnabled = false;
function _trace(msg) {
  // Check both internal flag and window.__jcTrace (settable from page world)
  if (_traceEnabled || window.__jcTrace) console.log(msg);
}

// Load trace setting from storage on init
try { chrome.storage.sync.get('jc_trace', d => { _traceEnabled = !!d.jc_trace; }); } catch(_) {}

const FormDetector = {
  // Expose trace toggle
  get trace() { return _traceEnabled; },
  set trace(v) { _traceEnabled = !!v; try { chrome.storage.sync.set({jc_trace: _traceEnabled}); } catch(_) {} },

  // ── Step 3: The pattern dictionary ─────────────────────────────
  // This is the dictionary that identify() scores against.
  // Keys are profile field names (what buildFillMap() in content.js returns).
  // Values are arrays of strings that might appear in a field's label, name,
  // id, or autocomplete attribute. To support a new field type, add one entry here.
  fieldPatterns: {
    name: [
      'name',
      'applicant.name', 'candidate.name',
    ],
    first_name: [
      'firstname', 'first-name', 'first_name', 'first name',
      'given-name', 'given name', 'givenname',
    ],
    last_name: [
      'lastname', 'last-name', 'last_name', 'last name',
      'family-name', 'family name', 'familyname',
      'surname',
    ],
    middle_name: [
      'middlename', 'middle-name', 'middle_name', 'middle name',
      'middlenames',
      'additional-name', 'middle initial',
    ],
    full_name: [
      'fullname', 'full-name', 'full_name', 'full name',
    ],
    email: [
      'email', 'e-mail', 'emailaddress', 'email_address',
      'applicant.email', 'candidate.email',
    ],
    phone: [
      'phone', 'telephone', 'tel', 'phonenumber', 'phone-number', 'phone_number', 'phone number',
      'mobile', 'cell',
      'applicant.phone', 'candidate.phone',
    ],
    phone_country_code: [
      'phonecountrycode', 'phone-country-code', 'phone_country_code',
      'countrycode', 'country-code', 'country_code',
      'country code',  // Oracle: label "Country code"
      'phonecc', 'phone-cc',
      'phone_country',
      'phone country code',
    ],
    linkedin: [
      'linkedin', 'linkedinurl', 'linkedin-url', 'linkedin_url',
      'linkedinprofile', 'linkedin_profile',
    ],
    github: [
      'github', 'githuburl', 'github-url', 'github_url',
      'githubprofile', 'github_profile',
    ],
    website: [
      'website', 'portfolio', 'personalwebsite', 'personal_website',
      'url', 'webpage',
    ],
    address: ['address'],
    street_address: [
      'street', 'streetaddress', 'street_address', 'street address',
      'address-line1', 'address line 1', 'addressline1',
    ],
    street_address2: [
      'address-line2', 'addressline2', 'address line 2',
    ],
    apt_number: [
      'apt', 'apt.', 'apt number', 'apt_number', 'apt-number',
      'apartment', 'apartment number', 'suite', 'unit',
      'address line 3', 'addressline3',
    ],
    city: [
      'city', 'town', 'address-level2',
    ],
    state: [
      'state', 'province', 'region', 'region1', 'region2', 'address-level1',
    ],
    postal_code: [
      'postal', 'postalcode', 'postal-code', 'postal code',
      'zip', 'zipcode', 'zip-code', 'zip code',
    ],
    country: ['country', 'nation'],
    resume: [
      'resume', 'cv', 'upload-cv', 'uploadcv', 'upload_cv',
      'file', 'attachment', 'document',
    ],
    cover_letter: [
      'coverletter', 'cover-letter', 'cover_letter', 'cover letter',
      'coverlettertext', 'cover_letter_text',
    ],
    work_authorization: [
      'workauth', 'work-authorization', 'work_authorization', 'work authorization',
      'visa', 'sponsorship', 'workpermit', 'work_permit',
      'authorized', 'legallyauthorized', 'legally_authorized',
    ],
    gender: [
      'gender', 'sex',
    ],
    veteran: [
      'veteran', 'military', 'veteranstatus',
    ],
    disability: [
      'disability', 'disabilitystatus',
    ],
    race: [
      'race', 'ethnicity', 'racial',
    ],
    hispanic: [
      'hispanic', 'latino', 'hispaniclatino',
    ],
    employer_name: [
      'employername', 'employer-name', 'employer_name', 'employer name',
      'companyname', 'company-name', 'company_name', 'company name',
      'organization', 'organisation',
    ],
    company_name: [
      'companyname', 'company-name', 'company_name', 'company name',
    ],
    start_month: ['startmonth', 'start-month', 'start_month', 'start month', 'monthstart', 'month-start', 'month-startdate'],
    start_year: ['startyear', 'start-year', 'start_year', 'start year', 'yearstart', 'year-start', 'year-startdate'],
    end_month: ['endmonth', 'end-month', 'end_month', 'end month', 'monthend', 'month-end', 'month-enddate'],
    end_year: ['endyear', 'end-year', 'end_year', 'end year', 'yearend', 'year-end', 'year-enddate'],
    job_title: ['jobtitle', 'job-title', 'job_title', 'job title', 'title', 'position'],
    responsibilities: ['responsibilities', 'responsibility', 'description', 'job description', 'work description', 'role description', 'summary'],
    month_start_date: ['month-startdate', 'month-start-date', 'month_start_date', 'month start date', 'startdatemonth', 'start-date-month'],
    year_start_date: ['year-startdate', 'year-start-date', 'year_start_date', 'year start date', 'startdateyear', 'start-date-year'],
    month_end_date: ['month-enddate', 'month-end-date', 'month_end_date', 'month end date', 'enddatemonth', 'end-date-month'],
    year_end_date: ['year-enddate', 'year-end-date', 'year_end_date', 'year end date', 'enddateyear', 'end-date-year'],
  },

  // Field types that map to profile values
  personalFieldTypes: ['text', 'email', 'tel', 'url', 'number'],

  // ── Step 2: Field detection ─────────────────────────────────────
  // Called by content.js init(), fillPersonal(), fillAIQuestions(), and the
  // SPA observer. Scans every <input>, <textarea>, <select> on the page.
  // For each element, calls identify(el) to determine what it is.
  // Sorts results into four buckets: personal, questions, selects, files.
  detect() {
    const fields = {
      personal: [],    // name, email, phone, etc.
      questions: [],   // textareas (custom questions)
      files: [],       // file uploads
      selects: [],     // dropdown menus
      unknown: [],     // other fields
    };

    const forms = document.querySelectorAll('form');
    const inputs = document.querySelectorAll('input, textarea, select');

    inputs.forEach(el => {
      const field = this.identify(el);
      if (!field) return;

      if (el instanceof HTMLTextAreaElement) {
        // Check if it's a known personal field or custom question
        if (this.isPersonalField(field.name)) {
          fields.personal.push(field);
        } else {
          fields.questions.push(field);
        }
      } else if (el instanceof HTMLSelectElement) {
        fields.selects.push(field);
      } else if (el.type === 'file') {
        fields.files.push(field);
      } else if (this.personalFieldTypes.includes(el.type) || !el.type) {
        if (field.name !== 'unknown') {
          fields.personal.push(field);
        } else {
          fields.unknown.push(field);
        }
      } else {
        fields.unknown.push(field);
      }
    });

    return fields;
  },

  // ── Step 3: The scoring game ────────────────────────────────────
  // Takes one DOM element. Reads six sources from it:
  //   label text (weight 4), autocomplete (3), aria-label (2), name (1), id (1), placeholder (1)
  // Concatenates all non-empty sources. For each pattern in fieldPatterns,
  // runs a word-boundary regex test against each source with its weight.
  // Score = (weight × 100) + pattern_length. Highest total score wins.
  // Returns: {name: "email", label: "Email", el: the element, ...}
  identify(el) {
    const name = (el.name || '').toLowerCase().trim();
    const id = (el.id || '').toLowerCase().trim();
    const placeholder = (el.placeholder || '').toLowerCase().trim();
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase().trim();
    const autocomplete = (el.autocomplete || '').toLowerCase().trim();

    // Get label text
    let labelText = '';
    if (el.labels && el.labels.length > 0) {
      labelText = el.labels[0].textContent.toLowerCase().trim();
    } else {
      // Try finding label by 'for' attribute
      const labelEl = document.querySelector(`label[for="${el.id}"]`);
      if (labelEl) labelText = labelEl.textContent.toLowerCase().trim();
    }

    // Try finding parent with label — includes Oracle/Workday ATS CSS patterns
    if (!labelText) {
      const parent = el.closest('.field, .form-group, .question, [class*="field"], [class*="form-"], .input-row, [class*="oj-"], [class*="apply-flow"], [class*="form-row"], [class*="ats-field"]');
      if (parent) {
        const labelEl = parent.querySelector('label, .label, [class*="label"], [class*="oj-label"]');
        if (labelEl) labelText = labelEl.textContent.toLowerCase().trim();
      }
    }

    // Additional fallback: look for any preceding span/div with label-like text
    if (!labelText) {
      // Walk up siblings to find a label-like element
      let prev = el.previousElementSibling;
      let tries = 0;
      while (prev && tries < 3) {
        const t = (prev.textContent || '').trim();
        if (t && !t.includes('\n') && t.length < 120 && !prev.querySelector('input, textarea, select')) {
          labelText = t.toLowerCase();
          break;
        }
        prev = prev.previousElementSibling;
        tries++;
      }
    }

    // Combine all identifiers
    const identifiers = [name, id, placeholder, ariaLabel, autocomplete, labelText]
      .filter(Boolean)
      .join(' ');

    // Classify — weighted scoring by source, then pattern length
    // Sources: labelText + autocomplete get higher weight than name/id
    let fieldName = 'unknown';
    let bestScore = 0;
    const namePartKeys = ['first_name', 'last_name', 'middle_name', 'full_name'];
    
    // Score helper: check a single source string against a pattern
    // Score a single source string against a pattern (word-boundary regex)
    function scoreMatch(src, pattern, srcWeight) {
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wordPattern = new RegExp('\\b' + escaped + '\\b', 'i');
      if (wordPattern.test(src)) {
        return srcWeight * 100 + pattern.length;
      }
      return 0;
    }
    
    // Pre-scan: does any name-part pattern match on labelText or autocomplete?
    let hasSpecificNamePart = false;
    for (const [profileKey, patterns] of Object.entries(this.fieldPatterns)) {
      if (!namePartKeys.includes(profileKey)) continue;
      for (const p of patterns) {
        const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wordPattern = new RegExp('\\b' + escaped + '\\b', 'i');
        const srcs = [labelText, autocomplete, ariaLabel].filter(Boolean);
        if (srcs.some(s => wordPattern.test(s))) {
          hasSpecificNamePart = true;
          break;
        }
      }
      if (hasSpecificNamePart) break;
    }
    
    for (const [profileKey, patterns] of Object.entries(this.fieldPatterns)) {
      for (const p of patterns) {
        // Check each source separately with different weights
        // Label text (weight 4) and autocomplete (weight 3) are most reliable
        // ariaLabel (weight 2), name (weight 1), id (weight 1)
        let totalScore = 0;
        totalScore += scoreMatch(labelText, p, 4);
        totalScore += scoreMatch(autocomplete, p, 3);
        totalScore += scoreMatch(ariaLabel, p, 2);
        totalScore += scoreMatch(name, p, 1);
        totalScore += scoreMatch(id, p, 1);
        totalScore += scoreMatch(placeholder, p, 1);
        
        // Penalize generic 'name' if a more specific name part also matches
        if (profileKey === 'name' && hasSpecificNamePart) {
          totalScore = 0; // generic 'name' yields to specific name parts
        }
        
        if (totalScore > bestScore) {
          fieldName = profileKey;
          bestScore = totalScore;
        }
      }
    }

    // [FIX] Context-aware field routing overrides.
    // These run AFTER the pattern scoring to handle edge cases where
    // the scoring alone can't disambiguate fields. Works across
    // Oracle CX, Workday, Greenhouse, Lever, and generic forms.

    // (a) Phone combobox → phone_country_code:
    // Oracle CX puts role="combobox" + name="phoneNumber" on the country
    // code selector, not the actual phone input. If a field has combobox
    // role and its identifiers match phone patterns, it's the country
    // code — route it to phone_country_code instead of phone.
    if (fieldName === 'phone' && el.getAttribute('role') === 'combobox') {
      fieldName = 'phone_country_code';
    }

    // (b) Unlabeled tel input → phone:
    // The actual phone number input on Oracle CX has type="tel" with no
    // name, no label, no aria-label. It sits next to the country code
    // combobox. Default it to "phone" so it gets filled with the local
    // number portion. This also works on Workday and generic forms where
    // a tel input without a label is always the phone field.
    if (fieldName === 'unknown' && el.type === 'tel') {
      fieldName = 'phone';
      bestScore = 50; // low confidence but better than skipping
    }

    // (c) Unmatched URL input → website:
    // Any URL-typed input on a job application form that didn't match
    // linkedin/github/website patterns is still likely a personal link.
    // Oracle CX uses name="siteLink-1" which doesn't contain "url" or
    // "website" as a word boundary. This fallback catches it.
    if (fieldName === 'unknown' && el.type === 'url') {
      fieldName = 'website';
      bestScore = 30;
    }

    // (d) Prefer street_address over generic address when label/autocomplete
    //     clearly indicates address line 1. Generic "address" pattern scores
    //     higher because it matches on more sources (label, autocomplete, name)
    //     but "Address Line 1" label + "address-line1" autocomplete should map
    //     to street_address, not the generic address category.
    if (fieldName === 'address') {
      const addrLine1Pattern = /\b(address[-\s]?line[-\s]?1|addressline1)\b/i;
      if (addrLine1Pattern.test(autocomplete) || addrLine1Pattern.test(labelText)) {
        fieldName = 'street_address';
      }
      const addrLine2Pattern = /\b(address[-\s]?line[-\s]?2|addressline2)\b/i;
      if (addrLine2Pattern.test(autocomplete) || addrLine2Pattern.test(labelText)) {
        fieldName = 'street_address2';
      }
      const addrLine3Pattern = /\b(address[-\s]?line[-\s]?3|addressline3)\b/i;
      if (addrLine3Pattern.test(autocomplete) || addrLine3Pattern.test(labelText)) {
        fieldName = 'apt_number';
      }
    }

    return {
      el: el,
      name: fieldName,
      identifiers: identifiers,
      label: labelText || ariaLabel || placeholder || name || id,
      isRequired: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
      rect: el.getBoundingClientRect(),
    };
  },

  isPersonalField(name) {
    return ['name', 'first_name', 'last_name', 'middle_name', 'full_name',
            'email', 'phone', 'phone_country_code',
            'linkedin', 'github', 'website',
            'address', 'street_address', 'street_address2', 'apt_number', 'city', 'state', 'postal_code', 'country',
            'resume', 'cover_letter', 'work_authorization',
            'gender', 'veteran', 'disability', 'race', 'hispanic'].includes(name);
  },

  // Check if field is inside Oracle CX application flow
  isOracleCXField(el) {
  // Checks if element is inside Oracle CX container (.apply-flow, .cx-select, [class*=oj-]).
  // Used by fillTextInput() to decide whether to try Knockout-specific strategies.
    return el.closest('.apply-flow, .cx-select, [class*="oj-"]') !== null;
  },

  // ── Step 6: The router ──────────────────────────────────────────
  // Called by content.js for each field that needs filling.
  // Inspects the element type and routes to the right strategy.
  // This is the only entry point for filling — content.js never calls
  // the strategy functions directly.
  async fillField(field, value) {
    if (!field || !field.el) return false;
    const el = field.el;
    const valueStr = (value || '').trim();
    if (!valueStr) return false;

    el.focus();
    
    // ── SELECT (native dropdown) ────────────────────────────────
    if (el instanceof HTMLSelectElement) {
      return this.fillSelect(el, valueStr);
    }

    // ── FILE (cannot programmatically set) ──────────────────────
    if (el.type === 'file') return false;

    // ── ORACLE CUSTOM COMBOBOX ─────────────────────────────────
    // Only treat as combobox if it's NOT a plain text input without a toggle.
    // Some fields (like postalCode) have role="combobox" + are inside
    // .cx-select-container, but are actually text inputs with autocomplete.
    // These should use fillTextInput(), not fillOracleCombobox().
    // However, if the text input has a toggle button, it's a real combobox.
    const hasToggle = document.getElementById(el.id + '-toggle-button');
    if (this.isOracleCombobox(el) && (el.type !== 'text' || hasToggle)) {
      return await this.fillOracleCombobox(el, valueStr);
    }

    // ── TEXT INPUTS / TEXTAREAS: Fallback chain ────────────────
    return await this.fillTextInput(el, field, valueStr);
  },

  // ── Step 6a: Native <select> filling ───────────────────────────
  // A native <select> is a standard HTML dropdown. It has a fixed list of
  // <option> elements. Oracle uses these for some fields (e.g., country).
  // The value we have (e.g., "Poland") might not exactly match the option
  // text (e.g., "Poland" vs "Poland (+48)"). So we try four strategies:
  //   Phase 1: exact text match
  //   Phase 2: word-boundary regex match
  //   Phase 3: starts-with match
  // NOTE: No substring/includes match — causes false positives like
  //       "GUI" matching "Strategic Guidance".
  fillSelect(el, value) {
    const options = Array.from(el.options).filter(o => o.value !== '');
    const lowerValue = value.toLowerCase().trim();
    
    // Phase 1: exact match
    let match = options.find(o => 
      o.text.toLowerCase().trim() === lowerValue ||
      o.value.toLowerCase().trim() === lowerValue
    );
    
    // Phase 2: word-boundary regex
    if (!match) {
      const wordRegex = new RegExp('\\b' + lowerValue.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + '\\b', 'i');
      match = options.find(o => wordRegex.test(o.text) || wordRegex.test(o.value));
    }
    
    // Phase 3: starts with
    if (!match) {
      match = options.find(o =>
        o.text.toLowerCase().trim().startsWith(lowerValue) ||
        o.value.toLowerCase().trim().startsWith(lowerValue) ||
        lowerValue.startsWith(o.text.toLowerCase().trim())
      );
    }
    
    if (match) {
      el.value = match.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`JC: fillSelect → matched "${match.text}"`);
      return true;
    }
    console.log(`JC: fillSelect → no option for "${value}"`);
    return false;
  },

  // ── Step 7: Text input filling ──────────────────────────────────
  // Takes a text input element, its field metadata, and a target value.
  // Tries up to four strategies in order. First success wins.
  //
  // Strategy 1: Direct DOM assignment. Set el.value = "shivam@example.com"
  //   and dispatch input/change events. For most plain inputs, this works.
  //
  // Strategy 2: Native prototype setter. Modern frameworks (React, Vue,
  //   Angular) intercept el.value assignments. This uses the browser's
  //   original HTMLInputElement.prototype.value setter to bypass them.
  //
  // Strategy 3: Character-by-character typing (Oracle only). Oracle uses
  //   Knockout.js which clears values set by strategies 1 and 2. By typing
  //   one character at a time with input events after each, Knockout sees
  //   each change as a human keystroke and accepts it.
  //
  // Strategy 4: InputEvent per-character (Oracle only). Same as strategy 3
  //   but uses InputEvent with inputType='insertText' — a real browser-level
  //   event that no framework can distinguish from actual keyboard input.
  async fillTextInput(el, field, value) {
    const fieldLabel = field.label || field.name || 'field';
    const isOracle = this.isOracleCXField(el);
    
    if (isOracle) {
      // [FIX] Oracle CX: use paste approach (InputEvent insertFromPaste).
      // Much faster than char-by-char. Knockout accepts paste events.
      el.focus();
      console.log(`JC: fillField [${fieldLabel}] → Oracle CX, using paste`);
      try {
        el.focus();
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.value = value;
        el.dispatchEvent(new InputEvent('input', {
          inputType: 'insertFromPaste',
          data: value,
          bubbles: true,
          cancelable: true,
        }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
        await new Promise(r => setTimeout(r, 200));
        if (el.value === value) {
          console.log(`JC: fillField [${fieldLabel}] → paste OK`);
          return true;
        }
        console.log(`JC: fillField [${fieldLabel}] → paste: value didn't stick, falling back to char-by-char`);
      } catch(e) {
        console.log(`JC: fillField [${fieldLabel}] → paste error: ${e.message}, falling back`);
      }
      
      // Fallback: char-by-char
      try {
        el.focus();
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        for (let i = 0; i < value.length; i++) {
          el.value = value.substring(0, i + 1);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 20));
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
        if (el.value === value) {
          console.log(`JC: fillField [${fieldLabel}] → char-by-char fallback OK`);
          return true;
        }
      } catch(e) {
        console.log(`JC: fillField [${fieldLabel}] → char-by-char fallback error: ${e.message}`);
      }
      
      console.log(`JC: fillField [${fieldLabel}] → Oracle strategies failed`);
      return false;
    }
    
    // ── Non-Oracle strategies ────────────────────────────────
    // For plain inputs (Workday, Greenhouse, Lever, generic forms):
    //   Strategy 1: Direct DOM assignment + input/change events
    //   Strategy 2: Native prototype setter (bypasses framework interceptors)
    //
    console.log(`JC: fillField [${fieldLabel}] → non-Oracle, trying direct assignment`);
    
    // Strategy 1: Direct DOM assignment
    try {
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      await new Promise(r => setTimeout(r, 50));
      if (el.value === value) {
        console.log(`JC: fillField [${fieldLabel}] → direct assignment OK`);
        return true;
      }
      console.log(`JC: fillField [${fieldLabel}] → direct assignment failed (value='${el.value}'), trying native setter`);
    } catch(e) {
      console.log(`JC: fillField [${fieldLabel}] → direct assignment error: ${e.message}`);
    }
    
    // Strategy 2: Native prototype setter
    // Frameworks like React/Vue/Angular override the value property setter.
    // Using the original HTMLInputElement.prototype.value setter bypasses them.
    try {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      ).set;
      el.focus();
      nativeSetter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      await new Promise(r => setTimeout(r, 50));
      if (el.value === value) {
        console.log(`JC: fillField [${fieldLabel}] → native setter OK`);
        return true;
      }
      console.log(`JC: fillField [${fieldLabel}] → native setter failed (value='${el.value}')`);
    } catch(e) {
      console.log(`JC: fillField [${fieldLabel}] → native setter error: ${e.message}`);
    }
    
    console.log(`JC: fillField [${fieldLabel}] → ALL strategies failed`);
    return false;
  },
};

// ── Step 6b: Oracle combobox filling ──────────────────────────────
// An Oracle combobox is NOT a native <select>. It's a text input that
// Oracle's JavaScript turns into a dropdown. When you type in it, Oracle's
// code shows matching options. When you click an option, Oracle's code
// sets the value. These comboboxes use Knockout.js — a JavaScript framework
// that wraps input values in "observables" (reactive variables). Knockout
// actively monitors the input and clears any value that wasn't set through
// its own API. This is why strategies 1 and 2 from fillTextInput often fail.
//
// Four strategies are tried in order:
//   1. Click the combobox to open the dropdown, find the matching option
//      by text, click it. Works if Knockout renders the dropdown synchronously.
//   2. Set the value via native setter, dispatch Enter key, wait 300ms.
//      Knockout may accept it or may clear it asynchronously.
//   3. Type character by character, 30ms apart, with input events after each.
//      Knockout sees each character as a human keystroke and updates its
//      observable. Works on most Oracle CX comboboxes.
//   4. Same as 3 but uses InputEvent with inputType='insertText'. This is a
//      real browser event that represents actual text insertion — no framework
//      can distinguish it from a human typing on a physical keyboard.
// STRATEGIES (tried in order, first success wins):
//   1. DOM click → find dropdown option → click it
//   2. Native value setter + Enter + 300ms async verification
//   3. Char-by-char typing (progressive value + input events, 30ms/char)
//   4. InputEvent per-character (insertText for each char)
FormDetector.fillOracleCombobox = async function(el, value) {
  const _t = Date.now();
  const valueStr = (value || '').trim();
  if (!valueStr) {
    _trace('JC-TRACE: 1:fillOracleCombobox → empty value, skipping');
    return false;
  }
  
  const fieldLabel = el.name || el.id || 'Oracle combobox';
  _trace(`JC-TRACE: 2:fillOracleCombobox [${fieldLabel}] → start, value="${valueStr}"`);
  
  // Strategy 1: DOM approach — click toggle button to open dropdown, find option, select it
  // Oracle CX React comboboxes open via the toggle button (#{id}-toggle-button),
  // NOT by clicking the input element. The dropdown renders as #{id}-listbox with
  // role="grid" containing role="gridcell" items with class cx-select__list-item.
  try {
    const toggleBtn = document.getElementById(el.id + '-toggle-button');
    if (toggleBtn) {
      _trace(`JC-TRACE: 3:toggle click [${fieldLabel}] → ${toggleBtn.id}`);
      toggleBtn.click();
    } else {
      _trace(`JC-TRACE: 3:no toggle [${fieldLabel}] → el.click()`);
      el.focus();
      el.click();
    }

    // Wait for dropdown to open (poll aria-expanded up to ~900ms)
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, 300));
      if (el.getAttribute('aria-expanded') === 'true') break;
    }
    _trace(`JC-TRACE: 4:expanded [${fieldLabel}] → ${el.getAttribute('aria-expanded')}`);

    // Wait for options to render (they appear after dropdown opens)
    const _listbox = document.getElementById(el.id + '-listbox');
    if (_listbox) {
      for (let i = 0; i < 5; i++) {
        const items = _listbox.querySelectorAll('[role="gridcell"], [role="option"], .cx-select__list-item');
        if (items.length > 0) break;
        await new Promise(r => setTimeout(r, 250));
      }
    }

    const valueLower = valueStr.toLowerCase().trim();
    let match = null;

    // First: check the dedicated listbox (fastest, most specific)
    const listbox = document.getElementById(el.id + '-listbox');
    if (listbox) {
      const items = listbox.querySelectorAll('[role="gridcell"], [role="option"], .cx-select__list-item');
      match = Array.from(items).find(o =>
        o.textContent.trim().toLowerCase() === valueLower
      );
      if (!match) {
        const _wb = new RegExp('\\b' + valueLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
        match = Array.from(items).find(o =>
          _wb.test(o.textContent.trim())
        );
      }
      if (!match) {
        match = Array.from(items).find(o =>
          o.textContent.trim().toLowerCase().startsWith(valueLower) ||
          valueLower.startsWith(o.textContent.trim().toLowerCase())
        );
      }
    }

    // Fallback: search all dropdown selectors on page
    if (!match) {
      const selectors = ['.cx-select__list-item', '[role="option"]', '.oj-select-choice', '[role="gridcell"]'];
      const _wb = new RegExp('\\b' + valueLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      for (const sel of selectors) {
        const options = document.querySelectorAll(sel);
        if (options.length === 0) continue;
        match = Array.from(options).find(o =>
          o.textContent.trim().toLowerCase() === valueLower
        );
        if (match) break;
        match = Array.from(options).find(o =>
          _wb.test(o.textContent.trim())
        );
        if (match) break;
        match = Array.from(options).find(o =>
          o.textContent.trim().toLowerCase().startsWith(valueLower) ||
          valueLower.startsWith(o.textContent.trim().toLowerCase())
        );
        if (match) break;
      }
    }

    if (match) {
      _trace(`JC-TRACE: 5:match found [${fieldLabel}] → "${match.textContent.trim()}" (id=${match.id})`);
      const matchText = match.textContent.trim().toLowerCase();
      match.click();
      await new Promise(r => setTimeout(r, 300));
      // Oracle CX combobox: value is stored in toggle button text, not input value.
      // Check input value, toggle button text, AND whether dropdown closed (aria-expanded=false).
      const toggle = document.getElementById(el.id + '-toggle-button');
      const toggleText = toggle?.textContent?.trim()?.toLowerCase() || '';
      const inputVal = el.value?.toLowerCase() || '';
      const expanded = el.getAttribute('aria-expanded');
      _trace(`JC-TRACE: 6:after click [${fieldLabel}] → input="${inputVal}" toggle="${toggleText}" expanded=${expanded}`);
      // Confirmation: value set, OR toggle set, OR dropdown closed after click (Oracle accepted selection)
      if (inputVal === valueLower || toggleText === valueLower ||
          toggleText.startsWith(valueLower) || valueLower.startsWith(toggleText) ||
          (expanded === 'false' && matchText.includes(valueLower.substring(0, 3)))) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
        _trace(`JC-TRACE: 7:OK [${fieldLabel}] → DOM strategy confirmed +${Date.now()-_t}ms`);
        return true;
      }
      _trace(`JC-TRACE: 7:FAIL [${fieldLabel}] → option clicked but value not confirmed`);
    } else {
      _trace(`JC-TRACE: 5:no match [${fieldLabel}] → trying typeahead`);
      // No options found via toggle button — try typeahead approach.
      // Type a prefix of the value to trigger the dropdown, then find the match.
      const prefix = valueStr.substring(0, Math.min(5, valueStr.length));
      el.focus();
      _trace(`JC-TRACE: 8:typeahead [${fieldLabel}] → typing prefix="${prefix}"`);
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      // Type each character individually — Oracle's autocomplete triggers on keyboard events
      for (let i = 0; i < prefix.length; i++) {
        el.value = prefix.substring(0, i + 1);
        el.dispatchEvent(new KeyboardEvent('keydown', { key: prefix[i], bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: prefix[i], bubbles: true }));
        await new Promise(r => setTimeout(r, 80));
      }

      // Wait for typeahead options to load
      await new Promise(r => setTimeout(r, 2500));
      const listbox2 = document.getElementById(el.id + '-listbox');
      _trace(`JC-TRACE: 9:typeahead listbox [${fieldLabel}] → ${listbox2 ? 'found' : 'not found'}, expanded=${el.getAttribute('aria-expanded')}`);
      if (listbox2) {
        const items2 = listbox2.querySelectorAll('[role="gridcell"], [role="option"], .cx-select__list-item');
        _trace(`JC-TRACE: 10:typeahead items [${fieldLabel}] → ${items2.length} options`);
        match = Array.from(items2).find(o =>
          o.textContent.trim().toLowerCase() === valueLower
        );
        if (!match) {
          const _wb = new RegExp('\\b' + valueLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
          match = Array.from(items2).find(o =>
            _wb.test(o.textContent.trim())
          );
        }
        if (!match) {
          match = Array.from(items2).find(o =>
            o.textContent.trim().toLowerCase().startsWith(valueLower) ||
            valueLower.startsWith(o.textContent.trim().toLowerCase())
          );
        }
        if (match) {
          _trace(`JC-TRACE: 11:typeahead match [${fieldLabel}] → "${match.textContent.trim()}"`);
          const matchText2 = match.textContent.trim().toLowerCase();
          match.click();
          await new Promise(r => setTimeout(r, 300));
          const toggle = document.getElementById(el.id + '-toggle-button');
          const toggleText = toggle?.textContent?.trim()?.toLowerCase() || '';
          const inputVal = el.value?.toLowerCase() || '';
          const expanded2 = el.getAttribute('aria-expanded');
          _trace(`JC-TRACE: 12:typeahead after click [${fieldLabel}] → input="${inputVal}" toggle="${toggleText}" expanded=${expanded2}`);
          // Confirmation: value set, OR toggle set, OR dropdown closed after click
          if (inputVal === valueLower || toggleText === valueLower ||
              (expanded2 === 'false' && matchText2.includes(valueLower.substring(0, 3)))) {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.blur();
            _trace(`JC-TRACE: 13:typeahead OK [${fieldLabel}] +${Date.now()-_t}ms`);
            return true;
          }
          _trace(`JC-TRACE: 13:typeahead FAIL [${fieldLabel}] → value not confirmed`);
        }
      }
      // Close dropdown if still open
      const closeBtn = document.getElementById(el.id + '-toggle-button');
      if (closeBtn && el.getAttribute('aria-expanded') === 'true') closeBtn.click();
    }
    _trace(`JC-TRACE: 14:DOM fail [${fieldLabel}] → no option found for "${valueStr}"`);
  } catch(e) {
    _trace(`JC-TRACE: 14:DOM error [${fieldLabel}] → ${e.message}`);
  }
  
  // Strategy 2: Paste approach (InputEvent insertFromPaste)
  _trace(`JC-TRACE: 15:paste attempt [${fieldLabel}]`);
  // NOTE: Paste sets el.value but may not update React/Knockout state.
  // For comboboxes, also verify toggle button text changed — if not,
  // the paste didn't really work and we fall through to char-by-char.
  try {
    el.focus();
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.value = valueStr;
    el.dispatchEvent(new InputEvent('input', {
      inputType: 'insertFromPaste',
      data: valueStr,
      bubbles: true,
      cancelable: true,
    }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true }));
    el.blur();
    await new Promise(r => setTimeout(r, 300));
    const toggle = document.getElementById(el.id + '-toggle-button');
    const toggleText = toggle?.textContent?.trim()?.toLowerCase() || '';
    const inputVal = el.value?.toLowerCase() || '';
    const valLower = valueStr.toLowerCase();
    // Paste only truly worked if toggle OR input has the value
    // [FIX] Remove `&& toggleText` guard — some comboboxes (postalCode, region2)
    // have toggle buttons with empty text. Check input value directly instead.
    if (inputVal === valLower || (toggleText && (toggleText === valLower ||
         toggleText.startsWith(valLower) || valLower.startsWith(toggleText)))) {
      console.log(`JC: fillOracleCombobox [${fieldLabel}] → paste OK (toggle="${toggleText}")`);
      return true;
    }
    console.log(`JC: fillOracleCombobox [${fieldLabel}] → paste: input="${inputVal}" toggle="${toggleText}" — not confirmed, falling through`);
  } catch(e) {
    console.log(`JC: fillOracleCombobox [${fieldLabel}] → paste error: ${e.message}`);
  }
  
  // Strategy 3: Char-by-char fallback
  console.log(`JC: fillOracleCombobox [${fieldLabel}] → trying char-by-char fallback`);
  try {
    el.focus();
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    for (let i = 0; i < valueStr.length; i++) {
      el.value = valueStr.substring(0, i + 1);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 80));
    }
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    await new Promise(r => setTimeout(r, 200));
    if (el.value === valueStr) {
      console.log(`JC: fillOracleCombobox [${fieldLabel}] → char-by-char OK`);
      return true;
    }
  } catch(e) {
    console.log(`JC: fillOracleCombobox [${fieldLabel}] → char-by-char error: ${e.message}`);
  }
  
  console.log(`JC: fillOracleCombobox [${fieldLabel}] → ALL strategies failed for "${valueStr}" +${Date.now()-_t}ms`);
  return false;
};

FormDetector.isOracleCombobox = function(el) {
  // Checks role=combobox, or inside .cx-select / .cx-select-container.
  // Date comboboxes use cx-select-container (React), not cx-select.
  return el.getAttribute('role') === 'combobox' ||
         !!el.closest('.cx-select') ||
         !!el.closest('.cx-select-container') ||
         el.classList.contains('cx-select-input');
};

FormDetector.isOracleCXField = function(el) {
  return el.getAttribute('role') === 'combobox' ||
         !!el.closest('.cx-select') ||
         !!el.closest('.cx-select-container') ||
         !!el.closest('.oj-combobox') ||
         el.classList.contains('cx-select-input');
};

// Debug logging — call this to log all detected fields to console
FormDetector.debugLog = function() {
  const fields = this.detect();
  console.log('🔍 Job Copilot — Form Detection Report');
  console.log('======================================');
  console.log(`Personal fields: ${fields.personal.length}`);
  fields.personal.forEach(f => console.log(`  📋 [${f.name}] "${f.label}" → ${f.el.tagName} ${f.el.type || ''}`));
  console.log(`AI Questions (textareas): ${fields.questions.length}`);
  fields.questions.forEach(f => console.log(`  💬 "${f.label}"`));
  console.log(`Dropdowns: ${fields.selects.length}`);
  console.log(`File uploads: ${fields.files.length}`);
  console.log('======================================');
  return fields;
};
