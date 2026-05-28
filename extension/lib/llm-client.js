// ═══════════════════════════════════════════════════════════════
// LLM Client — THE API BRIDGE
// ═══════════════════════════════════════════════════════════════
//
// FILE ROLE:
//   This file talks to your LLM endpoint. It formats prompts, sends HTTP
//   requests, and parses responses. It handles both regular models (which
//   return content) and reasoning models (which return reasoning_content).
//
// WHY THIS FILE EXISTS SEPARATELY:
//   The options page needs to call the LLM to test the connection and to
//   extract profiles from resume text. The content script needs it to
//   answer application questions. If LLM logic lived in content.js, the
//   options page would have to duplicate it. This file is shared by both.
//
// STEP 10 IN THE EXECUTION TRACE:
//   generateAnswer(question, jobDescription, resumeText) is called by
//   content.js fillAIQuestions(). It formats a chat completion request
//   with a system prompt ("answer this question using the resume and JD")
//   and a user message containing the question, JD, and resume text.
//   POSTs to the configured endpoint. Returns the answer string.
// ═══════════════════════════════════════════════════════════════

const LLMClient = {
  async getConfig() {
    const result = await chrome.storage.sync.get([
      'llm_base_url', 'llm_api_key', 'llm_model',
    ]);
    return {
      baseUrl: (result.llm_base_url || 'http://localhost:19530/v1').replace(/\/+$/, ''),
      apiKey: result.llm_api_key || 'dummy',
      model: result.llm_model || 'deepseek-v4-flash-2',
    };
  },

  async chat(messages, options = {}) {
    const config = await this.getConfig();
    const { temperature = 0.1, maxTokens = 200 } = options;

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages: messages,
        temperature: temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`LLM API error ${response.status}: ${err}`);
    }

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
  }
};
