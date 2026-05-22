// Options page — LLM config first → PDF upload → extract text → LLM extract profile → edit → save

document.addEventListener('DOMContentLoaded', async () => {
  const result = await chrome.storage.sync.get(null);
  
  // Load saved values into form
  const fields = [
    'llm_base_url', 'llm_api_key', 'llm_model',
    'profile_name', 'profile_email', 'profile_phone',
    'profile_linkedin', 'profile_github', 'profile_website',
    'profile_address', 'profile_work_authorization',
    'resume_text',
  ];
  fields.forEach(f => {
    const el = document.getElementById(f);
    if (el && result[f] !== undefined) el.value = result[f];
  });

  // Set LLM defaults if empty
  if (!document.getElementById('llm_base_url').value)
    document.getElementById('llm_base_url').value = 'http://localhost:19530/v1';
  if (!document.getElementById('llm_api_key').value)
    document.getElementById('llm_api_key').value = 'dummy';
  // Clear model if it was a pre-filled default from an older version
  const savedModel = document.getElementById('llm_model').value;
  if (savedModel && ['gpt-4o-mini', 'deepseek-v4-flash-2'].includes(savedModel)) {
    document.getElementById('llm_model').value = '';
  }
  // Model loaded on focus from endpoint's /v1/models

  renderSavedAnswers(result.saved_answers || []);
  updateConfigStatus();
  checkModelNeeded();

  // --- PDF Upload ---
  const uploadArea = document.getElementById('upload-area');
  const fileInput = document.getElementById('resume_file');
  const uploadStatus = document.getElementById('upload-status');
  const uploadPrompt = document.getElementById('upload-prompt');

  uploadArea.onclick = () => fileInput.click();
  document.getElementById('show-paste-link').onclick = (e) => {
    e.preventDefault();
    const ta = document.getElementById('resume_text');
    ta.style.display = 'block';
    ta.focus();
    e.target.style.display = 'none';
    // Re-enable extract button when manually pasting text
    document.getElementById('extract-btn').disabled = false;
    document.getElementById('extract-btn').textContent = '🔍 Extract Profile';
  };
  uploadArea.ondragover = (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); };
  uploadArea.ondragleave = () => uploadArea.classList.remove('dragover');
  uploadArea.ondrop = (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handlePDF(e.dataTransfer.files[0]);
  };
  fileInput.onchange = (e) => { if (e.target.files[0]) handlePDF(e.target.files[0]); };

  async function handlePDF(file) {
    if (!file.name.endsWith('.pdf')) {
      showUploadStatus('Please upload a PDF file', 'error');
      return;
    }
    showUploadStatus(`Reading ${file.name}...`, 'loading');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const text = await extractTextFromPDF(arrayBuffer);
      showUploadStatus(`✅ ${file.name} — ${text.length} chars`, 'success');
      // Auto-extract profile directly (skip textarea)
      await runExtraction(text, file.name);
    } catch (err) {
      showUploadStatus(`❌ ${err.message}`, 'error');
    }
  }

  function showUploadStatus(msg, type) {
    uploadPrompt.style.display = 'none';
    uploadStatus.style.display = 'block';
    uploadStatus.className = 'upload-status ' + type;
    uploadStatus.textContent = msg;
  }

  // --- runExtraction (shared by PDF upload + button) ---
  let extractAbort = null;

  async function runExtraction(resumeText, sourceLabel) {
    const baseUrl = (document.getElementById('llm_base_url').value || 'http://localhost:19530/v1').trim().replace(/\/+$/, '');
    const apiKey = document.getElementById('llm_api_key').value || 'dummy';
    const model = document.getElementById('llm_model').value.trim() || '';
    const statusEl = document.getElementById('extract-status');
    const btn = document.getElementById('extract-btn');

    if (!baseUrl) { statusEl.textContent = 'Enter an API Base URL first'; statusEl.className = 'field-hint error'; return; }
    if (!model) { statusEl.textContent = 'Select a model first (click the Model field)'; statusEl.className = 'field-hint error'; return; }

    // Disable button during extraction
    btn.disabled = true;
    btn.textContent = sourceLabel ? '⏳ Extracting from PDF...' : '⏳ Extracting...';
    statusEl.textContent = 'Calling AI to parse your resume...  [cancel]';
    statusEl.className = 'field-hint loading';
    statusEl.style.cursor = 'pointer';
    statusEl.onclick = function() { cancelExtraction(); };
    extractAbort = new AbortController();

    try {
      const prompt = 'You are a resume parser. Output ONLY valid JSON with these fields. No thinking, no markdown, no backticks, no explanations. JSON must start with { and end with }. Fields: name, email, phone, linkedin, github, website, address, work_authorization, summary, skills[], experience[{title,company,start_date,end_date,description}], education[{school,degree,field,start_date,end_date}], languages[{name,level}], projects[{name,description}], publications[]. Empty string if missing. No null.';
      const resp = await fetch(baseUrl + '/chat/completions', {
        signal: extractAbort.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ model: model, messages: [{ role: 'system', content: prompt }, { role: 'user', content: 'Resume:\n\n' + resumeText.slice(0, 4000) }], temperature: 0.01, max_tokens: 8000 }),
      });
      if (!resp.ok) throw new Error('API ' + resp.status + ': ' + (await resp.text().catch(function() { return resp.statusText; })));
      const data = await resp.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error('Empty response from API');
      if (data.usage) { try { TokenTracker.record(model, data.usage); } catch(e) {} }
      let raw = (msg.content || msg.reasoning_content || '').trim();
      if (!raw) throw new Error('Empty response from API');
      // Try markdown fenced JSON first
      const jm = raw.match(/\`\`\`(?:json)?\s*(\{[\s\S]*?\})\s*\`\`\`/);
      if (jm) { raw = jm[1]; }
      // Find JSON by walking back from last } to matching {
      var end = raw.lastIndexOf('}');
      if (end === -1) throw new Error('No JSON found');
      var depth = 0, start = -1;
      for (var i = end; i >= 0; i--) {
        if (raw[i] === '}') depth++;
        else if (raw[i] === '{') depth--;
        if (depth === 0) { start = i; break; }
      }
      if (start === -1) throw new Error('Unbalanced JSON');
      var jsonStr = raw.slice(start, end + 1);
      const profile = JSON.parse(jsonStr);
      const fieldMap = { profile_name: 'name', profile_email: 'email', profile_phone: 'phone', profile_linkedin: 'linkedin', profile_github: 'github', profile_website: 'website', profile_address: 'address', profile_work_authorization: 'work_authorization', profile_summary: 'summary' };
      // Store full resume data for AI context
      var fullData = { extractedFields: {}, rawSections: {} };
      for (var k in profile) { if (typeof profile[k] === 'object' || Array.isArray(profile[k])) { fullData.rawSections[k] = profile[k]; } else { fullData.extractedFields[k] = profile[k]; } }
      // Normalize dates in experience and education to MM/YYYY format
      var monthsMap = {'jan':'01','feb':'02','mar':'03','apr':'04','may':'05','jun':'06','jul':'07','aug':'08','sep':'09','oct':'10','nov':'11','dec':'12'};
      ['experience','education'].forEach(function(section) {
        if (fullData.rawSections[section]) {
          fullData.rawSections[section].forEach(function(item) {
            ['start_date','end_date'].forEach(function(field) {
              if (item[field] && typeof item[field] === 'string') {
                var m = item[field].match(/^([a-z]{3})\s*(\d{4})$/i);
                if (m && monthsMap[m[1].toLowerCase()]) {
                  item[field] = monthsMap[m[1].toLowerCase()] + '/' + m[2];
                }
              }
            });
          });
        }
      });
      let filled = 0;
      for (const [id, key] of Object.entries(fieldMap)) {
        const el = document.getElementById(id);
        if (profile[key] && profile[key].trim()) { el.value = profile[key].trim(); filled++; }
      if (key === 'summary') { var rs = document.getElementById('rd_summary'); if (rs && profile.summary) rs.value = profile.summary; }
      }
      // Save full resume data for AI context
      try { chrome.storage.sync.set({ resume_full_data: JSON.stringify(fullData) }); } catch(e) {}
      // Auto-save extracted profile
      if (typeof debouncedSave === 'function') debouncedSave();
      statusEl.textContent = '✅ Extracted ' + filled + ' field(s)' + (sourceLabel ? ' from ' + sourceLabel : '') + '. Review and edit below.';
      statusEl.className = 'field-hint success';
      if (sourceLabel) {
        btn.disabled = true;
        btn.textContent = '✅ Already extracted from PDF';
      } else {
        btn.disabled = false;
        btn.textContent = '🔍 Extract Profile';
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        statusEl.textContent = '❌ Cancelled';
      } else {
        statusEl.textContent = '❌ ' + err.message;
      }
      statusEl.className = 'field-hint error';
      btn.disabled = false;
      btn.textContent = '🔍 Extract Profile';
    }
    statusEl.style.cursor = 'default';
    statusEl.onclick = null;
    extractAbort = null;
  }

  function cancelExtraction() {
    if (extractAbort) {
      extractAbort.abort();
    }
  }

  // --- Extract Profile button ---
  document.getElementById('extract-btn').onclick = async () => {
    const text = document.getElementById('resume_text').value.trim();
    if (!text) { setExtractStatus('Upload a PDF or paste resume text first', 'error'); return; }
    await runExtraction(text, null);
  };
  // --- Auto-save on any field change ---
  let saveTimer = null;
  async function autoSave() {
    const data = {};
    fields.forEach(f => { data[f] = document.getElementById(f).value.trim(); });
    const existing = await chrome.storage.sync.get('saved_answers');
    if (existing.saved_answers) data.saved_answers = existing.saved_answers;
    try {
      await chrome.storage.sync.set(data);
      showMsg('✅ Saved', 'success');
    } catch (err) {
      showMsg(`❌ Save error: ${err.message}`, 'error');
    }
  }

  function debouncedSave() {
    showMsg('Saving...', '');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(autoSave, 600);
  }

  // Listen to all field changes
  fields.forEach(f => {
    const el = document.getElementById(f);
    if (el) el.addEventListener('input', debouncedSave);
  });

  // Remove the save button — replaced by auto-save
  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) {
    saveBtn.textContent = '✅ Auto-save active';
    saveBtn.disabled = true;
    saveBtn.style.opacity = '0.6';
  }

  // Load token usage on page open
  setTimeout(renderTokenUsage, 500);
  setTimeout(renderResumeData, 600);
  setTimeout(function() {
    chrome.storage.sync.get('resume_full_data', function(r) {
      if (r.resume_full_data) {
        try { renderTagLists(JSON.parse(r.resume_full_data)); } catch(e) {}
      }
    });
  }, 700);
  
  // Do an initial save to persist any loaded values
  setTimeout(autoSave, 1000);
});

// --- Saved Answers ---
function renderSavedAnswers(answers) {
  const container = document.getElementById('saved-answers-list');
  if (!answers || answers.length === 0) {
    container.innerHTML = '<p class="empty-state">No saved answers yet. Use the ✨ AI button on application forms to generate and save answers.</p>';
    return;
  }
  container.innerHTML = answers.map((qa, i) => `
    <div class="saved-qa">
      <div class="qa-question"><strong>Q:</strong> ${escHtml(qa.question)}</div>
      <div class="qa-answer"><strong>A:</strong> ${escHtml(qa.answer)}</div>
      <button class="qa-delete" data-index="${i}">✕</button>
    </div>
  `).join('');
}

function escHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
function setExtractStatus(text, type) {
  const el = document.getElementById('extract-status');
  el.textContent = text; el.className = type || '';
}
function showMsg(text, type) {
  const el = document.getElementById('save-msg');
  el.textContent = text; el.className = 'save-msg ' + type;
  setTimeout(() => { el.textContent = ''; el.className = 'save-msg'; }, 4000);
}

// --- Test connection (checks if model + endpoint work) ---
async function testConnection() {
  const baseUrl = (document.getElementById('llm_base_url').value || '').trim().replace(/\/+$/, '');
  const apiKey = document.getElementById('llm_api_key').value || '';
  const model = document.getElementById('llm_model').value.trim();
  
  if (!baseUrl || !model) return;
  
  const hint = document.getElementById('model-count');
  hint.textContent = 'Testing connection...';
  hint.className = 'field-hint loading';

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: 'Reply exactly: ok' }],
        max_tokens: 5,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => '');
      throw new Error(`${resp.status}${err ? ': ' + err : ''}`);
    }

    const data = await resp.json();
    
    // Track token usage
    if (data.usage) {
      try { TokenTracker.record(model, data.usage); } catch(e) {}
    }
    
    const reply = (data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '').trim();
    
    if (reply) {
      hint.textContent = '✅ Connection OK — model responds';
      hint.className = 'field-hint success';
      chrome.storage.sync.set({ config_tested: 'ok' });
      updateConfigStatus();
    } else {
      hint.textContent = '⚠️ Connected but empty response — model may not be ready';
      hint.className = 'field-hint';
    }
  } catch (err) {
    hint.textContent = `❌ ${err.message}`;
    hint.className = 'field-hint error';
    chrome.storage.sync.set({ config_tested: 'error' });
    updateConfigStatus();
  }
}

// --- Config Status ---
function updateConfigStatus() {
  const badge = document.getElementById('config-status');
  const warning = document.getElementById('config-warning');
  if (!badge) return;
  
  const baseUrl = (document.getElementById('llm_base_url').value || '').trim();
  const apiKey = document.getElementById('llm_api_key').value || '';
  const model = document.getElementById('llm_model').value || '';
  
  // Check saved test status
  chrome.storage.sync.get('config_tested', (result) => {
    const needsAttention = !result.config_tested || result.config_tested === 'error';
    
    if (result.config_tested === 'ok') {
      badge.className = 'config-badge connected';
      badge.textContent = '✅ Connected';
      if (warning) warning.style.display = 'none';
      const alert = document.getElementById('config-alert');
      if (alert) { alert.style.display = 'none'; }
    } else if (result.config_tested === 'error') {
      badge.className = 'config-badge error';
      badge.textContent = '❌ Connection failed';
      const alert = document.getElementById('config-alert');
      if (alert) { alert.className = 'config-alert error'; alert.style.display = 'flex'; document.getElementById('config-alert-text').innerHTML = 'Connection failed. Check your API URL, key, and model below. <a href="#" id="alert-test-link" style="color:#991b1b">Test again</a>'; document.getElementById('alert-test-link')?.addEventListener('click', (e) => { e.preventDefault(); testConnection(); }); }
      if (warning) { warning.style.display = 'block'; warning.innerHTML = '<strong>❌ Connection failed</strong> — check your API URL, key, and model. <a href="#" id="test-now-link" style="color:#991b1b;font-weight:600">Test again</a>'; document.getElementById('test-now-link')?.addEventListener('click', (e) => { e.preventDefault(); testConnection(); }); }
    } else if (baseUrl && (baseUrl.includes('localhost') || baseUrl.includes('dummy'))) {
      badge.className = 'config-badge untested';
      badge.textContent = '⚠️ Default — configure or test';
      const alert = document.getElementById('config-alert');
      if (alert) { alert.className = 'config-alert'; alert.style.display = 'flex'; document.getElementById('config-alert-text').innerHTML = 'The default configuration uses a local Nyro endpoint. <a href="#" id="alert-test-link" style="color:#92400e;font-weight:600">Test connection</a> or enter your own API URL and key.'; document.getElementById('alert-test-link')?.addEventListener('click', (e) => { e.preventDefault(); testConnection(); }); }
      if (warning) { warning.style.display = 'block'; warning.innerHTML = '<strong>🔧 Configure your AI Engine</strong> — defaults use a local Nyro endpoint. <a href="#" id="test-now-link" style="color:#92400e;font-weight:600">Test connection</a> or enter your own API URL, key, and model.'; document.getElementById('test-now-link')?.addEventListener('click', (e) => { e.preventDefault(); testConnection(); }); }
    } else if (baseUrl) {
      badge.className = 'config-badge untested';
      badge.textContent = '⚠️ Untested';
      const alert = document.getElementById('config-alert');
      if (alert) { alert.className = 'config-alert'; alert.style.display = 'flex'; document.getElementById('config-alert-text').innerHTML = 'Click <a href="#" id="alert-test-link" style="color:#92400e">Test Connection</a> to verify your endpoint works.'; document.getElementById('alert-test-link')?.addEventListener('click', (e) => { e.preventDefault(); testConnection(); }); }
      if (warning) { warning.style.display = 'block'; warning.innerHTML = '<strong>🔧 Test your AI Engine</strong> — click <a href="#" id="test-now-link" style="color:#92400e;font-weight:600">Test Connection</a> to verify your endpoint works.'; document.getElementById('test-now-link')?.addEventListener('click', (e) => { e.preventDefault(); testConnection(); }); }
    } else {
      badge.className = 'config-badge untested';
      badge.textContent = '⚠️ Not configured';
      const alert = document.getElementById('config-alert');
      if (alert) { alert.className = 'config-alert'; alert.style.display = 'flex'; document.getElementById('config-alert-text').innerHTML = 'Enter an API Base URL, Key, and Model in the <strong>AI Engine</strong> section below.'; }
      if (warning) { warning.style.display = 'block'; warning.innerHTML = '<strong>🔧 Configure your AI Engine</strong> — enter an API Base URL, Key, and Model above.'; }
    }
  });
}

// Update config badge when fields change
document.getElementById('llm_base_url').addEventListener('change', () => {
  chrome.storage.sync.remove('config_tested');
  updateConfigStatus();
});
document.getElementById('llm_api_key').addEventListener('change', () => {
  chrome.storage.sync.remove('config_tested');
  updateConfigStatus();
});
document.getElementById('llm_model').addEventListener('change', () => {
  chrome.storage.sync.remove('config_tested');
  updateConfigStatus();
});

// --- Resume Data Editor ---
function getResumeData() {
  try {
    var raw = document.getElementById('rd-json-editor').value;
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return { rawSections: {}, extractedFields: {} };
}

function updateFromEditors() {
  var data = getResumeData();
  if (!data.rawSections) data.rawSections = {};
  if (!data.extractedFields) data.extractedFields = {};
  
  // Skills (from profile section)
  var skillsVal = document.getElementById('rd_skills').value.trim();
  data.rawSections.skills = skillsVal ? skillsVal.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; }) : [];
  
  // Languages (from profile section)
  var langsVal = document.getElementById('rd_languages').value.trim();
  data.rawSections.languages = langsVal ? langsVal.split(',').map(function(l) { return l.trim(); }).filter(function(l) { return l; }) : [];
  
  document.getElementById('rd-json-editor').value = JSON.stringify(data, null, 2);
  saveResumeData(data);
  renderResumeDataDisplay(data);
}

function saveResumeData(data) {
  // Merge with existing manual data to preserve user-added content
  chrome.storage.sync.get('resume_full_data', function(result) {
    try {
      if (result.resume_full_data) {
        var existing = JSON.parse(result.resume_full_data);
        // Keep existing rawSections that aren't in the new data or are empty
        if (existing.rawSections && data.rawSections) {
          for (var key in existing.rawSections) {
            if (!data.rawSections[key] || (Array.isArray(data.rawSections[key]) && data.rawSections[key].length === 0)) {
              // Keep existing data if new data is empty/missing
              data.rawSections[key] = existing.rawSections[key];
            }
          }
        }
        // Keep extractedFields that aren't in new data
        if (existing.extractedFields && data.extractedFields) {
          for (var key in existing.extractedFields) {
            if (!data.extractedFields[key]) {
              data.extractedFields[key] = existing.extractedFields[key];
            }
          }
        }
      }
    } catch(e) {}
    try { chrome.storage.sync.set({ resume_full_data: JSON.stringify(data) }); } catch(e) {}
  });
}

function saveResumeDataDebounced() {
  clearTimeout(window._rdSaveTimer);
  window._rdSaveTimer = setTimeout(function() {
    var data = getResumeData();
    renderResumeDataDisplay(data);
    saveResumeData(data);
  }, 500);
}

// Show/hide experience form
document.getElementById('rd-exp-show-form').onclick = function() {
  document.getElementById('rd-exp-form').style.display = 'block';
  this.style.display = 'none';
  document.getElementById('rd-exp-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
};
document.getElementById('rd-exp-cancel').onclick = function() {
  document.getElementById('rd-exp-form').style.display = 'none';
  document.getElementById('rd-exp-show-form').style.display = 'block';
};

document.getElementById('rd-exp-save').onclick = function() {
  var data = getResumeData();
  if (!data.rawSections) data.rawSections = {};
  if (!data.rawSections.experience) data.rawSections.experience = [];
  var title = document.getElementById('rd-exp-title').value.trim();
  var company = document.getElementById('rd-exp-company').value.trim();
  var startM = document.getElementById('rd-exp-start').value.trim();
  var startY = document.getElementById('rd-exp-start-y').value.trim();
  var endM = document.getElementById('rd-exp-end').value.trim();
  var endY = document.getElementById('rd-exp-end-y').value.trim();
  var start = startM && startY ? startM + '/' + startY : (startM || startY);
  var end = endM && endY ? endM + '/' + endY : (endM || endY);
  var desc = document.getElementById('rd-exp-desc').value.trim();
  if (!title && !company) return;
    var editIdx = document.getElementById('rd-exp-form').dataset.editIndex;
  if (editIdx !== undefined && data.rawSections.experience[editIdx]) {
    data.rawSections.experience[editIdx] = { title: title, company: company, start_date: start, end_date: end, description: desc };
    delete document.getElementById('rd-exp-form').dataset.editIndex;
  } else {
    data.rawSections.experience.push({ title: title, company: company, start_date: start, end_date: end, description: desc });
  }
  document.getElementById('rd-exp-title').value = '';
  document.getElementById('rd-exp-company').value = '';
  document.getElementById('rd-exp-start').value = '';
  document.getElementById('rd-exp-start-y').value = '';
  document.getElementById('rd-exp-end').value = '';
  document.getElementById('rd-exp-end-y').value = '';
  document.getElementById('rd-exp-desc').value = '';
  document.getElementById('rd-json-editor').value = JSON.stringify(data, null, 2);
  saveResumeData(data);
  renderEditableLists(data);
  renderResumeDataDisplay(data);
  document.getElementById('rd-exp-form').style.display = 'none';
  document.getElementById('rd-exp-show-form').style.display = 'block';
};

// Show/hide education form
document.getElementById('rd-edu-show-form').onclick = function() {
  document.getElementById('rd-edu-form').style.display = 'block';
  this.style.display = 'none';
  document.getElementById('rd-edu-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
};
document.getElementById('rd-edu-cancel').onclick = function() {
  document.getElementById('rd-edu-form').style.display = 'none';
  document.getElementById('rd-edu-show-form').style.display = 'block';
};

// --- Projects ---
document.getElementById('rd-proj-show-form').onclick = function() {
  document.getElementById('rd-proj-form').style.display = 'block'; this.style.display = 'none';
  document.getElementById('rd-proj-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
};
document.getElementById('rd-proj-cancel').onclick = function() {
  document.getElementById('rd-proj-form').style.display = 'none'; document.getElementById('rd-proj-show-form').style.display = 'block';
};
document.getElementById('rd-proj-save').onclick = function() {
  var data = getResumeData();
  if (!data.rawSections) data.rawSections = {};
  if (!data.rawSections.projects) data.rawSections.projects = [];
  var name = document.getElementById('rd-proj-name').value.trim();
  var desc = document.getElementById('rd-proj-desc').value.trim();
  if (!name) return;
  var editIdx = document.getElementById('rd-proj-form').dataset.editIndex;
  if (editIdx !== undefined && data.rawSections.projects[editIdx]) {
    data.rawSections.projects[editIdx] = { name: name, description: desc };
    delete document.getElementById('rd-proj-form').dataset.editIndex;
  } else {
    data.rawSections.projects.push({ name: name, description: desc });
  }
  document.getElementById('rd-proj-name').value = ''; document.getElementById('rd-proj-desc').value = '';
  document.getElementById('rd-json-editor').value = JSON.stringify(data, null, 2);
  saveResumeData(data); renderEditableLists(data); renderResumeDataDisplay(data);
  document.getElementById('rd-proj-save').textContent = 'Save Project';
  document.getElementById('rd-proj-form').style.display = 'none'; document.getElementById('rd-proj-show-form').style.display = 'block';
};

// --- Publications ---
document.getElementById('rd-pub-show-form').onclick = function() {
  document.getElementById('rd-pub-form').style.display = 'block'; this.style.display = 'none';
  document.getElementById('rd-pub-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
};
document.getElementById('rd-pub-cancel').onclick = function() {
  document.getElementById('rd-pub-form').style.display = 'none'; document.getElementById('rd-pub-show-form').style.display = 'block';
};
document.getElementById('rd-pub-save').onclick = function() {
  var data = getResumeData();
  if (!data.rawSections) data.rawSections = {};
  if (!data.rawSections.publications) data.rawSections.publications = [];
  var title = document.getElementById('rd-pub-title').value.trim();
  var url = document.getElementById('rd-pub-url').value.trim();
  if (!title) return;
  var editIdx = document.getElementById('rd-pub-form').dataset.editIndex;
  if (editIdx !== undefined && data.rawSections.publications[editIdx]) {
    data.rawSections.publications[editIdx] = { title: title, url: url };
    delete document.getElementById('rd-pub-form').dataset.editIndex;
  } else {
    data.rawSections.publications.push({ title: title, url: url });
  }
  document.getElementById('rd-pub-title').value = ''; document.getElementById('rd-pub-url').value = '';
  document.getElementById('rd-json-editor').value = JSON.stringify(data, null, 2);
  saveResumeData(data); renderEditableLists(data); renderResumeDataDisplay(data);
  document.getElementById('rd-pub-save').textContent = 'Save Publication';
  document.getElementById('rd-pub-form').style.display = 'none'; document.getElementById('rd-pub-show-form').style.display = 'block';
};

document.getElementById('rd-edu-save').onclick = function() {
  var data = getResumeData();
  if (!data.rawSections) data.rawSections = {};
  if (!data.rawSections.education) data.rawSections.education = [];
  var degree = document.getElementById('rd-edu-degree').value.trim();
  var field = document.getElementById('rd-edu-field').value.trim();
  var school = document.getElementById('rd-edu-school').value.trim();
  var startM = document.getElementById('rd-edu-start').value.trim();
  var startY = document.getElementById('rd-edu-start-y').value.trim();
  var endM = document.getElementById('rd-edu-end').value.trim();
  var endY = document.getElementById('rd-edu-end-y').value.trim();
  var start = startM && startY ? startM + '/' + startY : (startM || startY);
  var end = endM && endY ? endM + '/' + endY : (endM || endY);
  if (!degree && !school) return;
    var editIdx = document.getElementById('rd-edu-form').dataset.editIndex;
  if (editIdx !== undefined && data.rawSections.education[editIdx]) {
    data.rawSections.education[editIdx] = { degree: degree, field: field, school: school, start_date: start, end_date: end };
    delete document.getElementById('rd-edu-form').dataset.editIndex;
  } else {
    data.rawSections.education.push({ degree: degree, field: field, school: school, start_date: start, end_date: end });
  }
  document.getElementById('rd-edu-degree').value = '';
  document.getElementById('rd-edu-field').value = '';
  document.getElementById('rd-edu-school').value = '';
  document.getElementById('rd-edu-start').value = '';
  document.getElementById('rd-edu-start-y').value = '';
  document.getElementById('rd-edu-end').value = '';
  document.getElementById('rd-edu-end-y').value = '';
  document.getElementById('rd-json-editor').value = JSON.stringify(data, null, 2);
  saveResumeData(data);
  renderEditableLists(data);
  renderResumeDataDisplay(data);
  document.getElementById('rd-edu-form').style.display = 'none';
  document.getElementById('rd-edu-show-form').style.display = 'block';
};

// Delete from a list (delegated)
document.addEventListener('click', function(e) {
  // Edit card
  if (e.target.classList.contains('rd-card-edit')) {
    var list = e.target.dataset.list;
    var idx = parseInt(e.target.dataset.index);
    var data = getResumeData();
    var items = data.rawSections && data.rawSections[list];
    if (!items || !items[idx]) return;
    var item = items[idx];
    if (list === 'experience') {
      document.getElementById('rd-exp-title').value = item.title || '';
      document.getElementById('rd-exp-company').value = item.company || '';
      var parts = (item.start_date || '').split('/');
      document.getElementById('rd-exp-start').value = parts[0] || '';
      document.getElementById('rd-exp-start-y').value = parts[1] || '';
      parts = (item.end_date || '').split('/');
      document.getElementById('rd-exp-end').value = parts[0] || '';
      document.getElementById('rd-exp-end-y').value = parts[1] || '';
      document.getElementById('rd-exp-desc').value = item.description || '';
      document.getElementById('rd-exp-form').style.display = 'block';
      document.getElementById('rd-exp-show-form').style.display = 'none';
      document.getElementById('rd-exp-form').dataset.editIndex = idx;
      document.getElementById('rd-exp-save').textContent = 'Update';
      document.getElementById('rd-exp-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (list === 'projects') {
      document.getElementById('rd-proj-name').value = item.name || '';
      document.getElementById('rd-proj-desc').value = item.description || '';
      document.getElementById('rd-proj-form').style.display = 'block';
      document.getElementById('rd-proj-show-form').style.display = 'none';
      document.getElementById('rd-proj-form').dataset.editIndex = idx;
      document.getElementById('rd-proj-save').textContent = 'Update';
      document.getElementById('rd-proj-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    } else if (list === 'publications') {
      document.getElementById('rd-pub-title').value = item.title || (typeof item === 'string' ? item : '');
      document.getElementById('rd-pub-url').value = item.url || '';
      document.getElementById('rd-pub-form').style.display = 'block';
      document.getElementById('rd-pub-show-form').style.display = 'none';
      document.getElementById('rd-pub-form').dataset.editIndex = idx;
      document.getElementById('rd-pub-save').textContent = 'Update';
      document.getElementById('rd-pub-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    } else if (list === 'education') {
      document.getElementById('rd-edu-degree').value = item.degree || '';
      document.getElementById('rd-edu-field').value = item.field || '';
      document.getElementById('rd-edu-school').value = item.school || '';
      var parts = (item.start_date || '').split('/');
      document.getElementById('rd-edu-start').value = parts[0] || '';
      document.getElementById('rd-edu-start-y').value = parts[1] || '';
      parts = (item.end_date || '').split('/');
      document.getElementById('rd-edu-end').value = parts[0] || '';
      document.getElementById('rd-edu-end-y').value = parts[1] || '';
      document.getElementById('rd-edu-form').style.display = 'block';
      document.getElementById('rd-edu-show-form').style.display = 'none';
      document.getElementById('rd-edu-form').dataset.editIndex = idx;
      document.getElementById('rd-edu-save').textContent = 'Update';
      document.getElementById('rd-edu-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return;
  }
  
  if (e.target.classList.contains('rd-card-del') || e.target.classList.contains('rd-list-item-del') || e.target.classList.contains('rd-tag-del')) {
    var section = e.target.dataset.section;
    if (section !== undefined) {
      deleteTag(section, parseInt(e.target.dataset.index));
      return;
    }
    var key = e.target.dataset.list;
    var idx = parseInt(e.target.dataset.index);
    var data = getResumeData();
    if (data.rawSections && data.rawSections[key]) {
      data.rawSections[key].splice(idx, 1);
      document.getElementById('rd-json-editor').value = JSON.stringify(data, null, 2);
      saveResumeData(data);
      renderEditableLists(data);
      renderResumeDataDisplay(data);
    }
  }
});

// Toggle JSON editor
document.getElementById('toggle-json-editor').onclick = function() {
  var area = document.getElementById('json-editor-area');
  area.style.display = area.style.display === 'none' ? 'block' : 'none';
  this.textContent = area.style.display === 'none' ? 'Edit Raw JSON' : 'Hide Raw JSON';
};

// Render tag-based lists for skills and languages
function renderTagLists(data) {
  var sections = data.rawSections || {};
  
  var skillsContainer = document.getElementById('rd-skills-tags');
  if (skillsContainer) {
    skillsContainer.innerHTML = (sections.skills || []).map(function(s, i) {
      return '<span class="rd-tag-with-del">' + escHtml(s) + '<button class="rd-tag-del" data-section="skills" data-index="' + i + '">✕</button></span>';
    }).join('');
  }
  
  var langsContainer = document.getElementById('rd-languages-tags');
  if (langsContainer) {
    langsContainer.innerHTML = (sections.languages || []).map(function(l, i) {
      var display = typeof l === 'object' ? (l.name || '') + (l.level ? ' — ' + l.level : '') : l;
      return '<span class="rd-tag-with-del">' + escHtml(display) + '<button class="rd-tag-del" data-section="languages" data-index="' + i + '">✕</button></span>';
    }).join('');
  }
}

// Populate editable lists from data
function renderEditableLists(data) {
  var sections = data.rawSections || {};
  
  // Experience cards
  var expList = document.getElementById('rd-experience-list');
  if (expList) {
    expList.innerHTML = (sections.experience || []).map(function(item, i) {
      var html = '<div class="rd-card">';
      html += '<div style="display:flex;justify-content:space-between;align-items:flex-start">';  // flex wrapper
      html += '<div style="flex:1">';  // content left
      if (item.title) html += '<div class="rd-card-title">' + escHtml(item.title) + '</div>';
      if (item.company) html += '<div class="rd-card-sub">' + escHtml(item.company) + '</div>';
      if (item.start_date || item.end_date) {
            var sd = item.start_date || '';
            var ed = item.end_date || '';
            var months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            if (sd.length === 7 && sd.indexOf('/') === 2) { var p = sd.split('/'); sd = months[parseInt(p[0])] + ' ' + p[1]; }
            if (ed.length === 7 && ed.indexOf('/') === 2) { var p = ed.split('/'); ed = months[parseInt(p[0])] + ' ' + p[1]; }
            html += '<div class="rd-card-sub">' + escHtml(sd) + ' - ' + escHtml(ed) + '</div>';
          }
      if (item.description) html += '<div class="rd-card-desc">' + escHtml(item.description) + '</div>';
      html += '</div>';  // end content left
      html += '<div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px">';  // buttons right
      html += '<button class="rd-card-edit" data-list="experience" data-index="' + i + '">✏️</button>';
      html += '<button class="rd-card-del" data-list="experience" data-index="' + i + '">✕</button>';
      html += '</div></div>';  // end buttons + end flex
      html += '</div>';
      return html;
    }).join('');
  }
  
  // Projects cards
  var projList = document.getElementById('rd-projects-list');
  if (projList) {
    projList.innerHTML = (sections.projects || []).map(function(item, i) {
      var html = '<div class="rd-card"><div style="display:flex;justify-content:space-between;align-items:flex-start"><div style="flex:1">';
      if (item.name) html += '<div class="rd-card-title">' + escHtml(item.name) + '</div>';
      if (item.description) html += '<div class="rd-card-desc">' + escHtml(item.description) + '</div>';
      html += '</div><div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px">';
      html += '<button class="rd-card-edit" data-list="projects" data-index="' + i + '" style="background:none;border:1px solid #e5e7eb;border-radius:6px;color:#6b7280;cursor:pointer;font-size:12px;padding:3px 6px">Edit</button>';
      html += '<button class="rd-card-del" data-list="projects" data-index="' + i + '" style="background:none;border:1px solid #e5e7eb;border-radius:6px;color:#9ca3af;cursor:pointer;font-size:13px;padding:3px 8px">X</button>';
      html += '</div></div></div>';
      return html;
    }).join('');
  }
  
  // Publications cards
  var pubList = document.getElementById('rd-publications-list');
  if (pubList) {
    pubList.innerHTML = (sections.publications || []).map(function(item, i) {
      var html = '<div class="rd-card"><div style="display:flex;justify-content:space-between;align-items:flex-start"><div style="flex:1">';
      var title = typeof item === 'string' ? item : (item.title || '');
      var url = typeof item === 'object' ? (item.url || '') : '';
      if (title) html += '<div class="rd-card-title">' + escHtml(title) + '</div>';
      if (url) html += '<div class="rd-card-sub">' + escHtml(url) + '</div>';
      html += '</div><div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px">';
      html += '<button class="rd-card-edit" data-list="publications" data-index="' + i + '" style="background:none;border:1px solid #e5e7eb;border-radius:6px;color:#6b7280;cursor:pointer;font-size:12px;padding:3px 6px">Edit</button>';
      html += '<button class="rd-card-del" data-list="publications" data-index="' + i + '" style="background:none;border:1px solid #e5e7eb;border-radius:6px;color:#9ca3af;cursor:pointer;font-size:13px;padding:3px 8px">X</button>';
      html += '</div></div></div>';
      return html;
    }).join('');
  }
  
  // Education cards
  var eduList = document.getElementById('rd-education-list');
  if (eduList) {
    eduList.innerHTML = (sections.education || []).map(function(item, i) {
      var html = '<div class="rd-card">';
      html += '<div style="display:flex;justify-content:space-between;align-items:flex-start">';  // flex wrapper
      html += '<div style="flex:1">';  // content left
      if (item.degree) html += '<div class="rd-card-title">' + escHtml(item.degree) + '</div>';
      if (item.field) html += '<div class="rd-card-sub">' + escHtml(item.field) + '</div>';
      if (item.school) html += '<div class="rd-card-sub">' + escHtml(item.school) + '</div>';
      if (item.start_date || item.end_date) {
            var sd = item.start_date || '';
            var ed = item.end_date || '';
            var months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            if (sd.length === 7 && sd.indexOf('/') === 2) { var p = sd.split('/'); sd = months[parseInt(p[0])] + ' ' + p[1]; }
            if (ed.length === 7 && ed.indexOf('/') === 2) { var p = ed.split('/'); ed = months[parseInt(p[0])] + ' ' + p[1]; }
            html += '<div class="rd-card-sub">' + escHtml(sd) + ' - ' + escHtml(ed) + '</div>';
          }
      html += '</div>';  // end content left
      html += '<div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px">';  // buttons right
      html += '<button class="rd-card-edit" data-list="education" data-index="' + i + '">✏️</button>';
      html += '<button class="rd-card-del" data-list="education" data-index="' + i + '">✕</button>';
      html += '</div></div>';  // end buttons + end flex
      html += '</div>';
      return html;
    }).join('');
  }
  
  // Skills input (profile section)
  // Skills input
  var skillsInput = document.getElementById('rd_skills');
  if (skillsInput && sections.skills) skillsInput.value = sections.skills.join(', ');
  
  // Languages input
  var langsInput = document.getElementById('rd_languages');
  if (langsInput && sections.languages) langsInput.value = sections.languages.join(', ');
}

  // Add skill tag
  document.getElementById('rd-skill-add').addEventListener('click', function() { addTag('skills', 'rd-skill-input', 'rd-skills-tags'); });
  document.getElementById('rd-skill-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); addTag('skills', 'rd-skill-input', 'rd-skills-tags'); } });
  
  // Add language tag
  document.getElementById('rd-lang-add').addEventListener('click', function() { addLanguageTag(); });
  document.getElementById('rd-lang-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); addLanguageTag(); } });
  document.getElementById('rd-lang-level').addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); addLanguageTag(); } });
  
  // Tag helpers
  function addTag(section, inputId, containerId) {
    var input = document.getElementById(inputId);
    var val = input.value.trim();
    if (!val) return;
    var data = getResumeData();
    if (!data.rawSections) data.rawSections = {};
    if (!data.rawSections[section]) data.rawSections[section] = [];
    data.rawSections[section].push(val);
    input.value = '';
    document.getElementById('rd-json-editor').value = JSON.stringify(data, null, 2);
    saveResumeData(data);
    var se = document.getElementById('rd_summary'); if (se && data.extractedFields && data.extractedFields.summary) se.value = data.extractedFields.summary;
  renderTagLists(data);
    renderResumeDataDisplay(data);
    input.focus();
  }
  
  function addLanguageTag() {
    var input = document.getElementById('rd-lang-input');
    var level = document.getElementById('rd-lang-level');
    var val = input.value.trim();
    if (!val) return;
    var data = getResumeData();
    if (!data.rawSections) data.rawSections = {};
    if (!data.rawSections.languages) data.rawSections.languages = [];
    data.rawSections.languages.push(level.value ? { name: val, level: level.value } : val);
    input.value = ''; level.value = '';
    document.getElementById('rd-json-editor').value = JSON.stringify(data, null, 2);
    saveResumeData(data);
    var se = document.getElementById('rd_summary'); if (se && data.extractedFields && data.extractedFields.summary) se.value = data.extractedFields.summary;
  renderTagLists(data);
    renderResumeDataDisplay(data);
    input.focus();
  }
  
  function deleteTag(section, index) {
    var data = getResumeData();
    if (data.rawSections && data.rawSections[section]) {
      data.rawSections[section].splice(index, 1);
      document.getElementById('rd-json-editor').value = JSON.stringify(data, null, 2);
      saveResumeData(data);
      var se = document.getElementById('rd_summary'); if (se && data.extractedFields && data.extractedFields.summary) se.value = data.extractedFields.summary;
  renderTagLists(data);
      renderResumeDataDisplay(data);
    }
  }
  
  // JSON editor auto-save
  document.getElementById('rd_summary').addEventListener('input', function() { updateFromEditors(); saveResumeDataDebounced(); });
  document.getElementById('rd-json-editor').addEventListener('input', function() {
    saveResumeDataDebounced();
  });
// --- Resume Data Loader (page-load entry) ---
function renderResumeData() {
  chrome.storage.sync.get('resume_full_data', function(result) {
    if (result.resume_full_data) {
      try {
        var data = JSON.parse(result.resume_full_data);
        document.getElementById('rd-json-editor').value = JSON.stringify(data, null, 2);
        var se = document.getElementById('rd_summary'); if (se && data.extractedFields && data.extractedFields.summary) se.value = data.extractedFields.summary;
  renderTagLists(data);
        renderEditableLists(data);
        renderResumeDataDisplay(data);
      } catch(e) {}
    }
  });
}

function renderResumeDataDisplay(data) {
  var el = document.getElementById('resume-data-content');
  var badge = document.getElementById('resume-data-badge');
  if (!el) return;
  chrome.storage.sync.get('resume_full_data', function(result) {
    if (!result.resume_full_data) {
      el.innerHTML = '<p class="empty-state">No resume data yet. Upload a PDF and extract your profile.</p>';
      if (badge) { badge.textContent = 'No data'; badge.className = 'config-badge untested'; }
      return;
    }
    try {
      var data = JSON.parse(result.resume_full_data);
      var sections = data.rawSections || {};
      var extracted = data.extractedFields || {};
      var html = '';

      // Summary displayed in Profile section above

      // Skills displayed in editor above

      // Experience displayed in editor above

      // Education displayed in editor above

      // Languages displayed in editor above


      // Projects
      if (sections.projects && sections.projects.length > 0) {
        html += '<div class="rd-section"><div class="rd-section-title">Projects (' + sections.projects.length + ')</div>';
        sections.projects.forEach(function(p) {
          html += '<div class="rd-item">';
          html += '<div class="rd-item-title">' + escHtml(p.name || '') + '</div>';
          if (p.description) html += '<div class="rd-item-desc">' + escHtml(p.description) + '</div>';
          html += '</div>';
        });
        html += '</div>';
      }

      // Publications
      if (sections.publications && sections.publications.length > 0) {
        html += '<div class="rd-section"><div class="rd-section-title">Publications (' + sections.publications.length + ')</div>';
        sections.publications.forEach(function(p) {
          html += '<div class="rd-item">' + escHtml(typeof p === 'string' ? p : (p.title || p.name || JSON.stringify(p))) + '</div>';
        });
        html += '</div>';
      }

      if (!html) html = '<p class="empty-state">Data extracted but no structured sections found. Re-extract from PDF.</p>';
      el.innerHTML = html;
      if (badge) { badge.textContent = data.rawSections ? Object.keys(data.rawSections).length + ' sections' : '1 section'; badge.className = 'config-badge connected'; }
    } catch(e) {
      el.innerHTML = '<p class="empty-state">Error parsing resume data: ' + e.message + '</p>';
    }
  });
}

// --- Token Usage ---
async function renderTokenUsage() {
  const el = document.getElementById('token-usage-content');
  try {
    const summary = await TokenTracker.getSummary();
    if (!summary) {
      el.innerHTML = '<p class="empty-state">No usage data yet. Extract a profile or test a connection to see metrics.</p>';
      return;
    }

    const t = summary.total;
    let html = `
      <div class="token-summary">
        <div class="token-stat">
          <span class="token-stat-num">${formatNum(t.calls)}</span>
          <span class="token-stat-label">API Calls</span>
        </div>
        <div class="token-stat">
          <span class="token-stat-num">${TokenTracker.formatTokens(t.totalTokens)}</span>
          <span class="token-stat-label">Total Tokens</span>
        </div>
        <div class="token-stat">
          <span class="token-stat-num">${TokenTracker.formatTokens(t.promptTokens)}</span>
          <span class="token-stat-label">Prompt</span>
        </div>
        <div class="token-stat">
          <span class="token-stat-num">${TokenTracker.formatTokens(t.completionTokens)}</span>
          <span class="token-stat-label">Completion</span>
        </div>
      </div>
      <div class="token-week">Last 7 days: ${TokenTracker.formatTokens(summary.weekTotal)} tokens</div>
      <div style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Per Model</div>`;

    for (const [model, info] of Object.entries(summary.byModel)) {
      html += `<div class="token-model">
        <span class="token-model-name">${escHtml(model)}</span>
        <span class="token-model-tokens">${info.calls} call(s) · ${TokenTracker.formatTokens(info.totalTokens)} tokens</span>
      </div>`;
    }

    el.innerHTML = html;
  } catch (err) {
    el.innerHTML = `<p class="empty-state">Error loading usage: ${err.message}</p>`;
  }
}

function formatNum(n) { return n.toLocaleString(); }

// Reset tokens
document.getElementById('reset-tokens-btn').onclick = async () => {
  if (confirm('Reset all token usage data?')) {
    await TokenTracker.reset();
    renderTokenUsage();
  }
};

// Delete saved answers
document.addEventListener('click', async (e) => {
  if (e.target.classList.contains('qa-delete')) {
    const index = parseInt(e.target.dataset.index);
    const result = await chrome.storage.sync.get('saved_answers');
    const answers = result.saved_answers || [];
    answers.splice(index, 1);
    await chrome.storage.sync.set({ saved_answers: answers });
    renderSavedAnswers(answers);
  }
});

// --- Fetch models on focus ---
// Ensure URL has protocol
function ensureUrl(url) {
  if (!url) return url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return 'https://' + url;
  }
  return url;
}


let modelsFetched = false;

document.getElementById('llm_model').addEventListener('focus', async () => {
  if (modelsFetched) return;
  
  const baseUrl = (document.getElementById('llm_base_url').value || '').trim().replace(/\/+$/, '');
  const apiKey = document.getElementById('llm_api_key').value || '';
  
  if (!baseUrl) return;

  modelsFetched = true; // Only try once per session
  const hint = document.getElementById('model-count');
  hint.textContent = 'Loading models...';
  hint.className = 'field-hint loading';

  try {
    const resp = await fetch(`${baseUrl}/models`, {
      headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {},
    });
    
    if (!resp.ok) {
      hint.textContent = `Could not load models — ${baseUrl}/models returned ${resp.status}`;
      hint.className = 'field-hint error';
      modelsFetched = false; // Allow retry on next focus
      return;
    }

    const data = await resp.json();
    const models = data.data || [];
    
    if (models.length === 0) {
      hint.textContent = 'No models returned — type a model name manually';
      hint.className = 'field-hint';
      return;
    }

    const dropdown = document.getElementById('model-dropdown');
    const modelList = models
      .filter(m => m.id && m.id.length < 100)
      .slice(0, 30);

    dropdown.innerHTML = modelList.map(m => 
      `<div class="md-item" data-model="${m.id}">${m.id}</div>`
    ).join('') + 
      `<div class="md-divider"></div>
       <div class="md-custom">Type a custom model name above</div>`;

    // Click handler for dropdown items
    dropdown.querySelectorAll('.md-item').forEach(el => {
      el.addEventListener('click', () => {
        document.getElementById('llm_model').value = el.dataset.model;
        dropdown.classList.remove('open');
        testConnection();
      });
    });

    // Show dropdown
    dropdown.classList.add('open');

    hint.textContent = `${modelList.length} model(s) loaded — click to select or type custom`;
    hint.className = 'field-hint success';
  } catch (err) {
    hint.textContent = `Could not reach endpoint: ${err.message}`;
    hint.className = 'field-hint error';
    modelsFetched = false;
  }
});

// Check if model needs attention (URL+key filled but model empty)
function checkModelNeeded() {
  const baseUrl = document.getElementById('llm_base_url').value.trim();
  const apiKey = document.getElementById('llm_api_key').value.trim();
  const model = document.getElementById('llm_model').value.trim();
  const hint = document.getElementById('model-count');
  const modelInput = document.getElementById('llm_model');
  
  if (baseUrl && apiKey && !model && !hint.textContent.includes('model')) {
    hint.textContent = '👆 Click here to load models from your endpoint';
    hint.className = 'field-hint model-needed';
    modelInput.classList.add('needs-attention');
  } else if (model) {
    modelInput.classList.remove('needs-attention');
  }
}

// Reset fetch flag when URL or key changes
document.getElementById('llm_base_url').addEventListener('change', () => { modelsFetched = false; checkModelNeeded(); });
document.getElementById('llm_api_key').addEventListener('change', () => { modelsFetched = false; checkModelNeeded(); });
document.getElementById('llm_model').addEventListener('input', () => { checkModelNeeded(); });

// Press Enter in model field to test connection
document.getElementById('llm_model').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    testConnection();
  }
});

// Close model dropdown when clicking outside
document.addEventListener('click', (e) => {
  const wrap = document.querySelector('.model-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('model-dropdown').classList.remove('open');
  }
});

// Reopen dropdown on focus (if models already loaded)
document.getElementById('llm_model').addEventListener('focus', () => {
  const dropdown = document.getElementById('model-dropdown');
  if (dropdown.children.length > 0) {
    dropdown.classList.add('open');
  }
});
