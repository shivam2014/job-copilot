// Form Detector — identifies form fields on job application pages

const FormDetector = {
// FormDetector is the core detection + filling engine.
// It is NOT attached to window — it lives in the content script isolated world.
// Content script (content.js) calls FormDetector.detect() and FormDetector.fillField().
  // Map common field patterns to profile fields
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

  // ─── Experience & Education (added by JC) ────────────────────────────
  // These fields appear after clicking "Add Experience" / "Add Education".
  // Filled by fillProfileSections() → fillSingleSection(), NOT by fillPersonal().
  // Form names (employerName, jobTitle) match Oracle CX input name= attributes.
  employer_name: [
    'employername', 'employer_name', 'employer name',
    'company', 'organization',
  ],
  job_title: [
    'jobtitle', 'job_title', 'job title',
    'title',
  ],
  responsibilities: [
    'responsibilities', 'responsibilities description',
    'jobdescription', 'job_description',
  ],
  school: [
    'educationalestablishment', 'educational_establishment',
    'school', 'institution', 'university', 'college',
  ],
  degree: [
    'contentitemid', 'content_item_id',
    'degree', 'diploma',
  ],
  major: [
    'major', 'fieldofstudy', 'field_of_study',
  ],
  minor: [
    'minor', 'secondaryfield', 'secondary_field',
  ],
  education_level: [
    'educationlevel', 'education_level', 'education level',
  ],
  start_date: [
    'startdate', 'start_date', 'start date',
  ],
  end_date: [
    'enddate', 'end_date', 'end date',
  ],
  employer_city: [
    'employercity', 'employer_city', 'employer city',
  ],
  employer_country: [
    'countrycode', 'employer country',
  ],
  },

  // Field types that map to profile values
  personalFieldTypes: ['text', 'email', 'tel', 'url', 'number'],

  // Detect all form fields on the page
  detect() {
  // Scans page for input, textarea, select elements.
  // Each element goes through identify() which scores it against fieldPatterns.
  // Returns: { personal: [...], questions: [...], files: [...], selects: [...], unknown: [...] }
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

  // Identify a field's purpose
  identify(el) {
  // Scores a single element against all fieldPatterns to determine its purpose.
  // SOURCES (with weights): labelText(4x), autocomplete(3x), ariaLabel(2x), name(1x), id(1x), placeholder(1x)
  // Pattern with highest total score wins. Name parts get priority over generic name.
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

  // ═══════════════════════════════════════════════════════════════
  // fillField — Route to correct handler based on element type
  // ═══════════════════════════════════════════════════════════════
  // DISPATCH:
  //   <select>           → fillSelect(value)
  //   file input         → return false (can't programmatically set)
  //   Oracle combobox    → fillOracleCombobox(el, value)  [4-strategy chain]
  //   everything else    → fillTextInput(el, field, value) [2-4 strategy chain]
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
    // Strategy 1: Direct DOM value + events
  // Simple assignment + standard events. Works for 90% of non-Oracle fields.
    return await this.fillTextInput(el, field, valueStr);
  },

  // Fill a native select element
  fillSelect(el, value) {
    const options = Array.from(el.options).filter(o => o.value !== '');
    const lowerValue = value.toLowerCase().trim();
    
    // Phase 1: exact match
  // 4 phases: exact, startsWith, word-boundary regex, includes.
  // Handles variations like "United States" vs "US".
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

  // Fill a text input/textarea with fallback chain
  // ═══════════════════════════════════════════════════════════════
  // fillTextInput — Fill text/email/tel inputs (not comboboxes)
  // ═══════════════════════════════════════════════════════════════
  // STRATEGIES (non-Oracle fields usually succeed at #1 or #2):
  //   1. Direct DOM value + input/change events
  //   2. Native value setter (Object.getOwnPropertyDescriptor setter)
  //   ── Oracle CX only (isOracleCXField check) ──
  //   3. Char-by-char typing (progressive value + input events)
  //   4. InputEvent per-character
  async fillTextInput(el, field, value) {
    const fieldLabel = field.label || field.name || 'field';
    const isOracle = this.isOracleCXField(el);
    
    // Strategy 1: Direct DOM value + events
  // Simple assignment + standard events. Works for 90% of non-Oracle fields.
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
  // Uses Object.getOwnPropertyDescriptor to access raw prototype setter.
  // Bypasses React/Vue interceptors. Still fails for Knockout (async clear).
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
  // These only activate when isOracleCXField(el) returns true.
  // Handle Knockout async observable clearing by simulating human typing.
    if (isOracle) {
      // Strategy 3: Character-by-character typing (bypasses Knockout filters)
  // Progressive value: P, Po, Pol, Pola, Polan, Poland with input events.
  // Knockout textInput binding updates observable on each input event.
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
      
      // Strategy 4: InputEvent per-character (most compatible with Knockout)
  // Last resort. Dispatches InputEvent(insertText) for each char.
  // Caters to custom Knockout bindings that only respond to insertText.
  // Dispatches InputEvent with inputType=insertText for each character.
  // Some Knockout bindings only respond to this, not to plain input events.
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

  // Inject AI button next to a textarea
  // Inject a sparkle button next to a textarea for AI-generated answers
  injectAIButton(textareaEl, onClick) {
    if (textareaEl.dataset.jcInjected) return;
    textareaEl.dataset.jcInjected = 'true';

    const btn = document.createElement('button');
    btn.className = 'jc-ai-btn';
    btn.title = 'Generate with AI';
    btn.innerHTML = '✨';
    btn.style.cssText = `
      position: absolute;
      right: 4px;
      bottom: 4px;
      width: 28px; height: 28px;
      border: none; border-radius: 6px;
      background: #3b82f6; color: white;
      cursor: pointer; font-size: 14px;
      display: flex; align-items: center; justify-content: center;
      opacity: 0.7; transition: opacity 0.2s;
      z-index: 999999;
    `;
    btn.onmouseenter = () => btn.style.opacity = '1';
    btn.onmouseleave = () => btn.style.opacity = '0.7';
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(textareaEl);
    };

    const wrapper = document.createElement('div');
    wrapper.className = 'jc-field-wrapper';
    wrapper.style.cssText = `
      position: relative; display: inline-block; width: 100%;
    `;
    textareaEl.parentNode.insertBefore(wrapper, textareaEl);
    wrapper.appendChild(textareaEl);
    wrapper.appendChild(btn);
  }
};

// ═══════════════════════════════════════════════════════════════
// fillOracleCombobox — 4-strategy fallback chain for Knockout
// ═══════════════════════════════════════════════════════════════
// PROBLEM: Oracle CX uses Knockout.js which rejects synthetic input events.
//   Setting el.value = "Poland" works synchronously but Knockout
//   clears it asynchronously (via subscribers/observables).
//
// STRATEGIES (tried in order, first success wins):
//   1. DOM click → find dropdown option → click it
//      Why it fails: Knockout hasn't rendered the dropdown yet after .click()
//   2. Native value setter (Object.getOwnPropertyDescriptor setter)
//      + Enter key event + 300ms async verification
//      Why it fails sometimes: Knockout observable rejects the value
//      after the 300ms async check detects the value was cleared
//   3. Char-by-char typing: progressively set value.substring(0,i+1)
//      + input event at each step. 30ms delay between chars.
//      Why it works: Knockout sees progressive changes as human typing,
//      and updates its observable for each character
//   4. InputEvent per-character: dispatch
//      new InputEvent('input', {inputType: 'insertText', data: char})
//      for each character. Fallback if char-by-char fails.
//
// CDP REMOVED: chrome.debugger.attach() conflicts with
//   --remote-debugging-pipe mode used by CDP bridge.
FormDetector.fillOracleCombobox = async function(el, value) {
  const valueStr = (value || '').trim();
  if (!valueStr) {
    console.log('JC: fillOracleCombobox → empty value, skipping');
    return false;
  }
  
  const fieldLabel = el.name || el.id || 'Oracle combobox';
  
  // Strategy 1: DOM approach — click to open dropdown, find option, select it
  // Clicks combobox, searches dropdown options by exact text, startsWith, includes.
  // Often fails because Knockout renders dropdown asynchronously after click().
  try {
    el.focus();
    el.click();
    await new Promise(r => setTimeout(r, 400)); // Wait for dropdown render
    
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
      // Try startsWith
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
  // Sets value via prototype setter + dispatches Enter key for selection.
  // Waits 300ms to verify Knockout didnt clear it (async check).
  // NOTE: Knockout may asynchronously clear the value after setter. We wait
  // 300ms to verify the value actually persisted before declaring success.
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
    // Async verification: wait for Knockout to process events before checking
    await new Promise(r => setTimeout(r, 300));
    if (el.value === valueStr) {
      console.log(`JC: fillOracleCombobox [${fieldLabel}] → native setter OK`);
      return true;
    }
    console.log(`JC: fillOracleCombobox [${fieldLabel}] → native setter: async check failed (Knockout cleared it)`);
  } catch(e) {
    console.log(`JC: fillOracleCombobox [${fieldLabel}] → native setter error: ${e.message}`);
  }
  
  // Strategy 3: Character-by-character typing (progressive value + input events)
  // Same char-by-char as text input plus Enter key at end for combobox selection.
  // 30ms delay between chars. Knockout sees this as human typing.
  // Workday autofill approach — sets value progressively so Knockout sees each change
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
  
  // Strategy 4: InputEvent per-character (most compatible with Knockout)
  // Last resort. Dispatches InputEvent(insertText) for each char.
  // Caters to custom Knockout bindings that only respond to insertText.
  // Dispatches InputEvent with inputType=insertText for each character.
  // Some Knockout bindings only respond to this, not to plain input events.
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
  // Routes to fillOracleCombobox() vs fillTextInput() in fillField().
  return el.getAttribute('role') === 'combobox' || !!el.closest('.cx-select');
};

// Debug logging — call this to log all detected fields to console
// Print all detected fields to console (call from dev tools for debugging)
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
