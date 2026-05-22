// Options page — resume upload → LLM extract → edit profile → save

document.addEventListener('DOMContentLoaded', async () => {
  // Load saved settings into form
  const result = await chrome.storage.sync.get(null);
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

  // Set defaults if empty
  if (!document.getElementById('llm_base_url').value)
    document.getElementById('llm_base_url').value = 'http://localhost:19530/v1';
  if (!document.getElementById('llm_api_key').value)
    document.getElementById('llm_api_key').value = 'dummy';
  if (!document.getElementById('llm_model').value)
    document.getElementById('llm_model').value = 'deepseek-v4-flash-2';

  // Load saved Q&A bank
  renderSavedAnswers(result.saved_answers || []);

  // --- Extract Profile from Resume ---
  document.getElementById('extract-btn').onclick = async () => {
    const resumeText = document.getElementById('resume_text').value.trim();
    if (!resumeText) {
      setExtractStatus('Paste your resume text first', 'error');
      return;
    }

    const btn = document.getElementById('extract-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Extracting...';
    setExtractStatus('Reading your resume...', 'loading');

    try {
      const extracted = await extractProfileFromResume(resumeText);
      
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
        if (extracted[key] && extracted[key].trim()) {
          el.value = extracted[key].trim();
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
    fields.forEach(f => {
      data[f] = document.getElementById(f).value.trim();
    });

    // Preserve saved_answers if they exist
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

// --- LLM Extraction ---
async function extractProfileFromResume(resumeText) {
  const systemPrompt = `You are parsing a resume. Extract the following fields from the resume text. 
Return ONLY a JSON object with these exact keys (all lowercase):
- name: full name
- email: email address
- phone: phone number (include country code if present)
- linkedin: LinkedIn URL (if present, otherwise "")
- github: GitHub URL (if present, otherwise "")
- website: personal website or portfolio URL (if present, otherwise "")
- address: city, country (infer from location mentioned or contact section)
- work_authorization: work authorization or visa status (if mentioned, otherwise "")

If a field is not found in the resume, use "" (empty string).
Do NOT include any text outside the JSON object.`;

  const config = await new LLMClient.constructor().getConfig();
  // Override getConfig to use the current form values
  const baseUrl = (document.getElementById('llm_base_url').value || 'http://localhost:19530/v1').replace(/\/+$/, '');
  const apiKey = document.getElementById('llm_api_key').value || 'dummy';
  const model = document.getElementById('llm_model').value || 'deepseek-v4-flash-2';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Resume:\n\n${resumeText}` },
      ],
      temperature: 0.05,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content.trim();
  
  // Parse JSON from response (handle possible markdown fencing)
  let jsonStr = content;
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1];
  
  // Find first { to last }
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Could not parse LLM response as JSON');
  
  return JSON.parse(jsonStr.slice(start, end + 1));
}

// --- Saved Answers ---
async function renderSavedAnswers(answers) {
  const container = document.getElementById('saved-answers-list');
  if (!answers || answers.length === 0) {
    container.innerHTML = '<p class="empty-state">No saved answers yet. They\'ll appear after you use the AI button on application forms.</p>';
    return;
  }
  
  container.innerHTML = answers.map((qa, i) => `
    <div class="saved-qa">
      <div class="qa-question"><strong>Q:</strong> ${escapeHtml(qa.question)}</div>
      <div class="qa-answer"><strong>A:</strong> ${escapeHtml(qa.answer)}</div>
      <button class="qa-delete" data-index="${i}">✕</button>
    </div>
  `).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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

// --- Delete saved answers ---
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
