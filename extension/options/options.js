// Options page — PDF upload → extract text → LLM extract profile → edit → save

document.addEventListener('DOMContentLoaded', async () => {
  const result = await chrome.storage.sync.get(null);
  
  // Load saved values
  const fields = [
    'profile_name', 'profile_email', 'profile_phone',
    'profile_linkedin', 'profile_github', 'profile_website',
    'profile_address', 'profile_work_authorization',
    'resume_text', 'llm_base_url', 'llm_api_key', 'llm_model',
  ];
  fields.forEach(f => {
    const el = document.getElementById(f);
    if (el && result[f] !== undefined) el.value = result[f];
  });

  // Set defaults
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

  uploadArea.ondragover = (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  };
  uploadArea.ondragleave = () => uploadArea.classList.remove('dragover');
  uploadArea.ondrop = (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handlePDF(e.dataTransfer.files[0]);
  };

  fileInput.onchange = (e) => {
    if (e.target.files[0]) handlePDF(e.target.files[0]);
  };

  async function handlePDF(file) {
    if (!file.name.endsWith('.pdf')) {
      showUploadStatus('Please upload a PDF file', 'error');
      return;
    }

    showUploadStatus(`Reading ${file.name}...`, 'loading');

    try {
      // Read file as ArrayBuffer → send to bg for text extraction
      const arrayBuffer = await file.arrayBuffer();
      const bytes = Array.from(new Uint8Array(arrayBuffer));

      const resp = await chrome.runtime.sendMessage({
        type: 'extract_pdf_text',
        data: bytes,
      });

      if (resp.error) throw new Error(resp.error);

      document.getElementById('resume_text').value = resp.text;
      showUploadStatus(`✅ ${file.name} — ${resp.text.length} chars extracted`, 'success');
      
      // Auto-trigger extraction
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

  // --- Extract Profile (sends resume text + LLM config to background) ---
  document.getElementById('extract-btn').onclick = async () => {
    const resumeText = document.getElementById('resume_text').value.trim();
    if (!resumeText) {
      setExtractStatus('Upload a PDF or paste resume text first', 'error');
      return;
    }

    const btn = document.getElementById('extract-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Extracting...';
    setExtractStatus('Calling AI to parse your resume...', 'loading');

    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'extract_profile_from_text',
        text: resumeText,
      });

      if (resp.error) throw new Error(resp.error);

      const profile = resp.profile;
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
      setExtractStatus(`❌ Error: ${err.message}`, 'error');
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

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function setExtractStatus(text, type) {
  const el = document.getElementById('extract-status');
  el.textContent = text;
  el.className = type || '';
}

function showMsg(text, type) {
  const el = document.getElementById('save-msg');
  el.textContent = text;
  el.className = 'save-msg ' + type;
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
