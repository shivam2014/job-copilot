// ═══════════════════════════════════════════════════════════════
// Background service worker — handles PDF + LLM tasks
// ═══════════════════════════════════════════════════════════════
//
// WHAT IT DOES:
//   1. PDF text extraction (extract_pdf_text) — reads uploaded resume PDFs
//   2. LLM profile extraction (extract_profile_from_text) — sends resume text
//      to LLM endpoint, parses JSON response into structured profile fields
//   3. Opens extension options page (jc_open_options)
//   4. LLM chat bridge (jc_llm_chat) — a content script cannot fetch the LLM
//      endpoint cross-origin (page origin → MV3/CORS "Failed to fetch"), so
//      every LLMClient.chat() call is proxied through this worker.
//
// WHAT WAS REMOVED:
//   jc_cdp_fill_combobox handler — used chrome.debugger to type into Oracle CX
//   comboboxes. Removed because chrome.debugger.attach() conflicts with
//   --remote-debugging-pipe mode used by our CDP bridge.
//   Replacement: char-by-char typing + InputEvent strategies in fillOracleCombobox().


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

// Parse llm_extra_headers (JSON object string) into a header map, defensively.
// Mirrors LLMClient.parseExtraHeaders in lib/llm-client.js (this worker does not
// load that file). Invalid JSON / non-object values are ignored silently.
function parseExtraHeaders(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const headers = {};
  for (const [key, value] of Object.entries(parsed)) {
    const name = String(key).trim();
    if (name && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
      headers[name] = String(value);
    }
  }
  return headers;
}

// ── [FIX E] LLM chat bridge helpers ────────────────────────────────

// Hard ceiling for one proxied LLM call (llm_timeout_ms overrides).
const DEFAULT_LLM_TIMEOUT_MS = 60000;

// Join base URL + /chat/completions without ever producing "//" and without
// dropping the "/v1" segment: 'http://host/v1/' → 'http://host/v1/chat/completions'.
function buildChatCompletionsUrl(baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  return base + '/chat/completions';
}

// Human-readable provider error: prefer the OpenAI-style {error:{type,message}}
// (or flat {type,message}) shape — the local gateway reports MissingSessionID
// there — otherwise fall back to the raw body, whitespace-collapsed.
function describeProviderError(status, bodyText) {
  let detail = '';
  try {
    const parsed = JSON.parse(bodyText);
    const err = parsed && (parsed.error || parsed);
    if (err && typeof err === 'object') {
      detail = [err.type, err.message].filter(Boolean).join(': ');
    } else if (typeof parsed === 'string') {
      detail = parsed;
    }
  } catch (e) { /* not JSON — use raw text below */ }
  if (!detail) detail = String(bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return detail || 'no details';
}

// On first install, set default LLM config if not already configured.
// llm_extra_headers default is REQUIRED by the local Nyro gateway (it rejects
// requests missing x-opencode-session with HTTP 400 MissingSessionID) and is
// harmless against other OpenAI-compatible endpoints. Users can clear it.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get('llm_base_url', (result) => {
    if (!result.llm_base_url) {
      chrome.storage.sync.set({
        llm_base_url: 'http://localhost:19530/v1',
        // [FIX K4] No pinned model default: an empty model makes the client
        // report "No model configured — open Settings and pick one from the
        // fetched model list" instead of a silent gateway 404.
        llm_model: '',
        llm_api_key: 'dummy',
        llm_extra_headers: '{"x-opencode-session":"pi-local"}',
      });
    }
  });
});

// ── Message handlers ──────────────────────────────────────────────
// extract_pdf_text: reads PDF bytes from content script, extracts text via pdf.js
// extract_profile_from_text: sends resume text to LLM, parses structured profile JSON
// jc_open_options: opens the extension options page
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
          chrome.storage.sync.get(['llm_base_url', 'llm_api_key', 'llm_model', 'llm_extra_headers'], resolve);
        });
        const baseUrl = (config.llm_base_url || 'http://localhost:19530/v1').replace(/\/+$/, '');
        const apiKey = config.llm_api_key || 'dummy';
        // [FIX K4] No pinned default model: fail with the actionable error
        // (caught below, returned as {error}) instead of a gateway 404.
        const model = config.llm_model || '';
        if (!model) throw new Error('No model configured — open Settings and pick one from the fetched model list');

        const prompt = `You are parsing a resume. Extract these fields as a JSON object (keys: name, email, phone, linkedin, github, website, address, work_authorization). Return ONLY the JSON. No other text.`;

        const resp = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          // Same merge rule as LLMClient.chat() in lib/llm-client.js:
          // extra headers first, explicit Content-Type / Authorization win.
          headers: {
            ...parseExtraHeaders(config.llm_extra_headers),
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
        // Guard choices[0]: on an empty/missing choices array the old expression
        // threw "Cannot read properties of undefined (reading 'message')" here,
        // which the caller reported as an unrelated extraction failure.
        const choice = (data && Array.isArray(data.choices) && data.choices[0]) || null;
        const message = (choice && choice.message) || null;
        if (!message) {
          throw new Error('API returned no message (choices: ' +
            (data && Array.isArray(data.choices) && data.choices.length ? 'present but empty' : '[]') +
            ') for model "' + model + '". Check the model name and the endpoint.');
        }
        const raw = (message.content || message.reasoning_content || '').trim();
        
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
  // [FIX E] Proxy an LLM chat completion for the content script.
  // Never throws across the message channel: every exit path calls
  // sendResponse exactly once with {ok:true, content} or {ok:false, error}.
  if (msg.type === 'jc_llm_chat') {
    (async () => {
      let responded = false;
      const respond = (payload) => {
        if (responded) return;
        responded = true;
        try { sendResponse(payload); } catch (e) { /* channel already closed */ }
      };
      try {
        const config = await new Promise(resolve => {
          chrome.storage.sync.get(
            ['llm_base_url', 'llm_api_key', 'llm_model', 'llm_extra_headers', 'llm_timeout_ms'],
            resolve,
          );
        });
        const url = buildChatCompletionsUrl(config.llm_base_url || 'http://localhost:19530/v1');
        if (!url) return respond({ ok: false, error: 'LLM bridge: llm_base_url is empty — open Settings' });
        const apiKey = config.llm_api_key || 'dummy';
        // [FIX K4] No pinned default model — refuse with the actionable error
        // instead of letting the gateway 404 with "no route for model".
        const model = config.llm_model || '';
        if (!model) return respond({ ok: false, error: 'No model configured — open Settings and pick one from the fetched model list' });
        const timeoutMs = Number(config.llm_timeout_ms) > 0 ? Number(config.llm_timeout_ms) : DEFAULT_LLM_TIMEOUT_MS;

        // [FIX K4] Bounded retry, mirroring LLMClient.fetchWithRetry():
        // 502/503/504 or a network error ⇒ max 2 attempts, ~700 ms backoff.
        // 4xx and timeouts surface immediately (config bug / already bounded).
        let resp = null, bodyText = '';
        const MAX_ATTEMPTS = 2;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          let netErr = null;
          try {
            resp = await fetch(url, {
              method: 'POST',
              signal: controller.signal,
              // Same merge rule as LLMClient.chat(): extras first, explicit
              // Content-Type / Authorization win on collision.
              headers: {
                ...parseExtraHeaders(config.llm_extra_headers),
                'Content-Type': 'application/json',
                ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
              },
              body: JSON.stringify({
                model,
                messages: Array.isArray(msg.messages) ? msg.messages : [],
                temperature: typeof msg.temperature === 'number' ? msg.temperature : 0.1,
                max_tokens: typeof msg.maxTokens === 'number' ? msg.maxTokens : 200,
              }),
            });
            bodyText = await resp.text();
          } catch (err) {
            netErr = err;
          } finally {
            clearTimeout(timer);
          }
          const aborted = netErr && netErr.name === 'AbortError';
          const transient = !aborted && (!!netErr || (resp && [502, 503, 504].includes(resp.status)));
          if (attempt < MAX_ATTEMPTS && transient) {
            console.warn(`JC: LLM bridge transient failure (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying in 700ms`);
            await new Promise(r => setTimeout(r, 700));
            continue;
          }
          if (netErr) {
            return respond({ ok: false, error: aborted
              ? `LLM request timed out after ${timeoutMs}ms`
              : `LLM request failed: ${(netErr && netErr.message) || String(netErr)}` });
          }
          break;
        }

        if (!resp.ok) {
          return respond({ ok: false, error: `LLM API error ${resp.status}: ${describeProviderError(resp.status, bodyText)}` });
        }
        let data;
        try {
          data = JSON.parse(bodyText);
        } catch (e) {
          return respond({ ok: false, error: 'LLM returned invalid JSON: ' + String(bodyText || '').slice(0, 120) });
        }
        const choice = (data && data.choices && data.choices[0]) || {};
        const message = choice.message || choice.delta || {};
        const content = typeof message.content === 'string' ? message.content.trim() : '';
        const reasoningContent = typeof message.reasoning_content === 'string' ? message.reasoning_content.trim() : '';
        // Reasoning-only responses (local gateway) are still usable: the
        // caller falls back to reasoningContent. Only truly empty fails.
        if (!content && !reasoningContent) {
          return respond({ ok: false, error: 'LLM returned empty response' });
        }
        respond({
          ok: true,
          content,
          ...(reasoningContent ? { reasoningContent } : {}),
          ...(data.usage ? { usage: data.usage } : {}),
        });
      } catch (err) {
        respond({ ok: false, error: 'LLM bridge failed: ' + ((err && err.message) || String(err)) });
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

// ── Hot-reload support ──────────────────────────────────────────
// During development, allow the content script to trigger an extension
// reload by sending a "jc_reload_extension" message. This avoids
// having to restart Chrome to pick up code changes.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'jc_reload_extension') {
    console.log('JC: Hot-reloading extension...');
    chrome.runtime.reload();
    sendResponse({ ok: true });
    return true;
  }
});
