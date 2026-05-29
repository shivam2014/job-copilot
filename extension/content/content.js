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
    await fillExperience();
    await fillEducation();
    await fillSkills();
    await fillAIQuestions();
    await fillApplicationQuestions();
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
    if (field.el.parentElement?.querySelector('.jc-field-fill-btn')) continue;
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

    // Insert F button into the field's parent container (no wrapping).
    // This preserves Oracle's layout — input + toggle stay siblings.
    field.el.parentElement.style.position = 'relative';
    field.el.parentElement.appendChild(btn);
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

  // [FIX] Smart phone: if form has a separate phone_country_code field,
  // strip the country code prefix from the phone value so each field gets
  // the right portion. If no country code field exists, leave phone as-is
  // (full number with country code). This handles both Oracle CX (split)
  // and Workday/Greenhouse (single field) automatically.
  const hasCountryCodeField = fields.personal.some(f => f.name === 'phone_country_code') ||
                               fields.selects.some(f => f.name === 'phone_country_code');
  if (hasCountryCodeField && fillMap.phone_country_code && fillMap.phone) {
    const cc = fillMap.phone_country_code;
    if (fillMap.phone.startsWith(cc)) {
      fillMap.phone = fillMap.phone.slice(cc.length).replace(/^[-\s]+/, '').trim();
    }
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

// ═══════════════════════════════════════════════════════════════
// fillExperience() — fills work experience entries from resume data
// ═══════════════════════════════════════════════════════════════
// Reads resume_full_data from Chrome storage, iterates over each
// experience entry, clicks "Add Experience" for each one, then fills
// the Employer Name, Job Title, Start/End dates, Employer Country,
// Employer City, and Responsibilities fields.
//
// Oracle CX uses Knockout.js comboboxes for dates and country fields,
// so we reuse FormDetector.fillField() which handles those strategies.
//
// Works across ATS platforms: the field detection (employerName, jobTitle,
// etc.) uses the same identify() scoring, and the combobox strategies
// handle Oracle CX, Workday, and generic dropdowns.
async function fillExperience() {
  const data = await chrome.storage.sync.get('resume_full_data');
  if (!data.resume_full_data) {
    console.log('JC: No resume_full_data — skipping experience');
    return;
  }

  let resumeData;
  try { resumeData = JSON.parse(data.resume_full_data); } catch { return; }
  const experiences = resumeData.rawSections?.experience || [];
  if (experiences.length === 0) {
    console.log('JC: No experience entries in resume');
    return;
  }

  const MONTH_MAP = {
    '01': 'January', '02': 'February', '03': 'March', '04': 'April',
    '05': 'May', '06': 'June', '07': 'July', '08': 'August',
    '09': 'September', '10': 'October', '11': 'November', '12': 'December',
    '1': 'January', '2': 'February', '3': 'March', '4': 'April',
    '5': 'May', '6': 'June', '7': 'July', '8': 'August',
    '9': 'September',
  };

  // Helper: fill an Oracle CX text input using char-by-char typing.
  // This is the ONLY strategy that Knockout.js accepts — DOM assignment
  // and native setter succeed in the DOM but Knockout's observable
  // doesn't update, so Oracle's validation sees the field as empty.
  // Char-by-char makes Knockout see each keystroke as human input.
  async function fillExpField(el, value, fieldName) {
    if (!el) { console.log('JC: fillExpField — element not found for ' + (fieldName || 'unknown')); return false; }
    if (!value) { console.log('JC: fillExpField — empty value for ' + (fieldName || 'unknown')); return false; }
    try {
      el.focus();
      // Clear existing value — use direct assignment (native setter throws
      // "Illegal invocation" on Oracle's custom combobox elements)
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      // Type character by character — Knockout sees each input event as human
      for (let i = 0; i < value.length; i++) {
        el.value = value.substring(0, i + 1);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 15));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      const ok = el.value === value;
      if (ok) {
        console.log('JC: fillExpField [' + fieldName + '] → char-by-char OK');
      } else {
        console.log('JC: fillExpField [' + fieldName + '] → value did not stick (got "' + el.value?.substring(0, 30) + '")');
      }
      return ok;
    } catch(e) {
      console.log('JC: fillExpField [' + fieldName + '] → error: ' + e.message);
      return false;
    }
  }

  // Helper: find the "Add Experience" SUBMIT button (the one at the bottom of the open form)
  function findSubmitBtn() {
    const btns = Array.from(document.querySelectorAll('button'));
    // The submit button is the visible "Add Experience" button inside the form
    return btns.find(b => b.textContent?.trim() === 'Add Experience' && b.offsetHeight > 0 && b.offsetParent !== null);
  }

  // Helper: find the TRIGGER button (the main "Add Experience" button outside the form)
  function findTriggerBtn() {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.find(b => {
      const txt = (b.textContent || '').trim();
      const id = b.id || '';
      return txt === 'Add Experience' && id.includes('profileItemsAddButton') && b.offsetHeight > 0;
    });
  }

  let filled = 0;
  for (const exp of experiences) {
    // Step 1: Click trigger button to open the form
    let trigger = findTriggerBtn();
    if (!trigger) {
      // If no trigger, the form might already be open — try submit first
      const submit = findSubmitBtn();
      if (submit) { submit.click(); await new Promise(r => setTimeout(r, 1500)); }
      trigger = findTriggerBtn();
    }
    if (!trigger) {
      console.log('JC: No "Add Experience" trigger found — skipping');
      break;
    }
    trigger.click();
    // [FIX] Wait longer for Oracle to render the form fields.
    // employerName inputs weren't ready at 2000ms.
    await new Promise(r => setTimeout(r, 3000));

    // Step 2: Fill ALL fields using char-by-char (fillExpField).
    // Wait for the form fields to render (Oracle renders async after Add click).
    // Don't skip optional fields — fill everything we have data for.

    // Employer Name (required)
    let empName = null;
    for (let retry = 0; retry < 6; retry++) {
      const all = document.querySelectorAll('input[name="employerName"]');
      if (all.length > 0) { empName = all[all.length - 1]; break; }
      await new Promise(r => setTimeout(r, 400));
    }
    if (empName && exp.company) await fillExpField(empName, exp.company, "employerName");

    // Job Title
    const allJobTitles = document.querySelectorAll('input[name="jobTitle"]');
    const jobTitle = allJobTitles.length > 0 ? allJobTitles[allJobTitles.length - 1] : null;
    if (jobTitle && exp.title) await fillExpField(jobTitle, exp.title, "jobTitle");

    // Fill Start Date (Month + Year comboboxes)
    if (exp.start_date) {
      const parts = exp.start_date.split('/');
      const monthNum = parts[0] || '';
      const yearStr = parts[1] || '';
      const monthName = MONTH_MAP[monthNum] || monthNum;

      // Try to fill month combobox — find the LAST one (most recently added entry)
      const allStartMonths = document.querySelectorAll('[id*="month-startDate"]');
      const startMonth = allStartMonths.length > 0 ? allStartMonths[allStartMonths.length - 1] : null;
      if (startMonth && monthName) {
        const field = { el: startMonth, name: 'startDate', label: 'Start Month' };
        await FormDetector.fillField(field, monthName);
      }

      const allStartYears = document.querySelectorAll('[id*="year-startDate"]');
      const startYear = allStartYears.length > 0 ? allStartYears[allStartYears.length - 1] : null;
      if (startYear && yearStr) {
        const field = { el: startYear, name: 'startDate', label: 'Start Year' };
        await FormDetector.fillField(field, yearStr);
      }
    }

    // Fill End Date (Month + Year comboboxes)
    if (exp.end_date && exp.end_date.toLowerCase() !== 'present') {
      const parts = exp.end_date.split('/');
      const monthNum = parts[0] || '';
      const yearStr = parts[1] || '';
      const monthName = MONTH_MAP[monthNum] || monthNum;

      const allEndMonths = document.querySelectorAll('[id*="month-endDate"]');
      const endMonth = allEndMonths.length > 0 ? allEndMonths[allEndMonths.length - 1] : null;
      if (endMonth && monthName) {
        const field = { el: endMonth, name: 'endDate', label: 'End Month' };
        await FormDetector.fillField(field, monthName);
      }

      const allEndYears = document.querySelectorAll('[id*="year-endDate"]');
      const endYear = allEndYears.length > 0 ? allEndYears[allEndYears.length - 1] : null;
      if (endYear && yearStr) {
        const field = { el: endYear, name: 'endDate', label: 'End Year' };
        await FormDetector.fillField(field, yearStr);
      }
    }

    // Fill Employer Country — use char-by-char
    const allCountries = document.querySelectorAll('[id*="countryCode"]');
    const empCountry = allCountries.length > 0 ? allCountries[allCountries.length - 1] : null;
    if (empCountry) {
      const cityCountryMap = {
        'linz': 'Austria', 'toulouse': 'France', 'krakow': 'Poland',
        'gdansk': 'Poland', 'warsaw': 'Poland', 'paris': 'France',
        'london': 'United Kingdom', 'munich': 'Germany',
        'berlin': 'Germany', 'hamburg': 'Germany', 'amsterdam': 'Netherlands',
        'dublin': 'Ireland', 'madrid': 'Spain', 'barcelona': 'Spain',
        'rome': 'Italy', 'milan': 'Italy', 'zurich': 'Switzerland',
        'vienna': 'Austria', 'brussels': 'Belgium', 'stockholm': 'Sweden',
        'copenhagen': 'Denmark', 'oslo': 'Norway', 'helsinki': 'Finland',
        'bangalore': 'India', 'hyderabad': 'India', 'mumbai': 'India',
        'pune': 'India', 'delhi': 'India', 'chennai': 'India',
        'new york': 'United States', 'san francisco': 'United States',
        'seattle': 'United States', 'austin': 'United States',
        'chicago': 'United States', 'boston': 'United States',
        'los angeles': 'United States', 'toronto': 'Canada',
        'montreal': 'Canada', 'vancouver': 'Canada',
        'tokyo': 'Japan', 'singapore': 'Singapore',
        'sydney': 'Australia', 'melbourne': 'Australia',
        'dubai': 'United Arab Emirates', 'tel aviv': 'Israel',
      };
      const country = cityCountryMap[(exp.city || '').toLowerCase()] || '';
      if (country) await fillExpField(empCountry, country, "employerCountry");
    }

    // Fill Employer City — find the LAST one
    const allCities = document.querySelectorAll('input[name="employerCity"]');
    const empCity = allCities.length > 0 ? allCities[allCities.length - 1] : null;
    if (empCity && exp.city) await fillExpField(empCity, exp.city, "employerCity");

    // Fill Responsibilities — find the LAST textarea
    const allResp = document.querySelectorAll('textarea[name="responsibilities"]');
    const resp = allResp.length > 0 ? allResp[allResp.length - 1] : null;
    if (resp && exp.description) await fillExpField(resp, exp.description, "responsibilities");

    // Step 3: Click the SUBMIT button to save this entry.
    // The "Add Experience" button at the bottom of the open form is the submit.
    // After clicking, the form closes and the entry is saved as a tile.
    await new Promise(r => setTimeout(r, 500));
    const submitBtn = findSubmitBtn();
    if (submitBtn) {
      submitBtn.click();
      console.log('JC: Submitted experience entry ' + (filled + 1) + ': ' + (exp.company || 'unknown'));
      await new Promise(r => setTimeout(r, 2000)); // Wait for form to close and tile to appear
    } else {
      console.log('JC: No submit button found for experience entry ' + (filled + 1));
    }

    filled++;
  }

  if (filled > 0) {
    showStatus('Added ' + filled + ' experience(s)', 'success');
    console.log('JC: Filled ' + filled + ' experience entries');
  }
}

// ═══════════════════════════════════════════════════════════════
// fillEducation() — fills education entries from resume data
// ═══════════════════════════════════════════════════════════════
// Similar to fillExperience but for education section.
// Oracle CX education fields use comboboxes for Degree, School,
// and Education Level — all handled by FormDetector.fillField().
async function fillEducation() {
  const data = await chrome.storage.sync.get('resume_full_data');
  if (!data.resume_full_data) { console.log('JC: No resume_full_data — skipping education'); return; }

  let resumeData;
  try { resumeData = JSON.parse(data.resume_full_data); } catch(e) { console.log('JC: Education parse error:', e.message); return; }
  const education = resumeData.rawSections?.education || [];
  if (education.length === 0) { console.log('JC: No education entries in resume'); return; }
  console.log('JC: fillEducation — ' + education.length + ' entries found');

  const degreeMap = {
    'masters of science': 'Master of Science', 'master of science': 'Master of Science',
    'msc': 'Master of Science', 'bachelors of technology': 'Bachelor of Technology',
    'bachelor of technology': 'Bachelor of Technology', 'btech': 'Bachelor of Technology',
    'bachelor of science': 'Bachelor of Science', 'phd': 'Doctorate', 'doctorate': 'Doctorate',
  };

  let filled = 0;
  for (const edu of education) {
    // Step 1: Open the education form.
    // Scroll to Education heading first, then find and click the Add button.
    // The form may already be open from a previous iteration — check for degree field.
    const eduHeading = Array.from(document.querySelectorAll('h3')).find(h => h.textContent?.trim() === 'Education');
    if (eduHeading) eduHeading.scrollIntoView({ behavior: 'instant', block: 'start' });
    await new Promise(r => setTimeout(r, 500));

    let formReady = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const degreeEls = document.querySelectorAll('[name="contentItemId"]');
      if (Array.from(degreeEls).some(el => el.offsetHeight > 0)) { formReady = true; break; }

      // Try clicking the Add Education button (any matching button, visible or not)
      const allBtns = Array.from(document.querySelectorAll('button'));
      const addBtn = allBtns.find(b => {
        const txt = (b.textContent || '').trim();
        return txt === 'Add Education' && (b.id || '').includes('profileItemsAddButton');
      }) || allBtns.find(b => (b.textContent || '').trim() === 'Add Education');
      if (addBtn) {
        // [FIX] Use real mouse events — Oracle's Knockout binding ignores
        // synthetic click() on hidden elements. PointerEvent + mousedown
        // + mouseup simulates a real user click.
        const rect = addBtn.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window, button: 0 };
        addBtn.dispatchEvent(new PointerEvent('pointerdown', opts));
        addBtn.dispatchEvent(new MouseEvent('mousedown', opts));
        await new Promise(r => setTimeout(r, 50));
        addBtn.dispatchEvent(new PointerEvent('pointerup', opts));
        addBtn.dispatchEvent(new MouseEvent('mouseup', opts));
        addBtn.dispatchEvent(new MouseEvent('click', opts));
        console.log('JC: Clicked Add Education (attempt ' + attempt + ')');
      }
      await new Promise(r => setTimeout(r, 700));
    }
    if (!formReady) { console.log('JC: Education form did not open — skipping entry ' + (filled + 1)); continue; }

    // Step 2: Fill fields using fillExpField (char-by-char, works with Knockout)
    // Degree
    const allDegrees = document.querySelectorAll('[name="contentItemId"]');
    const degree = allDegrees.length > 0 ? allDegrees[allDegrees.length - 1] : null;
    if (degree && edu.degree) {
      const normalized = degreeMap[edu.degree.toLowerCase()] || edu.degree;
      const ok = await fillExpField(degree, normalized, 'degree');
      console.log('JC: edu degree → ' + ok + ' "' + (degree.value || '') + '"');
    }

    // School
    const allSchools = document.querySelectorAll('[name="educationalEstablishment"]');
    const school = allSchools.length > 0 ? allSchools[allSchools.length - 1] : null;
    if (school && edu.school) {
      const ok = await fillExpField(school, edu.school, 'school');
      console.log('JC: edu school → ' + ok + ' "' + (school.value || '') + '"');
    }

    // Education Level
    const allLevels = document.querySelectorAll('[name="educationLevel"]');
    const level = allLevels.length > 0 ? allLevels[allLevels.length - 1] : null;
    if (level && edu.degree) {
      const dl = edu.degree.toLowerCase();
      let eduLevel = 'Bachelors Degree';
      if (dl.includes('master') || dl.includes('msc') || dl.includes('m.s')) eduLevel = 'Masters Degree';
      else if (dl.includes('phd') || dl.includes('doctor')) eduLevel = 'Doctorate';
      const ok = await fillExpField(level, eduLevel, 'level');
      console.log('JC: edu level → ' + ok + ' "' + (level.value || '') + '"');
    }

    // Step 3: Submit the entry
    await new Promise(r => setTimeout(r, 500));
    const eduSubmit = Array.from(document.querySelectorAll('button')).find(b =>
      (b.textContent || '').trim() === 'Add Education' && b.offsetHeight > 0
    );
    if (eduSubmit) {
      eduSubmit.click();
      console.log('JC: Submitted education entry ' + (filled + 1) + ': ' + (edu.school || 'unknown'));
      await new Promise(r => setTimeout(r, 2000));
    } else {
      console.log('JC: No submit button for education entry ' + (filled + 1));
    }

    filled++;
  }

  if (filled > 0) {
    showStatus('Added ' + filled + ' education(s)', 'success');
    console.log('JC: Filled ' + filled + ' education entries');
  }
}

// ═══════════════════════════════════════════════════════════════
// fillSkills() — selects matching skill suggestions from resume
// ═══════════════════════════════════════════════════════════════
// Oracle CX shows pre-populated skill suggestions as buttons with
// aria-label="Add Skill X". This function reads skills from
// resume_full_data, matches them against the suggestions (fuzzy),
// and clicks the matching "Add Skill" buttons.
//
// For skills that don't match any suggestion, it clicks "Add More
// Skills" and types the skill name into the search field.
//
// Works across ATS: Greenhouse and Lever have similar skill tag UIs.
async function fillSkills() {
  const data = await chrome.storage.sync.get('resume_full_data');
  if (!data.resume_full_data) return;

  let resumeData;
  try { resumeData = JSON.parse(data.resume_full_data); } catch { return; }
  const skills = resumeData.rawSections?.skills || [];
  if (skills.length === 0) return;

  // Find all "Add Skill" suggestion buttons
  const skillBtns = Array.from(document.querySelectorAll('button')).filter(b => {
    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
    return aria.includes('add skill') && b.offsetHeight > 0;
  });

  let addedFromSuggestions = 0;
  const unmatchedSkills = [];

  for (const skill of skills) {
    const skillLower = skill.toLowerCase().trim();
    if (!skillLower) continue;

    // Try to match against suggestion buttons (fuzzy: check if skill words appear in button text)
    const match = skillBtns.find(b => {
      const btnText = (b.getAttribute('aria-label') || b.textContent || '').toLowerCase();
      const skillWords = skillLower.split(/[\s,]+/);
      // Check if any significant word from the skill appears in the button text
      return skillWords.some(w => w.length > 3 && btnText.includes(w)) ||
             btnText.includes(skillLower);
    });

    if (match) {
      match.click();
      addedFromSuggestions++;
      // Remove from available buttons so we don't click it again
      const idx = skillBtns.indexOf(match);
      if (idx >= 0) skillBtns.splice(idx, 1);
      await new Promise(r => setTimeout(r, 300));
    } else {
      unmatchedSkills.push(skill);
    }
  }

  // [FIX] Don't click "Add More Skills" — it opens a form that replaces
  // the skill suggestion buttons. Only click the pre-populated suggestions.
  // Unmatched skills are skipped (they'd require the form which is destructive).

  const total = addedFromSuggestions;
  if (total > 0) {
    showStatus('Added ' + total + ' skill(s)', 'success');
    console.log('JC: Added ' + addedFromSuggestions + ' from suggestions, ' + Math.min(unmatchedSkills.length, 10) + ' custom');
  }
}

// ═══════════════════════════════════════════════════════════════
// fillApplicationQuestions() — answers Yes/No radio questions
// ═══════════════════════════════════════════════════════════════
// Oracle CX application forms typically have Yes/No radio button
// questions about employment history, government relations, etc.
// Safe default: "No" for all questions. Users can correct via the
// learning system (listenForCorrections picks up manual changes).
//
// The LLM could answer these more accurately, but without it we
// default to the safest answer. This works across all ATS platforms
// that use radio button questions.
async function fillApplicationQuestions() {
  let filled = 0;

  // Strategy 1: Traditional radio buttons
  const radios = document.querySelectorAll('input[type="radio"]');
  const groups = new Map();
  radios.forEach(r => {
    if (!r.name || r.offsetHeight === 0) return;
    if (!groups.has(r.name)) groups.set(r.name, []);
    groups.get(r.name).push(r);
  });

  for (const [name, group] of groups) {
    if (group.some(r => r.checked)) continue;
    const noBtn = group.find(r => {
      const label = (r.labels?.[0]?.textContent || r.value || '').toLowerCase().trim();
      return label === 'no';
    });
    if (noBtn) {
      noBtn.checked = true;
      noBtn.dispatchEvent(new Event('change', { bubbles: true }));
      noBtn.dataset.jcFilled = 'true';
      filled++;
    }
  }

  // Strategy 2: Oracle CX uses <button> Yes/No pairs, not radio inputs.
  // Find the Application Questions section, then click every visible "No" button.
  // These buttons are grouped in pairs — each question has a Yes and No button.
  // We click "No" as the safe default for all employment/government questions.
  const headings = Array.from(document.querySelectorAll('h3'));
  const aqHeading = headings.find(h => h.textContent?.trim() === 'Application Questions');
  if (aqHeading) {
    let container = aqHeading.parentElement;
    // Walk up to find the full section container
    for (let i = 0; i < 5 && container; i++) {
      if (container.querySelectorAll('button').length > 10) break;
      container = container.parentElement;
    }
    if (container) {
      // Find pairs of Yes/No buttons. Each question has exactly one Yes and one No.
      // We click "No" for each pair that doesn't already have a selection.
      const allBtns = Array.from(container.querySelectorAll('button'));
      for (const btn of allBtns) {
        const text = (btn.textContent || '').trim().toLowerCase();
        if (text === 'no' && btn.offsetHeight > 0) {
          // Check if the sibling Yes button is not in a "selected" state
          const parent = btn.parentElement;
          const yesBtn = parent ? Array.from(parent.querySelectorAll('button')).find(b =>
            (b.textContent || '').trim().toLowerCase() === 'yes'
          ) : null;
          // If Yes is not visually selected (no special class), click No
          if (yesBtn && !yesBtn.classList.contains('selected') && !yesBtn.classList.contains('active') &&
              !yesBtn.getAttribute('aria-pressed')?.includes('true')) {
            btn.click();
            filled++;
          } else if (!yesBtn) {
            // No sibling Yes found — just click No
            btn.click();
            filled++;
          }
        }
      }
    }
  }

  if (filled > 0) {
    console.log('JC: Answered ' + filled + ' application question(s)');
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
    'profile_work_authorization', 'resume_full_data',
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
    // [FIX] Smart phone handling: store BOTH full number and split parts.
    // The fill logic (fillPersonal) decides which to use based on whether
    // the form has a separate phone_country_code field.
    // - Portal with separate country code combobox (Oracle CX): use split
    // - Portal with single phone field (Workday, Greenhouse): use full number
    // This works across all ATS platforms without hardcoding per-vendor logic.
    phone_country_code: (function() {
      const raw = (profile.profile_phone || '').trim();
      const m = raw.match(/^\+(\d{1,3})/);
      return m ? ('+' + m[1]) : '';
    })(),
    phone: (profile.profile_phone || '').trim(),
    linkedin: profile.profile_linkedin,
    github: profile.profile_github,
    // [FIX] Use LinkedIn as website fallback for "Link 1" fields.
    // Oracle CX has siteLink-1 (type=url) for supporting documents.
    // If profile_website is empty, use linkedin URL so the field gets filled.
    website: profile.profile_website || profile.profile_linkedin || '',
    address: hasMultiPartAddr ? '' : address,
    street_address: parseAddr,
    city: parseCity,
    state: '',
    postal_code: '',
    // [FIX] Country fallback from resume data when profile_address is empty.
    // Resume extraction stores country in extractedFields.country (e.g., "Poland").
    country: parseCountry || (function() {
      try { return JSON.parse(profile.resume_full_data || '{}').extractedFields?.country || ''; } catch { return ''; }
    })(),
    work_authorization: profile.profile_work_authorization,
  };
}

// Guard: skip filling a field if the value doesn't match the field type.
// For example, don't put a phone number into a URL field, don't put a full
// address into a city field. Returns true to skip, false to proceed.
function skipFieldForType(field, value) {
  // [FIX] Allow URL fields to accept values without http prefix.
  // The linkedin/github URLs from profile may or may not have https://.
  // Also allow phone_country_code values (like "+33") through — they're
  // short and look numeric but are valid for combobox fields.
  if (field.name === 'phone_country_code') return false;
  if (field.el.type === 'url' && !value.startsWith('http')) {
    // Auto-prefix if it looks like a URL path (linkedin.com, github.com, etc.)
    if (/^[a-z]+\.com/i.test(value) || /^[a-z]+\.io/i.test(value)) {
      field.el.value = 'https://' + value; // prefix it inline — will be overwritten by fill
    }
    // Don't skip — let fillField() handle it
  }
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
      await fillExperience();
      await fillEducation();
      await fillSkills();
      await fillAIQuestions();
      await fillApplicationQuestions();
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

// ── Hot-reload trigger ──────────────────────────────────────────
// Dispatch a custom "jc-reload" event on document to trigger extension reload.
// Usage from DevTools console or Playwright:
//   document.dispatchEvent(new Event('jc-reload'))
document.addEventListener('jc-reload', function() {
  console.log('JC: Hot-reload triggered via DOM event');
  chrome.runtime.sendMessage({ type: 'jc_reload_extension' }, function(resp) {
    console.log('JC: Reload response:', resp);
  });
});
