// Popup script

document.addEventListener('DOMContentLoaded', async () => {
  const statusText = document.getElementById('status-text');
  const statusCard = document.getElementById('status-card');
  const fieldsSection = document.getElementById('fields-section');
  const actionsSection = document.getElementById('actions-section');
  const msg = document.getElementById('msg');

  // Check if we're on a job page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith('http')) {
    setStatus('Open a job application page to use Copilot', 'idle');
    return;
  }

  try {
    // Check if content script is loaded
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'jc_ping' }).catch(() => null);
    if (!resp?.ok) {
      setStatus('Loading... try refreshing the page', 'loading');
      return;
    }

    // Get detected fields
    const fields = await chrome.tabs.sendMessage(tab.id, { type: 'jc_get_fields' });
    if (!fields) {
      setStatus('No application form detected', 'idle');
      return;
    }

    const total = fields.personal.length + fields.questions.length + 
                  fields.selects.length + fields.files.length;
    if (total === 0) {
      setStatus('No application form detected', 'idle');
      return;
    }

    // Show stats
    document.getElementById('personal-count').textContent = fields.personal.length;
    document.getElementById('ai-count').textContent = fields.questions.length;
    document.getElementById('select-count').textContent = fields.selects.length;
    document.getElementById('file-count').textContent = fields.files.length;

    setStatus(`Found ${total} field(s) on this page`, 'success');
    fieldsSection.style.display = 'block';
    actionsSection.style.display = 'block';

    // Check if profile is configured
    const profile = await chrome.storage.sync.get([
      'profile_name', 'llm_base_url', 'resume_text',
    ]);
    if (!profile.profile_name) {
      msg.textContent = '⚠️ Set up your profile in Settings first';
    } else if (!profile.llm_base_url) {
      msg.textContent = '⚠️ Configure your LLM endpoint in Settings';
    } else {
      msg.textContent = '✅ Profile and LLM configured';
    }

    // Button handlers
    document.getElementById('fill-personal').onclick = async () => {
      setStatus('Filling personal fields...', 'loading');
      const r = await chrome.tabs.sendMessage(tab.id, { type: 'jc_fill_personal' });
      if (r?.ok) setStatus('Personal fields filled!', 'success');
    };

    document.getElementById('fill-ai').onclick = async () => {
      setStatus('Generating AI answers...', 'loading');
      const r = await chrome.tabs.sendMessage(tab.id, { type: 'jc_fill_ai' });
      if (r?.ok) setStatus('AI questions filled!', 'success');
    };

    document.getElementById('fill-all').onclick = async () => {
      setStatus('Filling all fields...', 'loading');
      await chrome.tabs.sendMessage(tab.id, { type: 'jc_fill_personal' });
      const r = await chrome.tabs.sendMessage(tab.id, { type: 'jc_fill_ai' });
      if (r?.ok) setStatus('All fields filled!', 'success');
    };

  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
  }

  // Footer links
  document.getElementById('open-settings').onclick = (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  };

  document.getElementById('reload-page').onclick = (e) => {
    e.preventDefault();
    chrome.tabs.reload(tab.id);
  };
});

function setStatus(text, type) {
  const el = document.getElementById('status-text');
  const card = document.getElementById('status-card');
  el.textContent = text;
  card.className = 'status-card ' + (type || 'idle');
}
