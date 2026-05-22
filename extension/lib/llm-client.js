// LLM Client — OpenAI-compatible API wrapper
// Supports any provider: OpenAI, local llama.cpp, Ollama, vLLM, Nyro, etc.

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
    return data.choices[0].message.content.trim();
  },

  // Extract a value for any form field from the resume
  // Works for personal fields (name, email, phone) AND open-ended questions
  async extractFieldValue(fieldLabel, fieldType, resumeText, jobDescription) {
    let systemPrompt, userPrompt;

    if (fieldType === 'personal') {
      // Direct extraction — pull exact value from resume
      systemPrompt = `You are filling a job application form. 
Extract the EXACT value for "${fieldLabel}" from the resume below.
Return ONLY the value — no explanation, no quotes, no label.
If the field asks for a URL, return the full URL.
If the value is not found in the resume, return "".`;

      userPrompt = `Resume:\n${resumeText}\n\nExtract: ${fieldLabel}`;
    } else {
      // Open-ended question — generate tailored answer
      systemPrompt = `You are helping a job applicant answer application questions.
Use the resume and job description to write a concise, professional answer.
Be honest — do not invent experience.
Answer directly with no explanation or meta-commentary.`;

      userPrompt = `Job Description:\n${jobDescription || '(Not provided)'}\n\nResume:\n${resumeText}\n\nQuestion: ${fieldLabel}\n\nAnswer:`;
    }

    return this.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.1, maxTokens: fieldType === 'personal' ? 100 : 300 });
  }
};
