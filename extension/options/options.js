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
  async function runExtraction(resumeText, sourceLabel) {
    const baseUrl = (document.getElementById('llm_base_url').value || 'http://localhost:19530/v1').trim().replace(/\/+$/, '');
    const apiKey = document.getElementById('llm_api_key').value || 'dummy';
    const model = document.getElementById('llm_model').value.trim() || '';
    const statusEl = document.getElementById('extract-status');
    if (!baseUrl) { statusEl.textContent = 'Enter an API Base URL first'; statusEl.className = 'field-hint error'; return; }
    if (!model) { statusEl.textContent = 'Select a model first (click the Model field to load available models)'; statusEl.className = 'field-hint error'; return; }
    statusEl.textContent = 'Calling AI to parse your resume...';
    statusEl.className = 'field-hint loading';
    try {
      const prompt = 'Extract JSON from resume. Keys: name, email, phone, linkedin, github, website, address, work_authorization. Use empty string for missing values. No null. JSON only.';
      const resp = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ model: model, messages: [{ role: 'system', content: prompt }, { role: 'user', content: 'Resume:\n\n' + resumeText.slice(0, 4000) }], temperature: 0.01, max_tokens: 2000 }),
      });
      if (!resp.ok) throw new Error('API ' + resp.status + ': ' + (await resp.text().catch(() => resp.statusText)));
      const data = await resp.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error('Empty response from API');
      if (data.usage) { try { TokenTracker.record(model, data.usage); } catch(e) {} }
      let raw = (msg.content || msg.reasoning_content || '').trim();
      if (!raw) throw new Error('Empty response from API');
      const jm = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jm) raw = jm[1];
      const s = raw.indexOf('{'), e = raw.lastIndexOf('}') + 1;
      if (s === -1 || e <= s) throw new Error('Could not parse API response as JSON');
      const profile = JSON.parse(raw.slice(s, e));
      const fields = { profile_name: 'name', profile_email: 'email', profile_phone: 'phone', profile_linkedin: 'linkedin', profile_github: 'github', profile_website: 'website', profile_address: 'address', profile_work_authorization: 'work_authorization' };
      let filled = 0;
      for (const [id, key] of Object.entries(fields)) {
        const el = document.getElementById(id);
        if (profile[key] && profile[key].trim()) { el.value = profile[key].trim(); filled++; }
      }
      statusEl.textContent = '✅ Extracted ' + filled + ' field(s)' + (sourceLabel ? ' from ' + sourceLabel : '') + '. Review and edit below.';
      statusEl.className = 'field-hint success';
      // Disable extract button after PDF auto-extraction
      if (sourceLabel) {
        document.getElementById('extract-btn').disabled = true;
        document.getElementById('extract-btn').textContent = '✅ Already extracted from PDF';
      }
    } catch (err) {
      statusEl.textContent = '❌ ' + err.message;
      statusEl.className = 'field-hint error';
    }
  }

  // --- Extract Profile button ---
  document.getElementById('extract-btn').onclick = async () => {
    const text = document.getElementById('resume_text').value.trim();
    if (!text) { setExtractStatus('Upload a PDF or paste resume text first', 'error'); return; }
    const btn = document.getElementById('extract-btn');
    btn.disabled = true; btn.textContent = '⏳ Extracting...';
    await runExtraction(text, null);
    btn.disabled = false; btn.textContent = '🔍 Extract Profile';
  };
  // --- Save ---
  document.getElementById('save-btn').onclick = async () => {
    const data = {};
    fields.forEach(f => { data[f] = document.getElementById(f).value.trim(); });
    const existing = await chrome.storage.sync.get('saved_answers');
    if (existing.saved_answers) data.saved_answers = existing.saved_answers;

    try {
      await chrome.storage.sync.set(data);
      showMsg('✅ All settings saved!', 'success');
    } catch (err) {
      showMsg(`❌ Error: ${err.message}`, 'error');
    }
  };

  // Load token usage on page open
  setTimeout(renderTokenUsage, 500);
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
