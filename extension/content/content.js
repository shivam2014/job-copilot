// Content script — injected into job pages

let detectedFields = null;
let jcPanel = null;

// Main init
async function init() {
  // Wait for page to settle (dynamic SPAs)
  setTimeout(() => {
    detectedFields = FormDetector.detect();
    const totalFields = detectedFields.personal.length + 
                        detectedFields.questions.length + 
                        detectedFields.selects.length;

    if (totalFields === 0) return; // No form detected

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

function injectFloatingButton() {
  if (document.getElementById('jc-float-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'jc-float-btn';
  btn.textContent = 'JC';

  const panel = createPanel();

  btn.onclick = () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) updatePanel();
  };

  document.body.appendChild(btn);

  // Close panel on outside click
  document.addEventListener('click', (e) => {
    if (!btn.contains(e.target) && !panel.contains(e.target)) {
      panel.classList.remove('open');
    }
  });
}

function createPanel() {
  if (document.getElementById('jc-panel')) 
    return document.getElementById('jc-panel');

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
      <div id="jc-status-msg"></div>
    </div>
  `;

  jcPanel.querySelector('#jc-panel-close').onclick = () => {
    jcPanel.classList.remove('open');
  };

  jcPanel.querySelector('#jc-fill-personal').onclick = () => fillPersonal();
  jcPanel.querySelector('#jc-fill-ai').onclick = () => fillAIQuestions();
  jcPanel.querySelector('#jc-fill-all').onclick = () => {
    fillPersonal();
    fillAIQuestions();
  };

  document.body.appendChild(jcPanel);
  return jcPanel;
}

function updatePanel() {
  const stats = document.getElementById('jc-stats');
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

async function fillPersonal() {
  const profile = await chrome.storage.sync.get([
    'profile_name', 'profile_email', 'profile_phone', 'profile_linkedin',
    'profile_github', 'profile_website', 'profile_address',
    'profile_work_authorization',
  ]);

  const fields = FormDetector.detect();
  let filled = 0;

  const fillMap = {
    name: profile.profile_name,
    email: profile.profile_email,
    phone: profile.profile_phone,
    linkedin: profile.profile_linkedin,
    github: profile.profile_github,
    website: profile.profile_website,
    address: profile.profile_address,
    work_authorization: profile.profile_work_authorization,
  };

  for (const field of [...fields.personal, ...fields.selects]) {
    const value = fillMap[field.name];
    if (value) {
      const ok = await FormDetector.fillField(field, value);
      if (ok) filled++;
    }
  }

  showStatus(`Filled ${filled} personal field(s)`, 'success');
}

async function fillAIQuestions() {
  const profile = await chrome.storage.sync.get([
    'llm_base_url', 'llm_api_key', 'llm_model',
    'resume_text', 'profile_name',
  ]);

  if (!profile.resume_text) {
    showStatus('No resume uploaded. Go to extension settings.', 'error');
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
      await saveAnswer(field.label || field.identifiers, answer);
      filled++;
    } catch (err) {
      console.error('JC: LLM error for field:', field.label, err);
    }
  }

  showStatus(`Filled ${filled}/${questions.length} question(s)`, filled > 0 ? 'success' : 'error');
}

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

function injectAIAssistButtons() {
  // Wait a bit for dynamic forms
  setTimeout(() => {
    const fields = FormDetector.detect();
    for (const field of fields.questions) {
      // Check if already wrapped
      if (field.el.parentElement?.classList.contains('jc-field-wrapper')) continue;
      FormDetector.injectAIButton(field.el, async (textareaEl) => {
        const profile = await chrome.storage.sync.get([
          'llm_base_url', 'llm_api_key', 'llm_model', 'resume_text',
        ]);
        if (!profile.resume_text) {
          showStatus('No resume uploaded. Go to extension settings.', 'error');
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

function showStatus(msg, type) {
  const el = document.getElementById('jc-status-msg');
  if (!el) return;
  el.className = `jc-status ${type}`;
  el.textContent = msg;
  setTimeout(() => { el.textContent = ''; el.className = 'jc-status'; }, 5000);
}

// --- Saved Answers Bank ---
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

// Start
init();
