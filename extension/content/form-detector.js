// Form Detector — identifies form fields on job application pages

const FormDetector = {
  // Map common field patterns to profile fields
  fieldPatterns: {
    name: [
      'name', 'fullname', 'full-name', 'full_name',
      'applicant.name', 'candidate.name',
      'firstname', 'first-name', 'first_name',
      'lastname', 'last-name', 'last_name',
    ],
    email: [
      'email', 'e-mail', 'emailaddress', 'email_address',
      'applicant.email', 'candidate.email',
    ],
    phone: [
      'phone', 'telephone', 'tel', 'phonenumber', 'phone-number', 'phone_number',
      'mobile', 'cell',
      'applicant.phone', 'candidate.phone',
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
    address: [
      'address', 'street', 'streetaddress', 'street_address',
      'location', 'city', 'state', 'zip', 'postal', 'postalcode',
    ],
    resume: [
      'resume', 'cv', 'upload-cv', 'uploadcv', 'upload_cv',
      'file', 'attachment', 'document',
    ],
    cover_letter: [
      'coverletter', 'cover-letter', 'cover_letter',
      'coverlettertext', 'cover_letter_text',
    ],
    work_authorization: [
      'workauth', 'work-authorization', 'work_authorization',
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
        fields.personal.push(field);
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

    // Try finding parent with label
    if (!labelText) {
      const parent = el.closest('.field, .form-group, .question, [class*="field"], [class*="form-"]');
      if (parent) {
        const labelEl = parent.querySelector('label, .label, [class*="label"]');
        if (labelEl) labelText = labelEl.textContent.toLowerCase().trim();
      }
    }

    // Combine all identifiers
    const identifiers = [name, id, placeholder, ariaLabel, autocomplete, labelText]
      .filter(Boolean)
      .join(' ');

    // Classify
    let fieldName = 'unknown';
    for (const [profileKey, patterns] of Object.entries(this.fieldPatterns)) {
      if (patterns.some(p => identifiers.includes(p))) {
        fieldName = profileKey;
        break;
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
    return ['name', 'email', 'phone', 'linkedin', 'github', 'website',
            'address', 'resume', 'cover_letter', 'work_authorization',
            'gender', 'veteran', 'disability', 'race', 'hispanic'].includes(name);
  },

  // Fill a single field
  async fillField(field, value) {
    if (!field || !field.el) return false;
    const el = field.el;

    el.focus();
    
    if (el instanceof HTMLSelectElement) {
      const option = Array.from(el.options).find(o =>
        o.text.toLowerCase().includes(value.toLowerCase()) ||
        o.value.toLowerCase().includes(value.toLowerCase())
      );
      if (option) {
        el.value = option.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }

    if (el.type === 'file') {
      // Can't programmatically set file inputs for security reasons
      return false;
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
