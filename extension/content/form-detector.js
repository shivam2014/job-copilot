// Form Detector — identifies form fields on job application pages

const FormDetector = {
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
      'phonecc', 'phone-cc',
      'phone_country',
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

  // Detect all form fields on the page
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

  // Identify a field's purpose
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
            'email', 'phone',
            'linkedin', 'github', 'website',
            'address', 'street_address', 'city', 'state', 'postal_code', 'country',
            'resume', 'cover_letter', 'work_authorization',
            'gender', 'veteran', 'disability', 'race', 'hispanic'].includes(name);
  },

  // Fill a single field
  async fillField(field, value) {
    if (!field || !field.el) return false;
    const el = field.el;

    el.focus();
    
    if (el instanceof HTMLSelectElement) {
      // Priority matching: exact > startsWith > word-boundary > includes
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
      
      // Phase 3: word-boundary (match as whole word within option text)
      if (!match) {
        const wordRegex = new RegExp('\\b' + lowerValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
        match = options.find(o => wordRegex.test(o.text) || wordRegex.test(o.value));
      }
      
      // Phase 4: includes (original fallback)
      if (!match) {
        match = options.find(o =>
          o.text.toLowerCase().includes(lowerValue) ||
          o.value.toLowerCase().includes(lowerValue)
        );
      }
      
      if (match) {
        el.value = match.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }

    if (el.type === 'file') {
      // Can't programmatically set file inputs for security reasons
      return false;
    }

    // Oracle custom combobox: can't set value directly, must open dropdown and select option
    if (this.isOracleCombobox(el)) {
      return await this.fillOracleCombobox(el, value);
    }

    // For text inputs and textareas
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Trigger React/Vue listeners
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    
    el.blur();
    return true;
  },

  // Inject AI button next to a textarea
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

FormDetector.isOracleCombobox = function(el) {
  return el.getAttribute('role') === 'combobox' || !!el.closest('.cx-select');
};

FormDetector.fillOracleCombobox = async function(el, value) {
  // Click to open the dropdown
  el.focus();
  el.click();
  
  // Wait for dropdown to appear
  await new Promise(resolve => setTimeout(resolve, 300));
  
  // Oracle combobox options are rendered in a position-fixed overlay or dropdown container
  // Try multiple selectors to find the options
  const valueLower = value.toLowerCase().trim();
  const selectors = [
      `.cx-select-option[data-value="${value}"]`,
      `.cx-select-option`,
      `[role="option"]`,
      `.oj-select-choice`,
    ];
    
    let options = [];
    for (const sel of selectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) {
        options = Array.from(found);
        break;
      }
    }
    
    if (options.length === 0) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return false;
    }
    
    // Priority matching: exact > startsWith > includes
    let match = options.find(o =>
      o.textContent.trim().toLowerCase() === valueLower ||
      o.getAttribute('data-value')?.toLowerCase() === valueLower
    );
    
    if (!match) {
      match = options.find(o =>
        o.textContent.trim().toLowerCase().startsWith(valueLower) ||
        valueLower.startsWith(o.textContent.trim().toLowerCase())
      );
    }
    
    if (!match) {
      match = options.find(o =>
        o.textContent.trim().toLowerCase().includes(valueLower)
      );
    }
    
    if (match) {
      match.click();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      return true;
    }
    
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return false;
  };

FormDetector.isPersonalField = function(name) {
  return ['name', 'first_name', 'last_name', 'middle_name', 'full_name',
          'email', 'phone', 'phone_country_code',
          'linkedin', 'github', 'website',
          'address', 'street_address', 'city', 'state', 'postal_code', 'country',
          'resume', 'cover_letter', 'work_authorization',
          'gender', 'veteran', 'disability', 'race', 'hispanic'].includes(name);
};
