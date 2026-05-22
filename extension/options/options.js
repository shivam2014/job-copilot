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
  if (!document.getElementById('llm_model').value)
    document.getElementById('llm_model').value = 'deepseek-v4-flash-2';

  renderSavedAnswers(result.saved_answers || []);

  // --- PDF Upload ---
  const uploadArea = document.getElementById('upload-area');
  const fileInput = document.getElementById('resume_file');
  const uploadStatus = document.getElementById('upload-status');
  const uploadPrompt = document.getElementById('upload-prompt');

  uploadArea.onclick = () => fileInput.click();
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
      document.getElementById('resume_text').value = text;
      showUploadStatus(`✅ ${file.name} — ${text.length} chars extracted`, 'success');
      // Auto-trigger profile extraction
      document.getElementById('extract-btn').click();
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

  // --- Extract Profile (calls LLM directly from form fields) ---
  document.getElementById('extract-btn').onclick = async () => {
    const resumeText = document.getElementById('resume_text').value.trim();
    if (!resumeText) {
      setExtractStatus('Upload a PDF or paste resume text first', 'error');
      return;
    }

    // Read LLM config directly from the form fields (user visible, always current)
    const baseUrl = (document.getElementById('llm_base_url').value || 'http://localhost:19530/v1').trim().replace(/\/+$/, '');
    const apiKey = document.getElementById('llm_api_key').value || 'dummy';
    const model = document.getElementById('llm_model').value || 'deepseek-v4-flash-2';

    if (!baseUrl || baseUrl === '') {
      setExtractStatus('Enter your LLM API Base URL in Step 1 first', 'error');
      return;
    }

    const btn = document.getElementById('extract-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Extracting...';
    setExtractStatus('Calling AI to parse your resume...', 'loading');

    try {
      const prompt = `You are parsing a resume. Extract these fields as a JSON object (keys: name, email, phone, linkedin, github, website, address, work_authorization). Return ONLY the JSON. No other text.`;

      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: `Resume:\n\n${resumeText.slice(0, 4000)}` },
          ],
          temperature: 0.01,
          max_tokens: 500,
        }),
      });

      if (!resp.ok) {
        const err = await resp.text().catch(() => resp.statusText);
        throw new Error(`API ${resp.status}: ${err.slice(0, 200)}`);
      }

      const data = await resp.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error('Empty response from API');

      let raw = (msg.content || msg.reasoning_content || '').trim();
      if (!raw) throw new Error('Empty response from API');

      // Parse JSON
      const jsonMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) raw = jsonMatch[1];
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}') + 1;
      if (start === -1 || end <= start) throw new Error('Could not parse API response as JSON');
      const profile = JSON.parse(raw.slice(start, end));

      // Populate fields
      const fieldMap = {
        profile_name: 'name',
        profile_email: 'email',
        profile_phone: 'phone',
        profile_linkedin: 'linkedin',
        profile_github: 'github',
        profile_website: 'website',
        profile_address: 'address',
        profile_work_authorization: 'work_authorization',
      };

      let filled = 0;
      for (const [fieldId, key] of Object.entries(fieldMap)) {
        const el = document.getElementById(fieldId);
        if (profile[key] && profile[key].trim()) {
          el.value = profile[key].trim();
          filled++;
        }
      }

      setExtractStatus(`✅ Extracted ${filled} field(s). Review and edit below.`, 'success');
    } catch (err) {
      setExtractStatus(`❌ ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '🔍 Extract Profile from Resume';
    }
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

    const list = document.getElementById('model-list');
    list.innerHTML = models
      .filter(m => m.id && !m.id.includes('.')) // Filter out non-model entries
      .slice(0, 30) // Cap at 30
      .map(m => `<option value="${m.id}">`)
      .join('');

    hint.textContent = `${Math.min(models.length, 30)} model(s) loaded — click to select or type custom`;
    hint.className = 'field-hint success';
  } catch (err) {
    hint.textContent = `Could not reach endpoint: ${err.message}`;
    hint.className = 'field-hint error';
    modelsFetched = false;
  }
});

// Reset fetch flag when URL or key changes
document.getElementById('llm_base_url').addEventListener('change', () => { modelsFetched = false; });
document.getElementById('llm_api_key').addEventListener('change', () => { modelsFetched = false; });
