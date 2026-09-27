// ═══════════════════════════════════════════════════════════════
// LLM Client — THE API BRIDGE
// ═══════════════════════════════════════════════════════════════
//
// FILE ROLE:
//   This file talks to your LLM endpoint. An LLM endpoint is a web server
//   that accepts text prompts and returns generated text responses — like
//   ChatGPT but accessed via an API. The endpoint can be OpenAI's servers,
//   a local model running on your machine, or any OpenAI-compatible service.
//
//   This file handles two things:
//   1. Formatting: it takes a question, job description, and resume text,
//      and wraps them into the message format the LLM API expects.
//   2. Communication: it sends HTTP POST requests to the endpoint and
//      parses the response. It handles both regular models (which return
//      their answer in a "content" field) and reasoning models like DeepSeek
//      (which return their answer in a "reasoning_content" field).
//      [FIX E] In a content-script context the POST is proxied through the
//      service worker (message jc_llm_chat) — a page-origin fetch to the LLM
//      endpoint is rejected by MV3/CORS ("Failed to fetch"). The direct fetch
//      below is kept only for contexts without chrome.runtime.sendMessage.
//
// WHY THIS FILE EXISTS SEPARATELY:
//   Two different parts of the extension need to call the LLM:
//   - The options page calls it to test the connection ("is my API key valid?")
//     and to extract profile data from resume text.
//   - The content script calls it to generate answers for application questions.
//   If LLM logic lived in content.js, the options page would have to duplicate
//   it. This shared file avoids that.
//
// HOW IT'S USED IN THE FILL ALL TRACE (Step 10):
//   content.js fillAIQuestions() calls LLMClient.generateAnswer(question, jd, resumeText).
//   generateAnswer() formats a "chat completion" request — a structured message
//   with a system role (instructions) and a user role (the actual question).
//   It POSTs this to the configured endpoint. The endpoint returns a JSON
//   response with the generated answer. generateAnswer() extracts and returns
//   just the answer text.
// ═══════════════════════════════════════════════════════════════

const LLMClient = {
  // [FIX K4] NO PINNED DEFAULT MODEL — deliberately empty.
  // The gateway 404s unknown model ids with an opaque "no route for model",
  // so a pinned default made a fresh install fail before the LLM was reached.
  // With no model configured, chat() throws the actionable Settings error
  // below instead of silently sending a request that cannot succeed.
  // The authoritative list always comes from `${base_url}/models`.
  DEFAULT_MODEL: '',

  // Single source of truth for the user-facing message (mirrored verbatim in
  // extension/background/background.js and asserted by test/llm_config.mjs).
  NO_MODEL_ERROR: 'No model configured — open Settings and pick one from the fetched model list',

  async getConfig() {
    const result = await chrome.storage.sync.get([
      'llm_base_url', 'llm_api_key', 'llm_model', 'llm_extra_headers',
    ]);
    return {
      baseUrl: (result.llm_base_url || 'http://localhost:19530/v1').replace(/\/+$/, ''),
      apiKey: result.llm_api_key || 'dummy',
      model: result.llm_model || this.DEFAULT_MODEL,
      extraHeaders: this.parseExtraHeaders(result.llm_extra_headers),
    };
  },

  // Parse the llm_extra_headers storage value (a JSON object string) into a
  // header map. Defensive by design: this runs on the request path, so invalid
  // JSON, non-objects (e.g. "[1,2]") and non-scalar values are ignored
  // silently — it must never throw. Only string/number/boolean values pass through.
  parseExtraHeaders(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return {};
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return {}; // invalid JSON → ignore silently
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const headers = {};
    for (const [key, value] of Object.entries(parsed)) {
      const name = String(key).trim();
      if (!name) continue;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        headers[name] = String(value);
      }
    }
    return headers;
  },

  // Guard predicate: an answer is unusable when it is missing or whitespace-only.
  // content.js checks this before writing an answer into a form field.
  isBlankAnswer(text) {
    return typeof text !== 'string' || text.trim().length === 0;
  },

  // [FIX K1] Output guard. Rejects model output that is meta-commentary about
  // the prompt (or a refusal) instead of an answer to the question. Verbatim
  // failure this exists for (Lever, unlabeled textarea, name was a DOM id):
  //   `We need answer application question. Need infer field0? It asks: ...`
  // REJECT when text is non-string/blank, shorter than 3 words, or matches ANY
  // of these predicates:
  //   a) /need infer|not showing field label|as an ai|i cannot|i can't|i'm unable|i am unable|unable to answer/i   (meta / refusal)
  //   a2) /\bneed (to )?(answer|craft|write|infer|provide|respond|use|be)\b/i and
  //       /\b(no explanation|don'?t invent|do not invent|not invent)\b/i and
  //       /\bwe (must|cannot|can't|don't|do not|need)\b/i  — the scratchpad style
  //       the local reasoning model emits in reasoning_content (live Lever run:
  //       "We need answer directly no explanation. Need craft concise …")
  //   b) /\b(question|answer|job description|job desc|jd|resume)\s*:/i   (prompt echo)
  //   c) /\b(the prompt|these instructions|your instructions|system prompt)\b/i  (quotes the instructions)
  //   d) /\[field\d*\]|cards\[[0-9a-f-]{6,}\]/i  (raw DOM identifier leaked from the field)
  //   e) equals or starts with the question text (echo of the question)
  isMetaAnswer(text, question) {
    if (typeof text !== 'string') return true;
    const a = text.replace(/\s+/g, ' ').trim();
    if (!a) return true;
    if (a.split(' ').filter(Boolean).length < 3) return true; // (a0) too short to be an answer
    if (/(need infer|not showing field label|as an ai|i cannot|i can't|i'm unable|i am unable|unable to answer)/i.test(a)) return true;
    if (/\bneed (to )?(answer|craft|write|infer|provide|respond|use|be)\b/i.test(a)) return true;
    if (/\b(no explanation|don'?t invent|do not invent|not invent)\b/i.test(a)) return true;
    if (/\bwe (must|cannot|can't|don't|do not|need)\b/i.test(a)) return true;
    if (/\b(question|answer|job description|job desc|jd|resume)\s*:/i.test(a)) return true;
    if (/\b(the prompt|these instructions|your instructions|system prompt)\b/i.test(a)) return true;
    if (/\[field\d*\]|cards\[[0-9a-f-]{6,}\]/i.test(a)) return true;
    const q = String(question || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const lower = a.toLowerCase();
    if (q.length >= 12 && (lower === q || lower.startsWith(q))) return true;
    return false;
  },

  // [FIX E] True in a content-script context, where the service worker can
  // proxy the request; false in unit tests / options page (direct fetch).
  serviceWorkerBridgeAvailable() {
    return typeof chrome !== 'undefined' && !!(chrome.runtime && typeof chrome.runtime.sendMessage === 'function');
  },

  async chat(messages, options = {}) {
    const { temperature = 0.1, maxTokens = 200 } = options;

    // [FIX K4] Resolve config FIRST and refuse to send without a model. This
    // applies to BOTH paths (service-worker bridge and direct fetch): a fresh
    // install must fail with an actionable message, never an opaque gateway
    // 404. No request is sent when the model is missing.
    const config = await this.getConfig();
    if (!config.model) throw new Error(this.NO_MODEL_ERROR);

    // ── [FIX E] Preferred path: proxy through the service worker ──
    // A content script's fetch() is a page-origin cross-origin request to the
    // LLM endpoint — MV3/CORS reject it with "Failed to fetch" (P1/P2). The
    // service worker has the extension origin, so chat() goes through it.
    // Direct fetch is kept only for contexts without chrome.runtime.sendMessage.
    if (this.serviceWorkerBridgeAvailable()) {
      let resp;
      try {
        resp = await chrome.runtime.sendMessage({ type: 'jc_llm_chat', messages, temperature, maxTokens });
      } catch (bridgeErr) {
        // Channel-level failure (worker not answering / context invalidated):
        // fall back to the direct request instead of failing the whole fill.
        console.warn('JC: LLM bridge unavailable (' + ((bridgeErr && bridgeErr.message) || bridgeErr) + ') — using direct fetch');
        resp = null;
      }
      if (resp) {
        if (!resp.ok) throw new Error(resp.error || 'LLM bridge returned no details');
        // Reasoning-only gateway responses have empty content — use them too.
        const bridged = String(resp.content || resp.reasoningContent || '').trim();
        if (!bridged) throw new Error('LLM returned empty response');
        return bridged;
      }
    }

    // (config already resolved above, before any path was taken)

    // ── Header assembly: THE place every LLM request gets its headers ──
    // Extra headers (llm_extra_headers, e.g. {"x-opencode-session":"pi-local"},
    // required by the local Nyro gateway and harmless elsewhere) are spread
    // FIRST so the explicit Content-Type / Authorization below always win
    // when a key collides.
    const headers = {
      ...(config.extraHeaders || {}),
      'Content-Type': 'application/json',
      ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {}),
    };

    // [FIX K4] Bounded retry lives here: transient upstream failures only.
    const response = await this.fetchWithRetry(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: messages,
        temperature: temperature,
        max_tokens: maxTokens,
      }),
    });

    const data = await response.json();
    const msg = data.choices[0].message;
    
    // Handle reasoning models (e.g., DeepSeek) that put output in reasoning_content
    let text = (msg.content || '').trim();
    if (!text) {
      text = (msg.reasoning_content || '').trim();
    }
    if (!text) {
      throw new Error('LLM returned empty response');
    }
    
    return text;
  },

  // [FIX K4] Bounded retry for TRANSIENT upstream failures only:
  //   - HTTP 502 / 503 / 504 (upstream restart / gateway hiccup)
  //   - network-level fetch rejection (TypeError "Failed to fetch")
  // Max 2 attempts total (1 retry), ~700 ms backoff. 4xx is NEVER retried:
  // a 400/404 is a config bug (wrong model id, bad key) and must surface
  // immediately with its body text. Used by BOTH the direct fetch below and
  // (mirrored) by the service-worker bridge in background.js.
  async fetchWithRetry(url, opts, attempts = 2, backoffMs = 700) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let res = null;
      let netErr = null;
      try {
        res = await fetch(url, opts);
      } catch (e) {
        netErr = e; // network error — retryable
      }
      const retryableStatus = res && [502, 503, 504].includes(res.status);
      if (attempt < attempts && (netErr || retryableStatus)) {
        console.warn(`JC: LLM transient failure (${netErr ? (netErr.message || netErr) : res.status}) — retry ${attempt}/${attempts - 1} in ${backoffMs}ms`);
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }
      if (netErr) throw netErr;
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`LLM API error ${res.status}: ${err}`);
      }
      return res;
    }
    throw new Error('LLM request failed after retries');
  },

  // Generate an answer for a job application question
  // Called by content.js fillAIQuestions() and fillSingleField()
  // opts.strict: second-pass prompt after the meta-answer guard rejected the
  // first output (Bug K1) — forbids mentioning the prompt/instructions.
  //
  // [FIX K1] maxTokens is 1600, not 300. Live measurement against the local
  // reasoning model: the 300-token budget was consumed ENTIRELY by
  // reasoning_content (finish_reason "length", content "") — the bridge then
  // fell back to the scratchpad, which is what got written into the Lever
  // textarea. At 1600 the model finishes reasoning (≈400 tokens) and returns a
  // real answer in content (measured 6.2 s, finish_reason "stop").
  async generateAnswer(question, jobDescription, resumeText, opts = {}) {
    const system = opts.strict
      ? 'You are writing ONE field value for a job application form. Reply with the answer text only. Never mention the question, the prompt, these instructions, or that you are an AI. If the question text is unreadable, reply exactly: SKIP'
      : 'You are helping a job applicant answer application questions. Use the resume and job description to write a concise, professional answer. Be honest — do not invent experience. Answer directly with no explanation.';
    return this.chat([
      { role: 'system', content: system },
      { role: 'user', content: `Job Description:\n${jobDescription || '(Not provided)'}\n\nResume:\n${resumeText}\n\nQuestion: ${question}\n\nAnswer:` },
    ], { temperature: opts.strict ? 0.1 : 0.3, maxTokens: 1600 });
  },

  // [FIX K1] Answer pipeline with the output guard: first answer rejected as
  // meta-commentary → ONE retry with the stricter prompt; still rejected →
  // empty answer. The caller leaves the field blank and reports the skip —
  // blank is correct, nonsense is not. Returns { answer, tries, rejected }.
  async generateVerifiedAnswer(question, jobDescription, resumeText) {
    const first = await this.generateAnswer(question, jobDescription, resumeText);
    if (!this.isMetaAnswer(first, question)) return { answer: first, tries: 1, rejected: false };
    console.warn('JC: rejected meta-answer (tries=1) — retrying once with a stricter prompt');
    const second = await this.generateAnswer(question, jobDescription, resumeText, { strict: true });
    if (!this.isMetaAnswer(second, question)) return { answer: second, tries: 2, rejected: true };
    console.warn('JC: stricter retry also unusable — leaving field blank');
    return { answer: '', tries: 2, rejected: true };
  },

  // Extract a value for any form field from the resume
  async extractFieldValue(fieldLabel, fieldType, resumeText, jobDescription) {
    if (fieldType === 'personal') {
      return this.chat([
        { role: 'system', content: `You are filling a job application form. Extract the EXACT value for "${fieldLabel}" from the resume below. Return ONLY the value — no explanation, no quotes, no label. If the value is not found, return "".` },
        { role: 'user', content: `Resume:\n${resumeText}\n\nExtract: ${fieldLabel}` },
      ], { temperature: 0.05, maxTokens: 100 });
    } else {
      return this.chat([
        { role: 'system', content: 'You are helping a job applicant answer application questions. Use the resume and job description to write a concise, professional answer. Be honest — do not invent experience. Answer directly with no explanation.' },
        { role: 'user', content: `Job Description:\n${jobDescription || '(Not provided)'}\n\nResume:\n${resumeText}\n\nQuestion: ${fieldLabel}\n\nAnswer:` },
      ], { temperature: 0.3, maxTokens: 300 });
    }
  },
};
