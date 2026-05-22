// Background service worker

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get('llm_base_url', (result) => {
    if (!result.llm_base_url) {
      chrome.storage.sync.set({
        llm_base_url: 'http://localhost:19530/v1',
        llm_model: 'deepseek-v4-flash-2',
        llm_api_key: 'dummy',
      });
    }
  });
});

// Handle PDF extraction
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'extract_pdf') {
    sendResponse({ text: null, error: 'PDF text extraction requires pdf.js. Paste resume text manually in Settings.' });
    return true;
  }
});
