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

  // Generate an answer for a job application question
  // Called by content.js fillAIQuestions() and fillSingleField()
  async generateAnswer(question, jobDescription, resumeText) {
    return this.chat([
      { role: 'system', content: 'You are helping a job applicant answer application questions. Use the resume and job description to write a concise, professional answer. Be honest — do not invent experience. Answer directly with no explanation.' },
      { role: 'user', content: `Job Description:\n${jobDescription || '(Not provided)'}\n\nResume:\n${resumeText}\n\nQuestion: ${question}\n\nAnswer:` },
    ], { temperature: 0.3, maxTokens: 300 });
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
