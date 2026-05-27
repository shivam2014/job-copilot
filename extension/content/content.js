// Content script — injected into job pages

// Stores last FormDetector.detect() result, panel DOM reference, and whether panel was open before SPA nav
let detectedFields = null;
let jcPanel = null;
let panelWasOpen = false;

// Returns true if page has only email input (login wall) and no selects/files — tells init() to skip auto-fill
function isLoginScreen(fields) {
  const applicationFields = fields.personal.filter(function(f) { return f.name !== 'email' && f.name !== 'unknown'; });
  return applicationFields.length === 0 && fields.selects.length === 0 && fields.files.length === 0;
}

// When user clicks any button/link containing Apply/Next/Continue text: wait 3s for Oracle CX SPA to render new section,
// then re-inject JC button if Oracle wiped it, re-attach AI buttons to textareas, restore panel open state, notify popup
document.addEventListener('click', function(e) {
  var t = e.target.closest('button, a') || e.target;
  if (t.tagName === 'BUTTON' || t.tagName === 'A') {
    var txt = (t.textContent || '').toLowerCase();
    if (txt.includes('apply') || txt.includes('next') || txt.includes('continue')) {
      setTimeout(function() {
        var fields = FormDetector.detect();
        var total = fields.personal.length + fields.questions.length;
        if (total > 0) {
          if (!document.getElementById('jc-float-btn')) {
            injectFloatingButton();
          }
          injectAIAssistButtons();
          // Restore panel open state after SPA transition
          const p = document.getElementById('jc-panel');
          if (p && panelWasOpen && !p.classList.contains('open')) {
            p.classList.add('open');
            updatePanel();
          }
          chrome.runtime.sendMessage({ type: 'jc_fields_detected', count: total }).catch(function() {});
        }
      }, 3000);
    }
  }
});

// Main init
// Boot on page load. setTimeout(1500ms) lets Oracle CX SPA render. Then: FormDetector.detect(), inject #jc-float-btn + #jc-panel,
// watchFormChanges() to learn user edits, injectAIAssistButtons() for textarea AI buttons. No auto-fill (was removed due to re-fill loop).
async function init() {

  setTimeout(function() {
    detectedFields = FormDetector.detect();
    const totalFields = detectedFields.personal.length + 
                        detectedFields.questions.length + 
                        detectedFields.selects.length;

    if (totalFields === 0) return; // No form detected

    if (isLoginScreen(detectedFields)) {
      console.log('JC: Login-only screen, waiting for application form...');
      // Still inject button and auto-fill email
      injectFloatingButton();
      setTimeout(async function() {
        try {
          const profile = await chrome.storage.sync.get(['profile_email']);
          if (profile.profile_email) {
            const fields = FormDetector.detect();
            for (const f of fields.personal) {
              if (f.name === 'email') {
                await FormDetector.fillField(f, profile.profile_email);
                console.log('JC: Auto-filled email on login screen');
              }
            }
          }
        } catch(e) {}
      }, 3000);
      return;
    }
    
    // Auto-fill personal fields from extension settings (with learned corrections)
    setTimeout(async function() {
      if (skipAutoFill) return;
      try {
        const fields = FormDetector.detect();
        const fillMap = await buildFillMap();
        const learned = await chrome.storage.sync.get('learned_fields');
        const corrections = learned.learned_fields || {};
        
        // Merge: corrections override profile defaults
        for (const [key, val] of Object.entries(corrections)) {
          if (val) fillMap[key] = val;
        }
        
        let filled = 0;
        const filledEls = [];
        for (const field of [...fields.personal, ...fields.selects]) {
          const value = fillMap[field.name];
          if (value && !skipFieldForType(field, value)) {
            const ok = await FormDetector.fillField(field, value);
            if (ok) { filled++; filledEls.push(field.el); }
          }
        }
        if (filled > 0) {
          console.log('JC: Auto-filled ' + filled + ' personal field(s)');
          listenForCorrections(filledEls);
        }
      } catch(e) {}
    }, 3000);
    
    // Start watching for user form changes (learning)
    watchFormChanges();
    
injectFloatingButton();
    injectAIAssistButtons();
  // Debug: log detected fields to console
  console.log("%c🔍 Job Copilot loaded", "font-weight:bold;color:#3b82f6");
  setTimeout(() => FormDetector.debugLog(), 2000);

    // Notify popup if it opens
    chrome.runtime.sendMessage({
      type: 'jc_fields_detected',
      count: totalFields,
    }).catch(() => {}); // popup may not be open
  }, 1500);
}

// Create <button id=jc-float-btn>JC</button> + control panel (#jc-panel), append to body.
// Guard: returns early if #jc-float-btn already exists (prevents init + observer race).
function injectFloatingButton() {
  if (document.getElementById('jc-float-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'jc-float-btn';
  btn.textContent = 'JC';

  const panel = createPanel();

  btn.onclick = () => {
    panel.classList.toggle('open');
    panelWasOpen = panel.classList.contains('open');
    if (panelWasOpen) updatePanel();
  };

  document.body.appendChild(btn);

  // Close panel on outside click
  // Close panel on outside click — but NOT during JC fill operations
  document.addEventListener('click', (e) => {
    if (window.__jcFilling) return;
    if (!btn.contains(e.target) && !panel.contains(e.target)) {
      panel.classList.remove('open');
    }
  });
}

// Create or return existing #jc-panel with all button handlers bound (Fill Personal, Fill AI, Fill All, Clear All).
// Fill All handler: checks __jcFilling guard → runs fillPersonal, fillAIQuestions, fillExtras, fillProfileSections.
// dataset.jcBound prevents double-binding when init() + observer both call createPanel().
function createPanel() {
  const existingPanel = document.getElementById('jc-panel');
  if (existingPanel) {
    if (panelWasOpen && !existingPanel.classList.contains('open')) {
      existingPanel.classList.add('open');
      updatePanel();
    }
    return existingPanel;
  }

  jcPanel = document.createElement('div');
  jcPanel.id = 'jc-panel';

  jcPanel.innerHTML = `
    <div id="jc-panel-header">
      <span>Job Copilot</span>
      <button id="jc-panel-close">×</button>
    </div>
    <div id="jc-panel-body">
      <div id="jc-stats"></div>
      <button class="jc-btn jc-btn-primary" id="jc-fill-personal">Fill Personal Fields</button>
      <button class="jc-btn jc-btn-primary" id="jc-fill-ai">Fill AI Questions</button>
      <button class="jc-btn jc-btn-secondary" id="jc-fill-all">Fill All</button>
      <button class="jc-btn jc-btn-secondary" id="jc-clear-form" style="margin-top:4px;background:#fef2f2!important;color:#991b1b!important;border:1px solid #fecaca!important">Clear All Fields</button>
      <div id="jc-status-msg"></div>
    </div>
  `;

  jcPanel.querySelector('#jc-panel-close').onclick = () => {
    jcPanel.classList.remove('open');
    panelWasOpen = false;
  };
  jcPanel.querySelector('#jc-fill-personal').onclick = async () => {
    window.__jcFilling = true;
    await fillPersonal();
    window.__jcFilling = false;
  };
  jcPanel.querySelector('#jc-fill-ai').onclick = async () => {
    window.__jcFilling = true;
    await fillAIQuestions();
    window.__jcFilling = false;
  };
  jcPanel.querySelector('#jc-fill-all').onclick = async () => {
    window.__jcFilling = true;
    await fillPersonal();
    await fillAIQuestions();
    await fillExtras();
    await fillProfileSections();
    window.__jcFilling = false;
  };
  jcPanel.querySelector('#jc-clear-form').onclick = () => {
    window.__jcFilling = true;
    clearForm();
    window.__jcFilling = false;
  };

  document.body.appendChild(jcPanel);
  return jcPanel;
}

// Re-run FormDetector.detect(), update #jc-stats with current personal/selects/textarea/file counts
function updatePanel() {
  const stats = document.getElementById('jc-stats');
  if (!stats) return;
  const fields = FormDetector.detect();
  detectedFields = fields;

  stats.innerHTML = `
    <div class="jc-stat">
      <span class="jc-stat-label">Personal fields</span>
      <span class="jc-stat-value">${fields.personal.length}</span>
    </div>
    <div class="jc-stat">
      <span class="jc-stat-label">AI questions</span>
      <span class="jc-stat-value">${fields.questions.length}</span>
    </div>
    <div class="jc-stat">
      <span class="jc-stat-label">Dropdowns</span>
      <span class="jc-stat-value">${fields.selects.length}</span>
    </div>
    <div class="jc-stat">
      <span class="jc-stat-label">File uploads</span>
      <span class="jc-stat-value">${fields.files.length}</span>
    </div>
  `;
}

// Scan page via FormDetector.detect(), read profile from chrome.storage.sync via buildFillMap(),
// apply learned_fields corrections, then for each personal field + select: FormDetector.fillField() which routes
// to fillTextInput (text/email/tel), fillSelect (native dropdown), or fillOracleCombobox (Knockout combobox).
async function fillPersonal() {
  const fields = FormDetector.detect();
  const fillMap = await buildFillMap();
  
  // Check if profile has any data at all
  const hasProfileData = Object.values(fillMap).some(v => v && typeof v === 'string' && v.trim().length > 0);
  if (!hasProfileData) {
    showStatus('No profile data — click here to open extension settings.', 'error');
    makeStatusClickable();
    return;
  }
  
  // Apply learned corrections
  const learned = await chrome.storage.sync.get('learned_fields');
  const corrections = learned.learned_fields || {};
  for (const [key, val] of Object.entries(corrections)) {
    if (val) fillMap[key] = val;
  }
  
  let filled = 0;
  const filledEls = [];
  for (const field of [...fields.personal, ...fields.selects]) {
    const value = fillMap[field.name];
    if (value && !skipFieldForType(field, value)) {
      const ok = await FormDetector.fillField(field, value);
      if (ok) { filled++; filledEls.push(field.el); }
    }
  }
  
  if (filledEls.length > 0) listenForCorrections(filledEls);
  fillLearnedRadios();
  if (filled > 0) {
    showStatus(`Filled ${filled} personal field(s)`, 'success');
  } else if (hasProfileData) {
    showStatus('Profile data exists but no fields matched. Check your resume data.', 'error');
  }
}

// For each textarea detected as custom question: call LLMClient.generateAnswer(question, jobDesc, resumeText),
// fill answer via FormDetector.fillField(), save to storage. Uses user-configured LLM endpoint from chrome.storage.sync.
async function fillAIQuestions() {
  const profile = await chrome.storage.sync.get([
    'llm_base_url', 'llm_api_key', 'llm_model',
    'resume_text', 'profile_name',
  ]);

  if (!profile.resume_text) {
    showStatus('No resume uploaded — click here to open extension settings.', 'error');
    makeStatusClickable();
    return;
  }

  const fields = FormDetector.detect();
  const questions = fields.questions;
  if (questions.length === 0) {
    showStatus('No custom questions found', 'info');
    return;
  }

  // Try to get job description from page
  let jobDescription = extractJobDescription();

  showStatus(`Generating ${questions.length} answer(s)...`, 'info');

  let filled = 0;
  for (const field of questions) {
    try {
      const question = field.label || field.identifiers || 'Answer this question';
      // Initialize LLM client with user's config
      LLMClient.getConfig = async () => ({
        baseUrl: (profile.llm_base_url || 'https://api.openai.com/v1').replace(/\/+$/, ''),
        apiKey: profile.llm_api_key || '',
        model: profile.llm_model || 'gpt-4o-mini',
      });

      const answer = await LLMClient.generateAnswer(
        question, jobDescription, profile.resume_text
      );
      await FormDetector.fillField(field, answer);
      // Track: simplified — counts 1 call per answer (actual tokens from API)
      try {
        if (typeof TokenTracker !== 'undefined') {
          // Approximate: 4 chars ≈ 1 token
          const approx = Math.ceil((question.length + answer.length + (profile.resume_text || '').length) / 4);
          TokenTracker.record(profile.llm_model || 'unknown', {
            prompt_tokens: Math.ceil(((question.length + (profile.resume_text || '').length)) / 4),
            completion_tokens: Math.ceil(answer.length / 4),
            total_tokens: approx,
          });
        }
      } catch(e) {}
      await saveAnswer(field.label || field.identifiers, answer);
      filled++;
    } catch (err) {
      console.error('JC: LLM error for field:', field.label, err);
    }
  }

  showStatus(`Filled ${filled}/${questions.length} question(s)`, filled > 0 ? 'success' : 'error');
}

// --- Shared fill helpers ---

// Build the fill map from profile data, parsing name/address into parts
// Read chrome.storage.sync profile data, return {first_name, last_name, email, phone, country, ...}.
// Parses: name "Shivam Bhalla" → first+last, address "Street, City, Poland" → street+city+country,
// phone "+33-753788537" → countryCode + local. LLM-extracted address parts override address splitting.
async function buildFillMap() {
  const profile = await chrome.storage.sync.get([
    'profile_name', 'profile_email', 'profile_phone', 'profile_linkedin',
    'profile_github', 'profile_website', 'profile_address',
    'profile_work_authorization',
  ]);

  // Parse name into components
  const nameStr = (profile.profile_name || '').trim();
  const nameParts = nameStr ? nameStr.split(/\s+/) : [];
  const firstName = nameParts[0] || '';
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
  const middleName = nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '';

  // Parse address — only extract street/city/state/postal if comma-separated with >=3 parts
  const address = (profile.profile_address || '').trim();
  const addrParts = address ? address.split(',').map(s => s.trim()).filter(Boolean) : [];
  const hasMultiPartAddr = addrParts.length >= 3;
  const parseAddr = hasMultiPartAddr ? addrParts[0] : '';
  const parseCity = hasMultiPartAddr ? addrParts[addrParts.length - 2] : (addrParts.length === 2 ? addrParts[0] : '');
  const parseCountry = addrParts.length > 0 ? addrParts[addrParts.length - 1] : '';

  return {
    name: nameStr,
    first_name: firstName,
    last_name: lastName,
    middle_name: middleName,
    full_name: nameStr,
    email: profile.profile_email,
    phone: profile.profile_phone,
    linkedin: profile.profile_linkedin,
    github: profile.profile_github,
    website: profile.profile_website,
    // Generic 'address' only set when we CANT split into parts (no separate street/city/country on the form)
    address: hasMultiPartAddr ? '' : address,
    street_address: parseAddr,
    city: parseCity,
    state: '',
    postal_code: '',
    country: parseCountry,
    work_authorization: profile.profile_work_authorization,
  };
}

// Skip filling a field when the value doesn't match the field type
// Return true if value type mismatches field type: URL text into city field, phone digits into URL field, etc.
function skipFieldForType(field, value) {
  // Don't put non-URL text into url-type fields
  if (field.el.type === 'url' && !value.startsWith('http')) return true;
  // Don't put phone-like numbers into URL fields
  if (field.el.type === 'url' && /^[\d\s\-+()]{6,}$/.test(value)) return true;
  // Don't put city-like text into street_address (no house number / too short)
  if (field.name === 'street_address' && !/\d/.test(value)) return true;
  // Don't put full address into sub-fields (contains comma → not a single sub-value)
  if (field.name === 'address' && value.includes(',')) return true;
  // Don't fill postal_code with non-postal data
  if (field.name === 'postal_code' && (value.length < 3 || /^[a-zA-Z\s]{3,}$/.test(value))) return true;
  // Don't fill state/region with non-state data
  if (field.name === 'state' && value.length > 20) return true;
  return false;
}

// Learn from user corrections — after JC fills fields, watch for edits
// After JC fills fields, attach blur listener to each filled element.
// If user edits the value, save correction to chrome.storage.sync learned_fields.
function listenForCorrections(filledEls) {
  const seen = new WeakSet();
  for (const el of filledEls) {
    if (seen.has(el)) continue;
    seen.add(el);
    if (!el || !el.dataset) continue;
    
    const fieldName = el.dataset.jcField || el.id || el.name;
    const filledValue = el.value;
    
    // Tag the field so we know JC filled it
    el.dataset.jcFilled = 'true';
    el.dataset.jcValue = filledValue;
    
    // Listen for blur — user has potentially edited
    el.addEventListener('blur', function onBlur() {
      const newValue = el.value.trim();
      const oldValue = el.dataset.jcValue;
      
      // Only save if user actually changed the value (not just clicked in/out)
      if (newValue && oldValue && newValue !== oldValue) {
        const fieldLabel = fieldName || 'custom';
        saveLearnedCorrection(fieldLabel, newValue);
        console.log('JC: Learned correction for "' + fieldLabel + '": "' + newValue + '"');
      }
      
      // Remove listener — one learning event per field per session
      el.removeEventListener('blur', onBlur);
    });
  }
}

// Save a learned correction to storage
// Save {fieldName: correctedValue} to chrome.storage.sync learned_fields object (merged, not overwritten)
async function saveLearnedCorrection(fieldName, value) {
  try {
    const result = await chrome.storage.sync.get('learned_fields');
    const fields = result.learned_fields || {};
    fields[fieldName] = value;
    await chrome.storage.sync.set({ learned_fields: fields });
  } catch(e) {
    console.error('JC: Failed to save learned correction:', e);
  }
}

// Watch ALL form changes — learns from user interactions even on non-JC-filled fields
// Covers radio buttons, checkboxes, text inputs, selects
let formWatchInitialized = false;
// Attach change + blur listeners on document to detect user edits to radios, checkboxes, selects, text inputs.
// Saves corrections to learned_fields. Only activates once (formWatchInitialized guard).
function watchFormChanges() {
  if (formWatchInitialized) return;
  formWatchInitialized = true;
  
  // Debounced listener for change events (radios, checkboxes, selects)
  document.addEventListener('change', function(e) {
    const el = e.target;
    if (!el || !el.closest('form, [class*="apply-flow"], [class*="form"]')) return;
    
    // Only save if user changed it (not JC)
    if (el.dataset.jcFilled === 'true') return;
    
    if (el.type === 'radio' && el.checked) {
      // Save the user's radio selection (question → answer)
      const name = el.name;
      if (name) {
        const label = el.closest('label, .input-row, [class*="field"]');
        const questionText = label ? (label.textContent || '').trim().slice(0, 60) : '';
        const answer = (el.value || el.labels?.[0]?.textContent || '').trim();
        const key = 'radio_' + (questionText || name);
        saveLearnedCorrection(key, answer);
        console.log('JC: Learned radio answer "' + key + '" = "' + answer + '"');
      }
    }
    
    if (el.type === 'checkbox' && el.id !== 'job-alerts-checkbox') {
      const label = el.labels?.[0]?.textContent?.trim() || el.name || 'checkbox';
      const key = 'checkbox_' + label.slice(0, 40);
      saveLearnedCorrection(key, el.checked ? 'yes' : 'no');
      console.log('JC: Learned checkbox "' + key + '" = ' + el.checked);
    }
    
    if (el.tagName === 'SELECT') {
      const label = el.labels?.[0]?.textContent?.trim() || el.name || el.id || 'select';
      const key = 'select_' + label.slice(0, 40);
      saveLearnedCorrection(key, el.value);
      console.log('JC: Learned select "' + key + '" = "' + el.value + '"');
    }
  }, true);
  
  // Text input learning: save on blur if user typed something new
  document.addEventListener('blur', function(e) {
    const el = e.target;
    if (!el || !el.closest('form, [class*="apply-flow"], [class*="form"]')) return;
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
    if (el.type === 'hidden' || el.type === 'file' || el.type === 'submit') return;
    if (el.dataset.jcFilled === 'true') return; // handled by listenForCorrections
    
    const val = el.value.trim();
    if (!val) return;
    
    // Get a meaningful key for this field
    const label = el.labels?.[0]?.textContent?.trim() || el.getAttribute('aria-label') || el.placeholder || el.name || el.id || '';
    if (!label || label.length < 3) return;
    
    const key = 'field_' + label.slice(0, 50).toLowerCase().replace(/\s+/g, '_');
    saveLearnedCorrection(key, val);
  }, true);
}

// Fill radio buttons from learned corrections (application questions)
// For each radio group on page: check if learned_fields has a saved answer for that question,
// find the matching radio option, set checked=true, dispatch change event.
async function fillLearnedRadios() {
  try {
    const result = await chrome.storage.sync.get('learned_fields');
    const corrections = result.learned_fields || {};
    
    // Find all radio button groups on the page
    const radios = document.querySelectorAll('input[type="radio"]');
    const groups = new Map();
    radios.forEach(r => {
      if (!r.name) return;
      if (!groups.has(r.name)) groups.set(r.name, []);
      groups.get(r.name).push(r);
    });
    
    let filled = 0;
    for (const [name, group] of groups) {
      // Find the question text from the page
      const container = group[0].closest('.input-row, [class*="field"], [class*="question"], label, .apply-flow');
      const questionText = container ? (container.textContent || '').trim().slice(0, 60) : name;
      const key = 'radio_' + questionText;
      
      const learnedAnswer = corrections[key];
      if (!learnedAnswer) continue;
      
      // Find the matching radio
      const match = group.find(r => {
        const label = (r.labels?.[0]?.textContent || r.value || '').trim();
        return label.toLowerCase().includes(learnedAnswer.toLowerCase());
      });
      
      if (match && !match.checked) {
        match.checked = true;
        match.dispatchEvent(new Event('change', { bubbles: true }));
        match.dataset.jcFilled = 'true';
        filled++;
        console.log('JC: Filled radio "' + questionText + '" = "' + learnedAnswer + '"');
      }
    }
    if (filled > 0) console.log('JC: Filled ' + filled + ' radio question(s) from learned answers');
  } catch(e) {
    console.error('JC: Error filling radios:', e);
  }
}

// Fill extra form elements: Title, Skills, Application Questions, Job alerts
// Fill Oracle CX special elements: click Title pill "Mr." (.cx-select-pills-container[aria-label=Title]),
// match resume skills against .skill-desired__button, answer screening questions "No", uncheck #job-alerts-checkbox.
async function fillExtras() {
  const fillMap = await buildFillMap();
  const nameStr = (fillMap.name || '').trim();
  const firstChar = nameStr ? nameStr.split(' ')[0].charAt(0).toUpperCase() : '';
  
  // 1. Select Title (Mr./Ms.) based on name — no strong signal, default to Mr.
  const titlePills = document.querySelectorAll('.cx-select-pill-section');
  const titleContainer = document.querySelector('.cx-select-pills-container[aria-label="Title"]');
  if (titleContainer) {
    const pills = titleContainer.querySelectorAll('.cx-select-pill-section');
    for (const pill of pills) {
      if (pill.textContent.trim() === 'Mr.') {
        pill.click();
        console.log('JC: Selected title: Mr.');
        break;
      }
    }
  }
  
  // 2. Match skills from resume against job's preferred skills
  const skillBtns = document.querySelectorAll('.skill-desired__button');
  if (skillBtns.length > 0) {
    // Get resume skills from stored profile data
    try {
      const result = await chrome.storage.sync.get('resume_full_data');
      if (result.resume_full_data) {
        const data = JSON.parse(result.resume_full_data);
        const resumeSkills = (data.rawSections?.skills || []).map(s => s.toLowerCase().trim());
        
        let matched = 0;
        for (const btn of skillBtns) {
          if (btn.offsetHeight === 0 && btn.offsetParent === null) continue;
          const skillText = btn.textContent.trim().toLowerCase();
          // Check if any resume skill matches
          const match = resumeSkills.some(rs => 
            skillText.includes(rs) || rs.includes(skillText) || 
            skillText.split(' ').some(word => rs.includes(word) && word.length > 3)
          );
          if (match) {
            btn.click();
            matched++;
          }
        }
        if (matched > 0) console.log('JC: Matched ' + matched + ' skill(s) from resume');
      }
    } catch(e) {}
  }
  
  // 3. Fill application question pills (default: answer "No" to screening questions)
  const questionPills = document.querySelectorAll('.cx-select-pill-section');
  const questionContainers = document.querySelectorAll('.cx-select-pills-container');
  for (const container of questionContainers) {
    const ariaLabel = container.getAttribute('aria-label') || '';
    if (!ariaLabel || ariaLabel === 'Title') continue; // skip title
    
    const pills = container.querySelectorAll('.cx-select-pill-section');
    for (const pill of pills) {
      const text = pill.textContent.trim();
      
      // Check for learned answers first
      // Default: answer "No" to screening questions, "Yes" to job alerts
      if (text === 'No') {
        pill.click();
        console.log('JC: Answered "' + ariaLabel.slice(0, 30) + '" → No');
        break;
      }
    }
  }
  
  // 4. Job alerts checkbox — leave unchecked unless previously learned
}

// Clear all form fields on the page


// Read resume_full_data.rawSections from storage, click Add Experience/Add Education for each entry,
// fill fields via fillSingleSection(), fill dates via fillDateCombo(), click Save.
async function fillProfileSections() {
  const profile = await chrome.storage.sync.get('resume_full_data');
  if (!profile.resume_full_data) {
    console.log('JC: No resume_full_data found, skipping profile sections');
    return;
  }
  let fullData;
  try { fullData = JSON.parse(profile.resume_full_data); } catch(e) {
    console.log('JC: Failed to parse resume_full_data');
    return;
  }
  const sections = fullData.rawSections || {};
  // Experience and Education entries are stored in rawSections from LLM extraction.
  // Each entry has: company, title, start_date, end_date, description, city, country...
  let totalFilled = 0;

  // ── Experience ──────────────────────────────────────────────────────
  if (sections.experience && Array.isArray(sections.experience) && sections.experience.length > 0) {
  // For each experience entry, opens the "Add Experience" dialog, fills fields,
  // and clicks Save. Repeats for all entries in the resume.
    console.log('JC: Filling ' + sections.experience.length + ' experience entr' + (sections.experience.length === 1 ? 'y' : 'ies'));
    for (const entry of sections.experience) {
      if (await fillSingleSection(entry, 'Experience')) totalFilled++;
    }
  }

  // ── Education ───────────────────────────────────────────────────────
  if (sections.education && Array.isArray(sections.education) && sections.education.length > 0) {
  // Same flow as experience but for education entries.
  // Uses fieldMapping with end_date → dateAchieved for Oracle CX inline education.
    console.log('JC: Filling ' + sections.education.length + ' education entr' + (sections.education.length === 1 ? 'y' : 'ies'));
    for (const entry of sections.education) {
      if (await fillSingleSection(entry, 'Education')) totalFilled++;
    }
  }

  if (totalFilled > 0) {
    showStatus('Filled ' + totalFilled + ' section entr' + (totalFilled === 1 ? 'y' : 'ies') + ' from resume', 'success');
  }
}


// Returns true if Oracle CX inline education fields [name=description] are visible without Add button
function isOracleEducationInline() {
  return !!document.querySelector('[name="description"], [id^="month-dateAchieved"]');
}


// For one entry: click Add button or detect inline form, map LLM fields to Oracle input names,
// fill each via FormDetector.fillField(), fill dates, toggle checkboxes, click Save
async function fillSingleSection(entry, sectionType) {
  // Fills one experience or education entry in the Oracle CX dialog.
  //
  // FLOW:
  //   1. Check if form is already open (isSectionFormOpen). If not, find and click "Add Xxx".
  //   2. Build field mapping: LLM key → Oracle form field name (e.g., company → employerName)
  //   3. For each mapped field: find the DOM element, call FormDetector.fillField()
  //   4. Fill date combo fields (month/year dropdowns via fillDateCombo)
  //   5. Toggle checkboxes (Current Job, Graduated)
  //   6. Click Save button to persist the entry
  //
  // EDGE CASE: Oracle CX inline education (no "Add Education" popup).
  //   Detected by isOracleEducationInline() which checks for [name="description"] fields.
  //   In this case, we skip the Add button click and fill the visible inline fields directly.
  // 1. Check if form fields are already visible (inline form already open)
  const formAlreadyOpen = isSectionFormOpen(sectionType);
  if (!formAlreadyOpen) {
    // Find and click the "Add Xxx" button to open the form
    const addBtn = findSectionAddButton(sectionType);
    if (!addBtn) {
      // Oracle CX inline pattern: fields may be visible without Add button
      if (sectionType === 'Education' && isOracleEducationInline()) {
        console.log('JC: Education inline fields detected (Oracle CX pattern)');
      } else {
        console.log('JC: No "Add ' + sectionType + '" button found');
        return false;
      }
    } else {
      addBtn.click();
      await new Promise(r => setTimeout(r, 1200)); // Wait for form to appear
    }
  }

  // 2. Build field map: LLM key → Oracle form field name
  let fieldMapping;
  if (sectionType === 'Experience') {
    fieldMapping = {
      company: 'employerName',
      employer: 'employerName',
      title: 'jobTitle',
      job_title: 'jobTitle',
      city: 'employerCity',
      country: 'countryCode',
      employer_city: 'employerCity',
      employer_country: 'countryCode',
      description: 'responsibilities',
    };
  } else {
    fieldMapping = {
      school: 'educationalEstablishment',
      institution: 'educationalEstablishment',
      degree: 'contentItemId',
      field: 'major',
      field_of_study: 'major',
      major: 'major',
      grade: 'educationLevel',
      education_level: 'educationLevel',
      country: 'countryCode',
      minor: 'minor',
      // Oracle CX inline fields (visible without Add button)
      description: 'description',
      // Map end_date → dateAchieved for education (Oracle CX uses dateAchieved)
      end_date: 'dateAchieved',
    };
  }

  // 3. Fill each mapped field
  let filledCount = 0;
  for (const [llmKey, formName] of Object.entries(fieldMapping)) {
    const value = entry[llmKey];
    if (!value || typeof value !== 'string' || !value.trim()) continue;
    const fieldObj = buildFieldObj(formName);
    if (!fieldObj) continue;
    const ok = await FormDetector.fillField(fieldObj, value.trim());
    if (ok) filledCount++;
  }

  // 4. Fill dates (month/year combo fields)
  if (sectionType === 'Education') {
    // Oracle CX uses dateAchieved for education (single completion date)
    const dateVal = entry.end_date || entry.start_date || '';
    if (dateVal) {
      const parts = parseDateParts(dateVal);
      if (parts.month) await fillDateCombo('dateAchieved', 'month', parts.month);
      if (parts.day) await fillDateCombo('dateAchieved', 'day', parts.day);
      if (parts.year) await fillDateCombo('dateAchieved', 'year', parts.year);
    }
  } else {
    if (entry.start_date) {
      const parts = parseDateParts(entry.start_date);
      if (parts.month) await fillDateCombo('startDate', 'month', parts.month);
      if (parts.year) await fillDateCombo('startDate', 'year', parts.year);
    }
    if (entry.end_date) {
      const parts = parseDateParts(entry.end_date);
      if (parts.month) await fillDateCombo('endDate', 'month', parts.month);
      if (parts.year) await fillDateCombo('endDate', 'year', parts.year);
    }
  }

  // 5. Handle section-specific checkboxes
  if (sectionType === 'Experience') {
    if (entry.is_current || entry.current) {
      await toggleCheckboxByLabel('Current Job', true);
    }
  } else {
    if (entry.graduated || entry.is_graduated) {
      await toggleCheckboxByLabel('Graduated', true);
    }
  }

  // 6. Click the save/confirm button ("Add Experience" / "Add Education")
  await new Promise(r => setTimeout(r, 600));
  const saveBtn = findDialogSaveButton(sectionType, addBtn); // The same text serves as confirm too
  if (saveBtn && saveBtn !== addBtn) {
    saveBtn.click();
    console.log('JC: Saved ' + sectionType + ' entry');
    await new Promise(r => setTimeout(r, 1500));
    return true;
  }
  // Fallback: try clicking any visible "Add Experience"/"Add Education" button
  const allBtns = document.querySelectorAll('button');
  for (const b of allBtns) {
    if (b.textContent.trim() === 'Add ' + sectionType && (b.offsetHeight > 0 || b.offsetParent !== null)) {
      if (b !== addBtn) {
        b.click();
        console.log('JC: Saved ' + sectionType + ' entry (found by text)');
        await new Promise(r => setTimeout(r, 1500));
        return true;
      }
    }
  }
  console.log('JC: Could not find save button for ' + sectionType + ', fields may be filled but not saved');
  return filledCount > 0;
}


// Find Add button by id^=profileItemsAddButton- or textContent="Add Experience"/"Add Education"
function findSectionAddButton(sectionType) {
  // Priority 1: visible button with section ID pattern (profileItemsAddButton-*)
  const allBtns = document.querySelectorAll('button');
  for (const b of allBtns) {
    if ((b.offsetHeight > 0 || b.offsetParent !== null) && b.id && b.id.startsWith('profileItemsAddButton-')) {
      return b;
    }
  }
  // Priority 2: visible button with matching text, EXCLUDING save-buttons
  for (const b of allBtns) {
    const text = b.textContent.trim();
    const cls = (b.className || '').toLowerCase();
    if (text === 'Add ' + sectionType && (b.offsetHeight > 0 || b.offsetParent !== null) && !cls.includes('save-btn')) {
      return b;
    }
  }
  return null;
}


// Find Save button inside Add dialog (checks class=save-btn, then textContent match)
function findDialogSaveButton(sectionType, sectionAddBtn) {
  const allBtns = document.querySelectorAll('button');
  // Priority 1: find save-btn with matching text (case insensitive)
  for (const b of allBtns) {
    const text = b.textContent.trim();
    const cls = (b.className || '').toLowerCase();
    const textLower = text.toLowerCase();
    const expectedLower = ('Add ' + sectionType).toLowerCase();
    if (textLower === expectedLower && (b.offsetHeight > 0 || b.offsetParent !== null) && cls.includes('save-btn')) {
      return b;
    }
  }
  // Priority 2: any visible button with matching text, different from add button
  for (const b of allBtns) {
    const text = b.textContent.trim();
    const textLower = text.toLowerCase();
    const expectedLower = ('Add ' + sectionType).toLowerCase();
    if (textLower === expectedLower && b !== sectionAddBtn && (b.offsetHeight > 0 || b.offsetParent !== null)) {
      return b;
    }
  }
  // Priority 3: any visible save-btn button with matching text (same as add btn if only one)
  for (const b of allBtns) {
    const text = b.textContent.trim().toLowerCase();
    const expectedLower = ('Add ' + sectionType).toLowerCase();
    if (text === expectedLower && (b.offsetHeight > 0 || b.offsetParent !== null)) {
      return b;
    }
  }
  return null;
}


// Check if modal form fields (employerName, jobTitle, etc.) are already visible
function isSectionFormOpen(sectionType) {
  // Check for key form fields that are visible on the page
  const fieldIds = sectionType === 'Experience'
    ? ['employerName', 'jobTitle', 'responsibilities']
    : ['educationalEstablishment', 'contentItemId', 'major'];
  for (const name of fieldIds) {
    const el = document.querySelector('[name="' + name + '"]');
    if (el && (el.offsetHeight > 0 || el.offsetParent !== null)) {
      return true;
    }
  }
  return false;
}


// Build {el, name, label, isRequired, rect} from Oracle input[name=...] for FormDetector.fillField
function buildFieldObj(formName) {
  const el = document.querySelector('[name="' + formName + '"]');
  if (!el) return null;
  // Check for the toggle button (Oracle combobox pattern)
  const toggleId = el.id + '-toggle-button';
  const hasToggle = !!document.getElementById(toggleId);
  return {
    el: el,
    name: formName,
    label: (el.labels?.[0]?.textContent || el.getAttribute('aria-label') || formName).trim(),
    isRequired: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
    rect: el.getBoundingClientRect(),
    identifiers: formName,
    _isOracle: hasToggle,
  };
}


// Find Oracle month/year combobox by [id^=month-{field}] or [id^=year-{field}], fill value
async function fillDateCombo(dateField, part, value) {
  const prefix = part === 'month' ? 'month' : 'year';
  // Find the input by partial ID: id^="month-startDate" or id^="year-endDate"
  const el = document.querySelector('[id^="' + prefix + '-' + dateField + '"]');
  if (!el) return;
  const toggleId = el.id + '-toggle-button';
  const hasToggle = !!document.getElementById(toggleId);
  const fieldObj = {
    el: el,
    name: dateField + '_' + part,
    label: part,
    isRequired: false,
    rect: el.getBoundingClientRect(),
    identifiers: dateField + ' ' + part,
    _isOracle: hasToggle,
  };
  await FormDetector.fillField(fieldObj, value);
}


// Find <label> by textContent, locate checkbox, set checked, dispatch change
async function toggleCheckboxByLabel(labelText, checked) {
  const labels = document.querySelectorAll('label');
  for (const lbl of labels) {
    if (lbl.textContent.trim() === labelText) {
      const cb = lbl.querySelector('input[type="checkbox"]') || document.getElementById(lbl.getAttribute('for'));
      if (cb) {
        cb.checked = checked;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
  }
  return false;
}


// Parse "MM/YYYY", "Mon YYYY", or "YYYY" into {month, day, year}. Months use short names (Mar, Oct).
function parseDateParts(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return {};
  const result = {};
  // Month names array for Oracle CX compatibility
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  // Format: "MM/YYYY" or "M/YYYY"
  const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const numMonth = parseInt(slashMatch[1]);
    result.month = monthNames[numMonth - 1] || String(numMonth); // "Mar" not "3"
    result.year = slashMatch[2];
    return result;
  }
  // Try "MonthName YYYY" (e.g. "March 2024", "Mar 2024")
  const months = {jan:'1',feb:'2',mar:'3',apr:'4',may:'5',jun:'6',jul:'7',aug:'8',sep:'9',oct:'10',nov:'11',dec:'12'};
  const namedMatch = dateStr.match(/^([a-z]{3,})\s*(\d{4})$/i);
  if (namedMatch) {
    const shortMonth = namedMatch[1].toLowerCase().substring(0, 3);
    if (months[shortMonth]) {
      result.month = namedMatch[1]; // Pass through original month name
      result.year = namedMatch[2];
      return result;
    }
  }
  // Just a year
  const yearMatch = dateStr.match(/^(\d{4})$/);
  if (yearMatch) {
    result.year = yearMatch[1];
  }
  return result;
}


function clearForm() {
  if (!confirm('Clear all fields on this form? This cannot be undone.')) return;
  
  let cleared = 0;
  
  // 1. Click all "Remove value" buttons (combo fields)
  const removeBtns = document.querySelectorAll('button[title*="Remove value"]');
  for (const btn of removeBtns) {
    if (btn.offsetHeight > 0 || btn.offsetParent !== null) {
      try { btn.click(); cleared++; } catch(e) {}
    }
  }
  
  // 2. Click all "Delete" buttons on profile tiles (experience, education, skills, languages)
  const deleteBtns = document.querySelectorAll('button[title="Delete"], button[aria-label="Delete"]');
  for (const btn of deleteBtns) {
    try { btn.click(); cleared++; } catch(e) {}
  }
  
  // 3. Clear all text inputs and comboboxes  
  const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="file"]), textarea, select, [role="combobox"]');
  for (const el of inputs) {
    if (el.hasAttribute('readonly')) el.removeAttribute('readonly');
    el.classList.remove('input-row__control--locked');
    
    if (el.type === 'radio' || el.type === 'checkbox') {
      if (el.checked) {
        el.checked = false;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        cleared++;
      }
    } else if (el.tagName === 'SELECT') {
      el.selectedIndex = 0;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      cleared++;
    } else if (el.value) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, '');
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      cleared++;
    }
    
    delete el.dataset.jcFilled;
    delete el.dataset.jcValue;
  }
  
  // 4. Clear Oracle custom pill selects (skills, languages, title, questions)
  const pills = document.querySelectorAll('.cx-select-pill-section');
  for (const pill of pills) {
    if (pill.offsetHeight > 0 && pill.offsetParent !== null) {
      try { pill.click(); cleared++; } catch(e) {}
    }
  }
  
  // 5. Clear Oracle custom combobox dropdown text
  const comboInputs = document.querySelectorAll('.cx-select-input');
  for (const el of comboInputs) {
    if (el.offsetHeight > 0 && el.offsetParent !== null) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      cleared++;
    }
  }
  
  // 6. Remove Oracle profile-imported items (experience, education cards — find any remaining)
  const profileItems = document.querySelectorAll('.apply-flow-profile-item-tile');
  for (const item of profileItems) {
    const allBtns = item.querySelectorAll('button');
    for (const btn of allBtns) {
      const title = (btn.getAttribute('title') || '').toLowerCase();
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (title === 'delete' || aria === 'delete') {
        try { btn.click(); cleared++; } catch(e) {}
      }
    }
  }
  
  // 7. Clear the job alerts checkbox
  const alertCb = document.getElementById('job-alerts-checkbox');
  if (alertCb && alertCb.checked) {
    alertCb.checked = false;
    alertCb.dispatchEvent(new Event('change', { bubbles: true }));
    cleared++;
  }
  
  showStatus('Cleared ' + cleared + ' field(s)', 'info');
  console.log('JC: Cleared ' + cleared + ' form field(s)');
  
  // Prevent auto-fill from re-filling fields for 3 seconds after clear
  skipAutoFill = true;
  setTimeout(() => { skipAutoFill = false; }, 3000);
}

// Query DOM with 10 selectors for job description containers, return first result with >200 chars (truncated to 4000)
function extractJobDescription() {
  // Try common JD containers
  const selectors = [
    '[class*="job-description"]',
    '[class*="job-description"]',
    '[class*="posting-description"]',
    '[class*="description"]',
    '[data-testid*="job-desc"]',
    '[id*="job-desc"]',
    'article',
    '.show-more-section',
    '[class*="requisition"]',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent.length > 200) {
      return el.textContent.trim().slice(0, 4000);
    }
  }

  // Fallback: try to get page title + meta description
  const meta = document.querySelector('meta[name="description"]');
  return (meta?.content || document.title || '');
}

// 2s after load: for each custom-question textarea, inject a 28x28 blue sparkle button at bottom-right.
// On click: calls LLMClient.generateAnswer(question, jobDesc, resume). Skips if already wrapped (dataset.jcInjected).
function injectAIAssistButtons() {
  setTimeout(function() {
    const fields = FormDetector.detect();
    for (const field of fields.questions) {
      // Check if already wrapped
      if (field.el.parentElement?.classList.contains('jc-field-wrapper')) continue;
      FormDetector.injectAIButton(field.el, async (textareaEl) => {
        const profile = await chrome.storage.sync.get([
          'llm_base_url', 'llm_api_key', 'llm_model', 'resume_text',
        ]);
        if (!profile.resume_text) {
          showStatus('No resume uploaded — click here to open extension settings.', 'error');
          makeStatusClickable();
          return;
        }

        const fieldInfo = FormDetector.identify(textareaEl);
        const question = fieldInfo.label || 'Answer this question';
        const jd = extractJobDescription();

        LLMClient.getConfig = async () => ({
          baseUrl: (profile.llm_base_url || 'https://api.openai.com/v1').replace(/\/+$/, ''),
          apiKey: profile.llm_api_key || '',
          model: profile.llm_model || 'gpt-4o-mini',
        });

        try {
          const answer = await LLMClient.generateAnswer(question, jd, profile.resume_text);
          await FormDetector.fillField(fieldInfo, answer);
          await saveAnswer(question, answer);
          showStatus('Question answered!', 'success');
        } catch (err) {
          showStatus(`Error: ${err.message}`, 'error');
        }
      });
    }
  }, 2000);
}

// Set #jc-status-msg textContent + class (success/info/error), auto-clear after 5s
function showStatus(msg, type) {
  const el = document.getElementById('jc-status-msg');
  if (!el) return;
  el.className = `jc-status ${type}`;
  el.textContent = msg;
  setTimeout(function() { el.textContent = ''; el.className = 'jc-status'; }, 5000);
}

// Make the status message clickable to open extension settings
// Add click handler to #jc-status-msg that sends jc_open_options message to background.js (opens settings page)
function makeStatusClickable() {
  const el = document.getElementById('jc-status-msg');
  if (!el) return;
  el.style.cursor = 'pointer';
  el.style.color = '#2563eb';
  el.style.textDecoration = 'underline';
  el.title = 'Click to open extension settings';
  el.onclick = () => {
    chrome.runtime.sendMessage({ type: 'jc_open_options' }).catch(() => {});
    el.onclick = null;
    el.style.cursor = '';
    el.style.color = '';
    el.style.textDecoration = '';
    el.title = '';
  };
}

// --- Saved Answers Bank ---
// Save {question, answer, date} to chrome.storage.sync saved_answers array (max 50, deduped by question text)
async function saveAnswer(question, answer) {
  if (!question || !answer) return;
  const result = await chrome.storage.sync.get("saved_answers");
  let answers = result.saved_answers || [];
  answers = answers.filter(qa => qa.question.toLowerCase().trim() !== question.toLowerCase().trim());
  answers.unshift({
    question: question.trim(),
    answer: answer.trim(),
    date: new Date().toISOString().split("T")[0],
  });
  if (answers.length > 50) answers = answers.slice(0, 50);
  await chrome.storage.sync.set({ saved_answers: answers });
}

// Listen for fill requests from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'jc_fill_personal') {
    fillPersonal().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'jc_fill_ai') {
    fillAIQuestions().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'jc_get_fields') {
    const fields = FormDetector.detect();
    sendResponse(fields);
    return true;
  }
  if (msg.type === 'jc_ping') {
    sendResponse({ ok: true });
    return true;
  }
});


// Re-detect forms when DOM changes (SPA support)
let detectTimeout = null;
let autoFillAttempted = false;
let skipAutoFill = false;  // Set true by clearForm() to prevent re-fill after clearing
const observer = new MutationObserver(function() {
  clearTimeout(detectTimeout);
  detectTimeout = setTimeout(function() {
    const fields = FormDetector.detect();
    if (isLoginScreen(fields)) {
      var p = document.getElementById('jc-panel');
      if (p) updatePanel();
      return;
    }
    const panel = document.getElementById('jc-panel');
    if (!panel || !panel.classList.contains('open')) {
      const total = fields.personal.length + fields.questions.length;
      if (total > 0) {
        // Watch for user changes (learning) — safe to call repeatedly, only activates once
        watchFormChanges();
        if (!document.getElementById('jc-float-btn')) {
          injectFloatingButton();
          injectAIAssistButtons();
        } else {
          var p = document.getElementById('jc-panel');
          if (p) {
            updatePanel();
            if (panelWasOpen && !p.classList.contains('open')) {
              p.classList.add('open');
            }
          }
        }
        // Skip auto-fill if user just cleared the form
        if (skipAutoFill) return;
        
        // Auto-fill on SPA transitions: detect new form sections and fill them
        if (autoFillAttempted) {
          // Second+ SPA section: re-fill personal fields on new fields only
          runSpaReFill(fields);
        } else {
          // First time: run full auto-fill
          autoFillAttempted = true;
          setTimeout(async function() {
            // Skip if clear happened while timeout was pending
            if (skipAutoFill) return;
            try {
              const currentFields = FormDetector.detect();
              if (currentFields.personal.length > 0 || currentFields.selects.length > 0) {
                const fillMap = await buildFillMap();
                const learned = await chrome.storage.sync.get('learned_fields');
                const corrections = learned.learned_fields || {};
                for (const [key, val] of Object.entries(corrections)) {
                  if (val) fillMap[key] = val;
                }
                let filled = 0;
                const filledEls = [];
                for (const field of [...currentFields.personal, ...currentFields.selects]) {
                  const value = fillMap[field.name];
                  if (value && !skipFieldForType(field, value)) {
                    const ok = await FormDetector.fillField(field, value);
                    if (ok) { filled++; filledEls.push(field.el); }
                  }
                }
                if (filled > 0) {
                  console.log('JC: Auto-filled ' + filled + ' field(s) after SPA transition');
                  listenForCorrections(filledEls);
                }
                // Also fill learned radio answers
                fillLearnedRadios();
              }
            } catch(e) { console.error('JC: SPA auto-fill error', e); }
          }, 1500);
        }
      }
    }
  }, 2000);
});
observer.observe(document.body, { childList: true, subtree: true });

// SPA re-fill — only fills fields that are currently empty (second+ sections)
async function runSpaReFill(fields) {
  try {
    const fillMap = await buildFillMap();
    const learned = await chrome.storage.sync.get('learned_fields');
    const corrections = learned.learned_fields || {};
    for (const [key, val] of Object.entries(corrections)) {
      if (val) fillMap[key] = val;
    }
    let filled = 0;
    const filledEls = [];
    for (const field of [...fields.personal, ...fields.selects]) {
      // Only fill empty fields on SPA re-fill
      if (field.el.value) continue;
      const value = fillMap[field.name];
      if (value && !skipFieldForType(field, value)) {
        const ok = await FormDetector.fillField(field, value);
        if (ok) { filled++; filledEls.push(field.el); }
      }
    }
    if (filled > 0) {
      console.log('JC: SPA re-filled ' + filled + ' field(s)');
      listenForCorrections(filledEls);
    }
  } catch(e) { console.error('JC: SPA re-fill error', e); }
}

// Start
init();
