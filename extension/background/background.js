// Background service worker

const PDF_WORKER = chrome.runtime.getURL('lib/pdfjs/pdf.worker.min.mjs');
let pdfjsLib = null;

async function getPdfJs() {
  if (!pdfjsLib) {
    const url = chrome.runtime.getURL('lib/pdfjs/pdf.min.mjs');
    pdfjsLib = await import(url);
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  }
  return pdfjsLib;
}

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

// Handle PDF extraction + LLM profile extraction
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'extract_pdf_text') {
    (async () => {
      try {
        const pdfjs = await getPdfJs();
        const data = new Uint8Array(msg.data);
        const pdf = await pdfjs.getDocument({ data }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const tc = await page.getTextContent();
          fullText += tc.items.map(item => item.str).join(' ') + '\n\n';
        }
        sendResponse({ text: fullText.trim() });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  if (msg.type === 'extract_profile_from_text') {
    (async () => {
      try {
        const config = await new Promise(resolve => {
          chrome.storage.sync.get(['llm_base_url', 'llm_api_key', 'llm_model'], resolve);
        });
        const baseUrl = (config.llm_base_url || 'http://localhost:19530/v1').replace(/\/+$/, '');
        const apiKey = config.llm_api_key || 'dummy';
        const model = config.llm_model || 'deepseek-v4-flash-2';

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
              { role: 'user', content: `Resume:\n\n${msg.text.slice(0, 4000)}` },
            ],
            temperature: 0.01,
            max_tokens: 500,
          }),
        });

        if (!resp.ok) {
          const err = await resp.text();
          throw new Error(`API ${resp.status}: ${err}`);
        }

        const data = await resp.json();
        const raw = (data.choices[0].message.content || data.choices[0].message.reasoning_content || '').trim();
        
        // Parse JSON
        let json = raw;
        const m = json.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (m) json = m[1];
        const start = json.indexOf('{');
        const end = json.lastIndexOf('}') + 1;
        const profile = JSON.parse(json.slice(start, end));
        
        sendResponse({ profile });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }
  if (msg.type === 'jc_open_options') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }
});
