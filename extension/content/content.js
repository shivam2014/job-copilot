// ═══════════════════════════════════════════════════════════════
// Content script — injected into job application pages
// Simplified: 3 interactions only — Fill All, per-field button, Clear All
// ═══════════════════════════════════════════════════════════════

// ── State ──────────────────────────────────────────────────────────
let detectedFields = null;
let jcPanel = null;
let panelWasOpen = false;

// ── SPA Navigation Handler ─────────────────────────────────────────
// Re-inject buttons after Apply/Next/Continue (Oracle CX SPA wipe).
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

// ── Main Init ──────────────────────────────────────────────────────
// Wait 1.5s for Oracle CX SPA to render, detect fields, inject buttons.
// NO auto-fill — user clicks when ready.
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

// ── Per-Field Fill Buttons ─────────────────────────────────────────
// Small "F" button next to each detected field.
// Text input → fill from profile. Textarea → call LLM. Select → fill from profile.
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

// Fill one field — text/select from profile, textarea via LLM
async function fillSingleField(field) {
  const fieldLabel = field.label || field.name || 'field';

  // Textarea → call LLM
  if (field.el instanceof HTMLTextAreaElement) {
    const profile = await chrome.storage.sync.get(['llm_base_url', 'llm_api_key', 'llm_model', 'resume_text']);
    if (!profile.resume_text) {
      showStatus('No resume — open settings.', 'error');
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
      const answer = await LLMClient.generateAnswer(question, jd, profile.resume_text);
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

// ── Fill All — Personal Fields ─────────────────────────────────────
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
  if (filled > 0) {
    showStatus('Filled ' + filled + ' personal field(s)', 'success');
  } else if (hasProfileData) {
    showStatus('Profile data exists but no fields matched.', 'error');
  }
}

// ── Fill All — AI Questions ────────────────────────────────────────
async function fillAIQuestions() {
  const profile = await chrome.storage.sync.get([
    'llm_base_url', 'llm_api_key', 'llm_model',
    'resume_text', 'profile_name',
  ]);

  if (!profile.resume_text) {
    showStatus('No resume — open settings.', 'error');
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

      const answer = await LLMClient.generateAnswer(question, jobDescription, profile.resume_text);
      await FormDetector.fillField(field, answer);

      try {
        if (typeof TokenTracker !== 'undefined') {
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

  showStatus('Filled ' + filled + '/' + questions.length + ' question(s)', filled > 0 ? 'success' : 'error');
}

// ── Fill Learned Radios ────────────────────────────────────────────
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

function skipFieldForType(field, value) {
  if (field.el.type === 'url' && !value.startsWith('http')) return true;
  if (field.el.type === 'url' && /^[\d\s\-+()]{6,}$/.test(value)) return true;
  if (field.name === 'street_address' && !/\d/.test(value)) return true;
  if (field.name === 'address' && value.includes(',')) return true;
  if (field.name === 'postal_code' && (value.length < 3 || /^[a-zA-Z\s]{3,}$/.test(value))) return true;
  if (field.name === 'state' && value.length > 20) return true;
  return false;
}

// ── Learning ───────────────────────────────────────────────────────

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

function clearForm() {
  if (!confirm('Clear all fields on this form? This cannot be undone.')) return;

  let cleared = 0;

  // 1. Remove value buttons (combo fields)
  const removeBtns = document.querySelectorAll('button[title*="Remove value"]');
  for (const btn of removeBtns) {
    if (btn.offsetHeight > 0 || btn.offsetParent !== null) {
      try { btn.click(); cleared++; } catch(e) {}
    }
  }

  // 2. Delete buttons on profile tiles
  const deleteBtns = document.querySelectorAll('button[title="Delete"], button[aria-label="Delete"]');
  for (const btn of deleteBtns) {
    try { btn.click(); cleared++; } catch(e) {}
  }

  // 3. Clear all inputs
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

  // 4. Oracle pill selects
  const pills = document.querySelectorAll('.cx-select-pill-section');
  for (const pill of pills) {
    if (pill.offsetHeight > 0 && pill.offsetParent !== null) {
      try { pill.click(); cleared++; } catch(e) {}
    }
  }

  // 5. Oracle combobox inputs
  const comboInputs = document.querySelectorAll('.cx-select-input');
  for (const el of comboInputs) {
    if (el.offsetHeight > 0 && el.offsetParent !== null) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      cleared++;
    }
  }

  // 6. Profile tiles
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

  // 7. Job alerts checkbox
  const alertCb = document.getElementById('job-alerts-checkbox');
  if (alertCb && alertCb.checked) {
    alertCb.checked = false;
    alertCb.dispatchEvent(new Event('change', { bubbles: true }));
    cleared++;
  }

  showStatus('Cleared ' + cleared + ' field(s)', 'info');
  console.log('JC: Cleared ' + cleared + ' form field(s)');
}

// ── Job Description Extraction ─────────────────────────────────────

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

// ── Status Messages ────────────────────────────────────────────────

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

// ── Saved Answers Bank ───────────────��────────��────────────────────

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

// ── Message Listener ───────────────────────────────────────────────

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

// ── SPA Observer ───────────────────────────────────────────────────
// Re-detect on DOM changes. Only re-injects buttons + updates panel.
// NO auto-fill.
let detectTimeout = null;
const observer = new MutationObserver(function() {
  clearTimeout(detectTimeout);
  detectTimeout = setTimeout(function() {
    if (window.__jcFilling) return;

    const fields = FormDetector.detect();
    const total = fields.personal.length + fields.questions.length + fields.selects.length;
    if (total === 0) return;

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
