// ═══════════════════════════════════════════════════════════════
// Content script — THE ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════
//
// FILE ROLE:
//   This file manages the extension's lifecycle, UI, fill orchestration,
//   and the learning system. It does NOT do detection or filling directly —
//   those live in form-detector.js. This file calls FormDetector.detect()
//   to find fields and FormDetector.fillField() to fill them, then handles
//   everything around that: when to detect, what values to fill, how to
//   learn from user corrections, and what the user sees.
//
// WHY THIS FILE EXISTS SEPARATELY:
//   form-detector.js is a pure engine: it takes a DOM and returns field
//   lists, it takes a field and a value and fills it. It has no opinions
//   about UI, timing, storage, or user interaction. Content.js is the
//   orchestrator that decides WHEN to call the engine and WHAT data to
//   feed it. This separation means you can test the fill engine against
//   mock DOMs without needing the panel, the popup, or Chrome storage.
//
//   llm-client.js is separate because the options page and popup also
//   need to call the LLM (for connection testing, for profile extraction).
//   If LLM logic lived here, the options page would have to duplicate it.
//
// EXECUTION TRACE (when user clicks "Fill All"):
//   Step 1:  fillAll() is called → sets __jcFilling guard → calls fillPersonal(), fillAIQuestions(), fillLearnedRadios()
//   Step 2:  fillPersonal() → calls FormDetector.detect() to find fields
//   Step 3:  (in form-detector.js) detect() → identify(el) for each element → scoring game against fieldPatterns
//   Step 4:  fillPersonal() → calls buildFillMap() to read profile from storage, split name/address, merge learned corrections
//   Step 5:  fillPersonal() → for each field, looks up fillMap[field.name], calls FormDetector.fillField(field, value)
//   Step 6:  (in form-detector.js) fillField() → routes to fillSelect/fillTextInput/fillOracleCombobox based on element type
//   Step 7:  (in form-detector.js) fillTextInput() → tries DOM assignment → native setter → char-by-char → InputEvent
//   Step 8:  fillPersonal() → calls listenForCorrections() to attach blur listeners for learning
//   Step 9:  fillAIQuestions() → calls getResumeText() + extractJobDescription(), then LLMClient.generateAnswer() for each textarea
//   Step 10: (in llm-client.js) generateAnswer() → sends question + JD + resume to LLM endpoint → returns answer
//   Step 11: fillLearnedRadios() → reads learned_fields, restores previous radio button selections
//   Step 12: __jcFilling guard removed → MutationObserver resumes → panel shows status message
// ═══════════════════════════════════════════════════════════════

// ── State ──────────────────────────────────────────────────────────
let detectedFields = null;
let jcPanel = null;
let panelWasOpen = false;

// ── SPA Navigation Handler ─────────────────────────────────────────
// Oracle CX is a single-page app. When you click "Apply", "Next", or
// "Continue", Oracle destroys the current form and renders a new one.
// This listener catches those clicks, waits 3 seconds for Oracle to
// finish rendering, then re-runs detect() (Step 2-3) and re-injects
// per-field "F" buttons on the new fields. No auto-fill — just buttons.
document.addEventListener('click', function(e) {
  var t = e.target.closest('button, a') || e.target;
  if (t.tagName === 'BUTTON' || t.tagName === 'A') {
    var txt = (t.textContent || '').toLowerCase();
    if (txt.includes('apply') || txt.includes('next') || txt.includes('continue')) {
      setTimeout(function() {
        var fields = FormDetector.detect();
        var total = fields.personal.length + fields.questions.length + fields.selects.length;
        if (total > 0) {
          if (!document.getElementById('jc-float-btn')) {
            injectFloatingButton();
          }
          injectPerFieldButtons();
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

// ── Main Init (TRIGGER: page load) ─────────────────────────────────
// Chrome injects this script into the page at document_idle (manifest.json).
// Oracle CX is a single-page app — form fields don't exist in the DOM yet
// when the URL loads. They appear 1-2 seconds later when Oracle's JS renders.
// We wait 1.5s, then call FormDetector.detect() (Step 2-3) to find fields.
// If fields exist, we inject the JC button + per-field "F" buttons.
// NO auto-fill — user clicks Fill All when ready.
async function init() {
  setTimeout(function() {
    detectedFields = FormDetector.detect();
    const totalFields = detectedFields.personal.length +
                        detectedFields.questions.length +
                        detectedFields.selects.length;

    if (totalFields === 0) return;

    injectFloatingButton();
    injectPerFieldButtons();

    console.log("%c🔍 Job Copilot loaded", "font-weight:bold;color:#3b82f6");
    setTimeout(() => FormDetector.debugLog(), 2000);

    chrome.runtime.sendMessage({
      type: 'jc_fields_detected',
      count: totalFields,
    }).catch(() => {});
  }, 1500);
}

// ── Floating Button + Panel ────────────────────────────────────────
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

  document.addEventListener('click', (e) => {
    if (window.__jcFilling) return;
    if (!btn.contains(e.target) && !panel.contains(e.target)) {
      panel.classList.remove('open');
    }
  });
}

// Panel: Fill All + Clear All only
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
      <button class="jc-btn jc-btn-primary" id="jc-fill-all">Fill All</button>
      <button class="jc-btn jc-btn-secondary" id="jc-clear-form" style="margin-top:4px;background:#fef2f2!important;color:#991b1b!important;border:1px solid #fecaca!important">Clear All</button>
      <div id="jc-status-msg"></div>
    </div>
  `;

  jcPanel.querySelector('#jc-panel-close').onclick = () => {
    jcPanel.classList.remove('open');
    panelWasOpen = false;
  };

  jcPanel.querySelector('#jc-fill-all').onclick = async () => {
    window.__jcFilling = true;
    await fillPersonal();
    await fillAIQuestions();
    await fillLearnedRadios();
    window.__jcFilling = false;
  };

  // TRIGGER: user clicks "Clear All" in the panel.
  // Sets the same guard as Fill All (the clear operation modifies the DOM),
  // runs clearForm() which removes all values from the form, then releases the guard.
  jcPanel.querySelector('#jc-clear-form').onclick = () => {
    window.__jcFilling = true;
    clearForm();
    window.__jcFilling = false;
  };

  document.body.appendChild(jcPanel);
  return jcPanel;
}

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
      <span class="jc-stat-label">Questions</span>
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

// ── Per-Field "F" Buttons ─────────────────────────────────────────
// When the page loads or Oracle re-renders a section, this function wraps
// each detected field with a small "F" button that appears on hover.
// Each button is bound to the specific field object that detect() returned.
// Clicking it calls fillSingleField(field) which fills just that one field.
//
// This exists so you can fill individual fields without running Fill All.
// Maybe you only want the name and email filled, not the AI questions.
// Maybe you want to re-fill one field you cleared.
function injectPerFieldButtons() {
  const fields = FormDetector.detect();
  const allFields = [...fields.personal, ...fields.questions, ...fields.selects];

  for (const field of allFields) {
    if (field.el.parentElement?.classList.contains('jc-field-wrapper')) continue;
    if (field.el.type === 'file') continue;

    const btn = document.createElement('button');
    btn.className = 'jc-field-fill-btn';
    btn.title = 'Fill this field';
    btn.textContent = 'F';

    btn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await fillSingleField(field);
    };

    const wrapper = document.createElement('div');
    wrapper.className = 'jc-field-wrapper';
    field.el.parentNode.insertBefore(wrapper, field.el);
    wrapper.appendChild(field.el);
    wrapper.appendChild(btn);
  }
}


// Step 9a: reconstruct resume text from resume_full_data.
// resume_full_data is a JSON object with structured sections (summary,
// experience, education, skills, projects) extracted by the LLM when
// you uploaded your resume in settings. We convert it to plain text
// because that's what the LLM expects as context for answering questions.
async function getResumeText() {
  const data = await chrome.storage.sync.get(['resume_full_data']);
  if (data.resume_full_data) {
    try {
      const full = JSON.parse(data.resume_full_data);
      const sections = full.rawSections || {};
      let text = '';
      if (full.summary) text += full.summary + '\n\n';
      if (sections.experience) {
        for (const e of sections.experience) {
          text += (e.title || '') + ' at ' + (e.company || '') + ' (' + (e.start_date || '') + ' - ' + (e.end_date || '') + ')\n';
          if (e.description) text += e.description + '\n';
        }
        text += '\n';
      }
      if (sections.education) {
        for (const ed of sections.education) {
          text += (ed.degree || '') + ' ' + (ed.field || '') + ' at ' + (ed.school || '') + '\n';
        }
        text += '\n';
      }
      if (sections.skills) text += 'Skills: ' + sections.skills.join(', ') + '\n';
      if (sections.projects) {
        for (const p of sections.projects) text += (p.name || '') + ': ' + (p.description || '') + '\n';
      }
      return text.trim();
    } catch(e) { return ''; }
  }
  return '';
}

// TRIGGER: user clicks the per-field "F" button (hover to reveal).
// Same logic as fillAll but for one field. Textareas go to the LLM
// (Step 9-10 path), everything else goes to the profile fill map
// (Steps 4-5 path). Attaches learning listener (Step 8) either way.
async function fillSingleField(field) {
  const fieldLabel = field.label || field.name || 'field';

  // Textarea → call LLM
  if (field.el instanceof HTMLTextAreaElement) {
    const profile = await chrome.storage.sync.get(['llm_base_url', 'llm_api_key', 'llm_model']);
    const resumeText = await getResumeText();
    if (!resumeText) {
      showStatus('No resume — upload PDF in settings first.', 'error');
      makeStatusClickable();
      return;
    }
    const question = field.label || field.identifiers || 'Answer this question';
    const jd = extractJobDescription();
    LLMClient.getConfig = async () => ({
      baseUrl: (profile.llm_base_url || 'https://api.openai.com/v1').replace(/\/+$/, ''),
      apiKey: profile.llm_api_key || '',
      model: profile.llm_model || 'gpt-4o-mini',
    });
    try {
      showStatus('Generating answer...', 'info');
      const answer = await LLMClient.generateAnswer(question, jd, resumeText);
      await FormDetector.fillField(field, answer);
      await saveAnswer(question, answer);
      showStatus('Answered!', 'success');
    } catch (err) {
      showStatus('LLM error: ' + err.message, 'error');
    }
    return;
  }

  // Everything else → fill from profile
  const fillMap = await buildFillMap();
  const learned = await chrome.storage.sync.get('learned_fields');
  const corrections = learned.learned_fields || {};
  for (const [key, val] of Object.entries(corrections)) {
    if (val) fillMap[key] = val;
  }

  const value = fillMap[field.name];
  if (!value) {
    showStatus('No data for "' + fieldLabel + '"', 'info');
    return;
  }
  if (skipFieldForType(field, value)) {
    showStatus('Skipped "' + fieldLabel + '" (type mismatch)', 'info');
    return;
  }

  const ok = await FormDetector.fillField(field, value);
  if (ok) {
    listenForCorrections([field.el]);
    showStatus('Filled ' + fieldLabel, 'success');
  } else {
    showStatus('Failed to fill ' + fieldLabel, 'error');
  }
}

// ── Fill All — Personal Fields (Steps 2-8) ─────────────────────────
// Step 2: detect fields on page. Step 4: build value map from storage.
// Step 5: look up values and fill. Step 8: attach learning listeners.
async function fillPersonal() {
  const fields = FormDetector.detect();
  const fillMap = await buildFillMap();

  const hasProfileData = Object.values(fillMap).some(v => v && typeof v === 'string' && v.trim().length > 0);
  if (!hasProfileData) {
    showStatus('No profile data — open settings.', 'error');
    makeStatusClickable();
    return;
  }

  const learned = await chrome.storage.sync.get('learned_fields');
  const corrections = learned.learned_fields || {};
  for (const [key, val] of Object.entries(corrections)) {
    if (val) fillMap[key] = val;
  }

  // Step 5: for each detected field, look up its value in the fill map.
  // fillMap keys match field.name because buildFillMap() uses the same
  // names that FormDetector.identify() returns (first_name, email, etc.)
  let filled = 0;
  const filledEls = [];
  for (const field of [...fields.personal, ...fields.selects]) {
    const value = fillMap[field.name];  // Step 5: lookup by field identity
    if (value && !skipFieldForType(field, value)) {
      const ok = await FormDetector.fillField(field, value);
      if (ok) { filled++; filledEls.push(field.el); }
    }
  }

  if (filledEls.length > 0) listenForCorrections(filledEls);
  if (filled > 0) {
    showStatus('Filled ' + filled + ' personal field(s)', 'success');
  } else if (hasProfileData) {
    showStatus('Profile data exists but no fields matched.', 'error');
  }
}

// ── Fill All — AI Questions (Steps 9-10) ───────────────────────────
// Step 9: get resume text from storage, scrape job description from page.
// For each textarea, call the LLM (Step 10) and fill the answer.
async function fillAIQuestions() {
  const profile = await chrome.storage.sync.get([
    'llm_base_url', 'llm_api_key', 'llm_model', 'profile_name',
  ]);
  const resumeText = await getResumeText();

  if (!resumeText) {
    showStatus('No resume — upload PDF in settings first.', 'error');
    makeStatusClickable();
    return;
  }

  const fields = FormDetector.detect();
  const questions = fields.questions;
  if (questions.length === 0) return;

  let jobDescription = extractJobDescription();
  showStatus('Generating ' + questions.length + ' answer(s)...', 'info');

  let filled = 0;
  for (const field of questions) {
    try {
      const question = field.label || field.identifiers || 'Answer this question';
      LLMClient.getConfig = async () => ({
        baseUrl: (profile.llm_base_url || 'https://api.openai.com/v1').replace(/\/+$/, ''),
        apiKey: profile.llm_api_key || '',
        model: profile.llm_model || 'gpt-4o-mini',
      });

      const answer = await LLMClient.generateAnswer(question, jobDescription, resumeText);
      await FormDetector.fillField(field, answer);

      try {
        if (typeof TokenTracker !== 'undefined') {
          const approx = Math.ceil((question.length + answer.length + resumeText.length) / 4);
          TokenTracker.record(profile.llm_model || 'unknown', {
            prompt_tokens: Math.ceil(((question.length + resumeText.length)) / 4),
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

  showStatus('Filled ' + filled + '/' + questions.length + ' question(s)', filled > 0 ? 'success' : 'error');
}

// ── Fill Learned Radios (Step 11) ──────────────────────────────────
// Reads learned_fields from storage. For each radio group on the page,
// checks if the question text matches a stored key. If you previously
// answered "Yes" to "Are you authorized to work?", it checks that button again.
async function fillLearnedRadios() {
  try {
    const result = await chrome.storage.sync.get('learned_fields');
    const corrections = result.learned_fields || {};

    const radios = document.querySelectorAll('input[type="radio"]');
    const groups = new Map();
    radios.forEach(r => {
      if (!r.name) return;
      if (!groups.has(r.name)) groups.set(r.name, []);
      groups.get(r.name).push(r);
    });

    let filled = 0;
    for (const [name, group] of groups) {
      const container = group[0].closest('.input-row, [class*="field"], [class*="question"], label, .apply-flow');
      const questionText = container ? (container.textContent || '').trim().slice(0, 60) : name;
      const key = 'radio_' + questionText;

      const learnedAnswer = corrections[key];
      if (!learnedAnswer) continue;

      const match = group.find(r => {
        const label = (r.labels?.[0]?.textContent || r.value || '').trim();
        return label.toLowerCase().includes(learnedAnswer.toLowerCase());
      });

      if (match && !match.checked) {
        match.checked = true;
        match.dispatchEvent(new Event('change', { bubbles: true }));
        match.dataset.jcFilled = 'true';
        filled++;
      }
    }
    if (filled > 0) console.log('JC: Filled ' + filled + ' radio question(s) from learned answers');
  } catch(e) {
    console.error('JC: Error filling radios:', e);
  }
}

// ── Shared Helpers ─────────────────────────────────────────────────

// Step 4: build a value dictionary from your stored profile data.
// Reads raw values from Chrome storage (set when you extracted your resume),
// splits composite values (full name → first+last, address → street+city+country),
// then merges learned corrections from previous sessions.
// Returns {first_name, last_name, email, phone, country, ...} — keys that
// match what FormDetector.identify() returns as field.name.
async function buildFillMap() {
  const profile = await chrome.storage.sync.get([
    'profile_name', 'profile_email', 'profile_phone', 'profile_linkedin',
    'profile_github', 'profile_website', 'profile_address',
    'profile_work_authorization',
  ]);

  const nameStr = (profile.profile_name || '').trim();
  const nameParts = nameStr ? nameStr.split(/\s+/) : [];
  const firstName = nameParts[0] || '';
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
  const middleName = nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '';

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
    address: hasMultiPartAddr ? '' : address,
    street_address: parseAddr,
    city: parseCity,
    state: '',
    postal_code: '',
    country: parseCountry,
    work_authorization: profile.profile_work_authorization,
  };
}

// Guard: skip filling a field if the value doesn't match the field type.
// For example, don't put a phone number into a URL field, don't put a full
// address into a city field. Returns true to skip, false to proceed.
function skipFieldForType(field, value) {
  if (field.el.type === 'url' && !value.startsWith('http')) return true;
  if (field.el.type === 'url' && /^[\d\s\-+()]{6,}$/.test(value)) return true;
  if (field.name === 'street_address' && !/\d/.test(value)) return true;
  if (field.name === 'address' && value.includes(',')) return true;
  if (field.name === 'postal_code' && (value.length < 3 || /^[a-zA-Z\s]{3,}$/.test(value))) return true;
  if (field.name === 'state' && value.length > 20) return true;
  return false;
}

// ── Learning System ────────────────────────────────��──────────────
// The extension learns from you in two ways:
//
// PATH 1 (this function): JC fills a field, you edit it afterward.
// After Fill All or a per-field fill, this function attaches a one-time
// blur listener to each filled element. "Blur" means leaving the field —
// clicking into it, changing the value, then clicking somewhere else.
// The listener compares the new value against what JC set (stored in
// el.dataset.jcValue). If different, it calls saveLearnedCorrection()
// which writes to learned_fields in Chrome storage.
//
// PATH 2 (MutationObserver, bottom of file): You fill a field that JC
// didn't touch. The observer watches for changes to form elements and
// saves user-initiated edits to learned_fields.
//
// Both paths write to the same place: learned_fields in Chrome storage,
// which is a flat key-value object. Next session, buildFillMap() (Step 4)
// reads your profile fields first, then reads learned_fields and merges
// them on top. Corrections always win over defaults.
function listenForCorrections(filledEls) {
  const seen = new WeakSet();
  for (const el of filledEls) {
    if (seen.has(el)) continue;
    seen.add(el);
    if (!el || !el.dataset) continue;

    const fieldName = el.dataset.jcField || el.id || el.name;
    const filledValue = el.value;
    el.dataset.jcFilled = 'true';
    el.dataset.jcValue = filledValue;

    el.addEventListener('blur', function onBlur() {
      const newValue = el.value.trim();
      const oldValue = el.dataset.jcValue;
      if (newValue && oldValue && newValue !== oldValue) {
        saveLearnedCorrection(fieldName || 'custom', newValue);
        console.log('JC: Learned correction for "' + fieldName + '": "' + newValue + '"');
      }
      el.removeEventListener('blur', onBlur);
    });
  }
}

// Writes one correction to learned_fields in Chrome storage.
// learned_fields is a flat key-value object: {"email": "new@example.com", ...}
// The key is the field name (or id), the value is what you corrected it to.
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

// ── Clear Form ─────────────────────────────────────────────────────

// TRIGGER: user clicks "Clear All" (see createPanel above).
// This function does NOT touch Chrome storage — it only clears the form on
// the page. Your profile, resume data, learned corrections, and saved answers
// all stay intact. If you click Fill All again after clearing, the same data
// gets filled back in.
//
// Oracle's form has seven different kinds of clearable elements, each
// requiring a different approach. This function handles all seven in sequence.
function clearForm() {
  if (!confirm('Clear all fields on this form? This cannot be undone.')) return;

  let cleared = 0;

  // 1. Oracle combobox "Remove value" buttons — the small X icons on
  //    combobox fields like country, phone code. Found by the title attribute.
  const removeBtns = document.querySelectorAll('button[title*="Remove value"]');
  for (const btn of removeBtns) {
    if (btn.offsetHeight > 0 || btn.offsetParent !== null) {
      try { btn.click(); cleared++; } catch(e) {}
    }
  }

  // 2. Profile tile delete buttons — the experience and education cards
  //    that Oracle imports from your profile. Each card has a Delete button.
  const deleteBtns = document.querySelectorAll('button[title="Delete"], button[aria-label="Delete"]');
  for (const btn of deleteBtns) {
    try { btn.click(); cleared++; } catch(e) {}
  }

  // 3. All text inputs, textareas, selects, radios, and checkboxes.
  //    For radios/checkboxes: uncheck. For selects: reset to first option.
  //    For text inputs: set value to empty using the native prototype setter
  //    (to bypass any framework interceptors), dispatch input/change events,
  //    and blur the field. Also removes the jcFilled and jcValue data
  //    attributes that the learning system uses to track what JC filled.
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

  // 4. Oracle's custom pill-shaped buttons — used for skills, languages,
  //    title selection (Mr./Ms.). Each pill is a clickable button.
  const pills = document.querySelectorAll('.cx-select-pill-section');
  for (const pill of pills) {
    if (pill.offsetHeight > 0 && pill.offsetParent !== null) {
      try { pill.click(); cleared++; } catch(e) {}
    }
  }

  // 5. Oracle's custom combobox text inputs — the editable part of
  //    Oracle-style dropdowns where you type to search for options.
  const comboInputs = document.querySelectorAll('.cx-select-input');
  for (const el of comboInputs) {
    if (el.offsetHeight > 0 && el.offsetParent !== null) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      cleared++;
    }
  }

  // 6. Profile-imported tiles — experience, education, and other cards
  //    that Oracle pulled from your profile. Each has internal Delete buttons.
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

  // 7. The "Send me job alerts" checkbox — a standalone checkbox that
  //    isn't part of the application fields but should be cleared too.
  const alertCb = document.getElementById('job-alerts-checkbox');
  if (alertCb && alertCb.checked) {
    alertCb.checked = false;
    alertCb.dispatchEvent(new Event('change', { bubbles: true }));
    cleared++;
  }

  showStatus('Cleared ' + cleared + ' field(s)', 'info');
  console.log('JC: Cleared ' + cleared + ' form field(s)');
}

// ── Job Description Extraction ─────────────────────────────────
// The LLM needs the job description as context to answer questions well.
// This function searches the page for the most likely container element
// using common CSS class patterns. Returns the first match with >200 chars,
// truncated to 4000 chars (to stay within LLM context limits).

function extractJobDescription() {
  const selectors = [
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

  const meta = document.querySelector('meta[name="description"]');
  return (meta?.content || document.title || '');
}

// ── Status Messages ─────────────────────────────────────────────
// Shows a temporary message in the panel (e.g., "Filled 5 field(s)").
// Messages auto-clear after 5 seconds. makeStatusClickable() turns the
// message into a link that opens the extension settings page — used when
// the error is "No resume" so the user can upload one.

function showStatus(msg, type) {
  const el = document.getElementById('jc-status-msg');
  if (!el) return;
  el.className = 'jc-status ' + type;
  el.textContent = msg;
  setTimeout(function() { el.textContent = ''; el.className = 'jc-status'; }, 5000);
}

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

// ── Saved Answers Bank ──────────────────────────────────────────
// When the LLM answers a question, the question-answer pair is saved here
// (up to 50 entries). This lets the options page show your answer history
// and could be used to pre-fill questions you've answered before.

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

// ── Message Listener ─────────────────────────────────────────────
// The popup (popup.js) and background script (background.js) communicate
// with this content script by sending messages. These handlers let the
// popup trigger Fill All or Clear All remotely, and let the popup query
// what fields are on the page.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'jc_fill_all') {
    window.__jcFilling = true;
    (async () => {
      await fillPersonal();
      await fillAIQuestions();
      await fillLearnedRadios();
      window.__jcFilling = false;
    })();
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'jc_clear_form') {
    window.__jcFilling = true;
    clearForm();
    window.__jcFilling = false;
    sendResponse({ ok: true });
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

// ── MutationObserver ─────────────────────────────────────────────
// A MutationObserver is a browser API that lets JavaScript watch the page
// for changes. Every time any HTML element is added, removed, or modified
// anywhere on the page, this observer fires. We use it because Oracle's
// SPA can re-render sections at any time — adding new fields, removing
// old ones — without a full page reload. When that happens, we need to
// re-detect fields and re-inject per-field "F" buttons on the new elements.
//
// The observer is debounced (waits 2 seconds after the last change before
// acting) because Oracle often makes many rapid DOM changes during a
// single transition, and we only want to react once they're done.
//
// It checks __jcFilling to avoid interfering with an active fill operation.
// If filling is in progress, the observer returns early and does nothing.
let detectTimeout = null;
const observer = new MutationObserver(function() {
  // Debounce: clear any pending timeout, start a new 2-second timer.
  // This ensures we only react once Oracle finishes making rapid changes.
  clearTimeout(detectTimeout);
  detectTimeout = setTimeout(function() {
    // If a fill or clear operation is running, don't interfere.
    if (window.__jcFilling) return;

    // Re-detect fields — Oracle may have added or removed elements.
    const fields = FormDetector.detect();
    const total = fields.personal.length + fields.questions.length + fields.selects.length;
    if (total === 0) return;  // no fields found, nothing to do

    // If the panel isn't open, just inject buttons on the new fields.
    // If the panel IS open, update the field counts in the stats display.
    const panel = document.getElementById('jc-panel');
    if (!panel || !panel.classList.contains('open')) {
      if (!document.getElementById('jc-float-btn')) {
        injectFloatingButton();
      }
      injectPerFieldButtons();
    }

    if (panel && panel.classList.contains('open')) {
      updatePanel();
    }
  }, 2000);
});
observer.observe(document.body, { childList: true, subtree: true });

// ── Start ──────────────────────────────────────────────────────────
init();
