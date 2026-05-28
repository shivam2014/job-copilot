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

const FormDetector = {
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
      'address-line1',
    ],
    street_address2: [
      'address-line2', 'addressline2',
    ],
    city: [
      'city', 'town', 'address-level2',
    ],
    state: [
      'state', 'province', 'region', 'address-level1',
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

      if (field.name === 'unknown' && !field.isRequired) return;

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
            'address', 'street_address', 'street_address2', 'city', 'state', 'postal_code', 'country',
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
    if (this.isOracleCombobox(el)) {
      return await this.fillOracleCombobox(el, valueStr);
    }

    // ── TEXT INPUTS / TEXTAREAS: Fallback chain ────────────────
    return await this.fillTextInput(el, field, valueStr);
  },

  // ── Step 6a: Native <select> filling ───────────────────────────
  // Tries four matching strategies against the dropdown's options:
  // exact text, starts-with, word-boundary regex, substring.
  fillSelect(el, value) {
    const options = Array.from(el.options).filter(o => o.value !== '');
    const lowerValue = value.toLowerCase().trim();
    
    // Phase 1: exact match
    let match = options.find(o => 
      o.text.toLowerCase().trim() === lowerValue ||
      o.value.toLowerCase().trim() === lowerValue
    );
    
    // Phase 2: starts with
    if (!match) {
      match = options.find(o =>
        o.text.toLowerCase().trim().startsWith(lowerValue) ||
        o.value.toLowerCase().trim().startsWith(lowerValue) ||
        lowerValue.startsWith(o.text.toLowerCase().trim())
      );
    }
    
    // Phase 3: word-boundary
    if (!match) {
      const wordRegex = new RegExp('\\b' + lowerValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      match = options.find(o => wordRegex.test(o.text) || wordRegex.test(o.value));
    }
    
    // Phase 4: includes
    if (!match) {
      match = options.find(o =>
        o.text.toLowerCase().includes(lowerValue) ||
        o.value.toLowerCase().includes(lowerValue)
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
  // Tries up to four strategies in order. First success wins.
  // Strategy 1: set el.value directly + dispatch events. Works on plain inputs.
  // Strategy 2: use HTMLInputElement.prototype.value setter to bypass React/Vue.
  // Strategy 3: (Oracle only) type character by character with input events.
  // Strategy 4: (Oracle only) dispatch InputEvent(insertText) per character.
  async fillTextInput(el, field, value) {
    const fieldLabel = field.label || field.name || 'field';
    const isOracle = this.isOracleCXField(el);
    
    // Strategy 1: Direct DOM value + events
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    
    if (el.value === value) {
      el.blur();
      console.log(`JC: fillField [${fieldLabel}] → DOM strategy OK`);
      return true;
    }
    
    // Strategy 2: Native value setter (works for React/Vue)
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      
      if (el.value === value) {
        el.blur();
        console.log(`JC: fillField [${fieldLabel}] → native setter OK`);
        return true;
      }
    }
    
    // ── Oracle CX: Knockout-specific fallbacks ─────────────────
    if (isOracle) {
      // Strategy 3: Character-by-character typing
      console.log(`JC: fillField [${fieldLabel}] → DOM+setter failed, trying char-by-char`);
      try {
        el.focus();
        const ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (ns) ns.call(el, '');
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        
        for (let i = 0; i < value.length; i++) {
          const cur = value.substring(0, i + 1);
          if (ns) ns.call(el, cur);
          el.value = cur;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 20));
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
        if (el.value === value) {
          console.log(`JC: fillField [${fieldLabel}] → char-by-char OK`);
          return true;
        }
        console.log(`JC: fillField [${fieldLabel}] → char-by-char: value didn't stick`);
      } catch(e) {
        console.log(`JC: fillField [${fieldLabel}] → char-by-char error: ${e.message}`);
      }
      
      // Strategy 4: InputEvent per-character
      console.log(`JC: fillField [${fieldLabel}] → trying InputEvent per-char`);
      try {
        el.focus();
        const ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (ns) ns.call(el, '');
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        
        for (const char of value) {
          const cur = el.value + char;
          if (ns) ns.call(el, cur);
          el.value = cur;
          el.dispatchEvent(new InputEvent('input', {
            inputType: 'insertText',
            data: char,
            bubbles: true,
            cancelable: true,
          }));
          await new Promise(r => setTimeout(r, 20));
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
        if (el.value === value) {
          console.log(`JC: fillField [${fieldLabel}] → InputEvent per-char OK`);
          return true;
        }
        console.log(`JC: fillField [${fieldLabel}] → InputEvent per-char: value didn't stick`);
      } catch(e) {
        console.log(`JC: fillField [${fieldLabel}] → InputEvent per-char error: ${e.message}`);
      }
    }
    
    console.log(`JC: fillField [${fieldLabel}] → ALL strategies failed`);
    return false;
  },
};

// ── Step 6b: Oracle combobox filling ──────────────────────────────
// Oracle CX uses Knockout.js which actively rejects synthetic JS events.
// Setting el.value = "Poland" works for a moment but Knockout clears it
// asynchronously. Four strategies are tried in order:
//   1. Click combobox → find dropdown option → click it
//   2. Native setter + Enter + 300ms verify (Knockout may clear after)
//   3. Character-by-character typing (Knockout sees each char as human input)
//   4. InputEvent per-character (real browser event, no framework can filter it)
// STRATEGIES (tried in order, first success wins):
//   1. DOM click → find dropdown option → click it
//   2. Native value setter + Enter + 300ms async verification
//   3. Char-by-char typing (progressive value + input events, 30ms/char)
//   4. InputEvent per-character (insertText for each char)
FormDetector.fillOracleCombobox = async function(el, value) {
  const valueStr = (value || '').trim();
  if (!valueStr) {
    console.log('JC: fillOracleCombobox → empty value, skipping');
    return false;
  }
  
  const fieldLabel = el.name || el.id || 'Oracle combobox';
  
  // Strategy 1: DOM approach — click to open dropdown, find option, select it
  try {
    el.focus();
    el.click();
    await new Promise(r => setTimeout(r, 400));
    
    const valueLower = valueStr.toLowerCase().trim();
    const selectors = ['.cx-select-option', '[role="option"]', '.oj-select-choice'];
    let match = null;
    for (const sel of selectors) {
      const options = document.querySelectorAll(sel);
      if (options.length === 0) continue;
      match = Array.from(options).find(o =>
        o.textContent.trim().toLowerCase() === valueLower ||
        o.getAttribute('data-value')?.toLowerCase() === valueLower
      );
      if (match) break;
      match = Array.from(options).find(o =>
        o.textContent.trim().toLowerCase().startsWith(valueLower) ||
        valueLower.startsWith(o.textContent.trim().toLowerCase())
      );
      if (match) break;
    }
    
    if (match) {
      match.click();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      console.log(`JC: fillOracleCombobox [${fieldLabel}] → DOM strategy OK`);
      return true;
    }
    console.log(`JC: fillOracleCombobox [${fieldLabel}] → DOM strategy: no option found`);
  } catch(e) {
    console.log(`JC: fillOracleCombobox [${fieldLabel}] → DOM strategy error: ${e.message}`);
  }
  
  // Strategy 2: Native value setter + Enter + async verification
  try {
    el.focus();
    const ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (ns) ns.call(el, valueStr);
    el.value = valueStr;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true }));
    el.blur();
    await new Promise(r => setTimeout(r, 300));
    if (el.value === valueStr) {
      console.log(`JC: fillOracleCombobox [${fieldLabel}] → native setter OK`);
      return true;
    }
    console.log(`JC: fillOracleCombobox [${fieldLabel}] → native setter: async check failed`);
  } catch(e) {
    console.log(`JC: fillOracleCombobox [${fieldLabel}] → native setter error: ${e.message}`);
  }
  
  // Strategy 3: Character-by-character typing
  console.log(`JC: fillOracleCombobox [${fieldLabel}] → trying char-by-char typing`);
  try {
    el.focus();
    const ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (ns) ns.call(el, '');
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    
    for (let i = 0; i < valueStr.length; i++) {
      const cur = valueStr.substring(0, i + 1);
      if (ns) ns.call(el, cur);
      el.value = cur;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 30));
    }
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    if (el.value === valueStr) {
      console.log(`JC: fillOracleCombobox [${fieldLabel}] → char-by-char typing OK`);
      return true;
    }
    console.log(`JC: fillOracleCombobox [${fieldLabel}] → char-by-char: value didn't stick`);
  } catch(e) {
    console.log(`JC: fillOracleCombobox [${fieldLabel}] → char-by-char error: ${e.message}`);
  }
  
  // Strategy 4: InputEvent per-character
  console.log(`JC: fillOracleCombobox [${fieldLabel}] → trying InputEvent per-char`);
  try {
    el.focus();
    const ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (ns) ns.call(el, '');
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    
    for (const char of valueStr) {
      const cur = el.value + char;
      if (ns) ns.call(el, cur);
      el.value = cur;
      el.dispatchEvent(new InputEvent('input', {
        inputType: 'insertText',
        data: char,
        bubbles: true,
        cancelable: true,
      }));
      await new Promise(r => setTimeout(r, 30));
    }
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    if (el.value === valueStr) {
      console.log(`JC: fillOracleCombobox [${fieldLabel}] → InputEvent per-char OK`);
      return true;
    }
    console.log(`JC: fillOracleCombobox [${fieldLabel}] → InputEvent per-char: value didn't stick`);
  } catch(e) {
    console.log(`JC: fillOracleCombobox [${fieldLabel}] → InputEvent per-char error: ${e.message}`);
  }
  
  console.log(`JC: fillOracleCombobox [${fieldLabel}] → ALL strategies failed for "${valueStr}"`);
  return false;
};

FormDetector.isOracleCombobox = function(el) {
  // Checks role=combobox or inside .cx-select.
  return el.getAttribute('role') === 'combobox' || !!el.closest('.cx-select');
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
