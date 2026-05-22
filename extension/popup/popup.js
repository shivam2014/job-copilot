// Popup script

document.addEventListener('DOMContentLoaded', async () => {
  try {
  const statusText = document.getElementById('status-text');
  const statusCard = document.getElementById('status-card');
  const fieldsSection = document.getElementById('fields-section');
  const actionsSection = document.getElementById('actions-section');
  const msg = document.getElementById('msg');

  // Check if we're on a web page where the content script can run
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  
  if (!url.startsWith('http')) {
    // Not on a web page - show settings link
    document.getElementById('fields-section').style.display = 'none';
    document.getElementById('actions-section').style.display = 'none';
    document.getElementById('status-text').textContent = 'Open a job application page to use Copilot';
    document.getElementById('status-card').className = 'status-card idle';
    msg.innerHTML = 'Go to <a href="#" id="msg-settings-link">Settings</a> to configure your profile and AI engine.';
    document.getElementById('msg-settings-link').onclick = function(e) {
      e.preventDefault();
      try {
        chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') }, function(tab) {
          if (chrome.runtime.lastError) {
            document.getElementById('status-text').textContent = 'Error: ' + chrome.runtime.lastError.message;
          }
        });
      } catch(err) {
        document.getElementById('status-text').textContent = 'Error: ' + err.message;
      }
    };
    document.getElementById('open-settings').onclick = function(e) {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
    };
    return;
  }

  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'jc_ping' }).catch(() => null);
    if (!resp?.ok) {
      setStatus('Loading... try refreshing the page', 'loading');
      return;
    }

    const fields = await chrome.tabs.sendMessage(tab.id, { type: 'jc_get_fields' });
    if (!fields || (fields.personal.length + fields.questions.length + fields.selects.length + fields.files.length) === 0) {
      setStatus('No application form detected', 'idle');
      return;
    }

    const total = fields.personal.length + fields.questions.length + 
                  fields.selects.length + fields.files.length;
    document.getElementById('personal-count').textContent = fields.personal.length;
    document.getElementById('ai-count').textContent = fields.questions.length;
    document.getElementById('select-count').textContent = fields.selects.length;
    document.getElementById('file-count').textContent = fields.files.length;

    setStatus(`Found ${total} field(s) on this page`, 'success');
    fieldsSection.style.display = 'block';
    actionsSection.style.display = 'block';

    // Check setup status
    const profile = await chrome.storage.sync.get([
      'profile_name', 'llm_base_url', 'resume_text', 'resume_full_data',
    ]);
    if (!profile.resume_text && !profile.resume_full_data) {
      msg.innerHTML = '⚠️ <a href="#" id="msg-settings">Upload your resume in Settings</a> first → extract your profile → then use AI questions';
    } else if (!profile.profile_name) {
      msg.innerHTML = '⚠️ Click "Extract Profile" in <a href="#" id="msg-settings">Settings</a> or type your name manually';
    } else if (!profile.llm_base_url) {
      msg.innerHTML = '⚠️ Configure your <a href="#" id="msg-settings">AI Engine endpoint</a>';
    } else {
      msg.textContent = `✅ ${profile.profile_name} — profile + AI ready`;
    }

    // Make settings link work
    document.querySelectorAll('#msg-settings, #open-settings').forEach(el => {
      el?.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
      });
    });

    // Button handlers
    document.getElementById('fill-personal').onclick = async () => {
      setStatus('Filling personal fields...', 'loading');
      await chrome.tabs.sendMessage(tab.id, { type: 'jc_fill_personal' });
      setStatus('Personal fields filled!', 'success');
    };

    document.getElementById('fill-ai').onclick = async () => {
      setStatus('Generating AI answers...', 'loading');
      await chrome.tabs.sendMessage(tab.id, { type: 'jc_fill_ai' });
      setStatus('AI questions filled!', 'success');
    };

    document.getElementById('fill-all').onclick = async () => {
      setStatus('Filling all fields...', 'loading');
      await chrome.tabs.sendMessage(tab.id, { type: 'jc_fill_personal' });
      await chrome.tabs.sendMessage(tab.id, { type: 'jc_fill_ai' });
      setStatus('All fields filled!', 'success');
    };

  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
  }

  document.getElementById('open-settings').onclick = (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  };
  document.getElementById('reload-page').onclick = (e) => {
    e.preventDefault();
    chrome.tabs.reload(tab.id);
  };
  } catch (e) {
    console.error('JC Popup error:', e.message, e.stack);
    document.getElementById('status-text').textContent = 'Error: ' + e.message;
    document.getElementById('status-card').className = 'status-card error';
  }
});

function setStatus(text, type) {
  const el = document.getElementById('status-text');
  const card = document.getElementById('status-card');
  el.textContent = text;
  card.className = 'status-card ' + (type || 'idle');
}
