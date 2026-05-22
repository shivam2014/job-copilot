// Test: LLM prompt construction and response parsing
// Run: node test/llm_prompts.mjs

const assert = {
  equal(a, b, m) { if (a !== b) { console.error(`❌ ${m}: ${a} !== ${b}`); process.exit(1); } console.log(`  ✓ ${m}`); },
  ok(v, m) { if (!v) { console.error(`❌ ${m}`); process.exit(1); } console.log(`  ✓ ${m}`); },
};

console.log('\n🔬 LLM Prompt Tests\n');

// Simulated prompt builders (mirrors llm-client.js logic)

function buildExtractPrompt() {
  return `You are parsing a resume. Extract these fields as a JSON object (keys: name, email, phone, linkedin, github, website, address, work_authorization). Return ONLY the JSON. No other text.`;
}

function buildAnswerPrompt(question, resumeText, jobDescription) {
  return {
    system: 'You are helping a job applicant answer application questions. Use the resume and job description to write a concise, professional answer. Be honest — do not invent experience. Answer directly with no explanation.',
    user: `Job Description:\n${jobDescription || '(Not provided)'}\n\nResume:\n${resumeText}\n\nQuestion: ${question}\n\nAnswer:`,
  };
}

function buildTestPayload(model) {
  return { model, messages: [{ role: 'user', content: 'Reply exactly: ok' }], max_tokens: 5 };
}

function parseExtractionResponse(raw) {
  if (!raw) return null;
  let json = raw;
  const m = json.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (m) json = m[1];
  const start = json.indexOf('{');
  const end = json.lastIndexOf('}') + 1;
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(json.slice(start, end)); } catch { return null; }
}

// Test 1: Extract prompt
const ep = buildExtractPrompt();
['name', 'email', 'phone', 'linkedin', 'github', 'website', 'address', 'work_authorization', 'JSON', 'Return ONLY'].forEach(k => {
  assert.ok(ep.includes(k), `Extract prompt includes "${k}"`);
});
console.log('  ✅ Extract prompt has all fields');

// Test 2: Answer prompt
const ap = buildAnswerPrompt('Why join us?', 'Fake resume text', 'Fake JD');
assert.ok(ap.system.includes('concise, professional'), 'System prompt asks for concise answer');
assert.ok(ap.system.includes('do not invent'), 'System prompt warns against fabrication');
assert.ok(ap.user.includes('Why join us?'), 'User prompt includes question');
assert.ok(ap.user.includes('Fake resume text'), 'User prompt includes resume');
assert.ok(ap.user.includes('Fake JD'), 'User prompt includes job description');
console.log('  ✅ Answer prompt structure correct');

// Test 3: Test payload
const tp = buildTestPayload('deepseek-v4-flash-2');
assert.equal(tp.model, 'deepseek-v4-flash-2', 'Correct model');
assert.equal(tp.messages.length, 1, 'Single message');
assert.equal(tp.messages[0].role, 'user', 'User role');
assert.equal(tp.max_tokens, 5, 'Minimal tokens');
console.log('  ✅ Test connection payload correct');

// Test 4: Parse extraction response — JSON only
let r = parseExtractionResponse('{"name": "John", "email": "john@test.com"}');
assert.equal(r.name, 'John', 'Parsed name');
assert.equal(r.email, 'john@test.com', 'Parsed email');
console.log('  ✅ Plain JSON parsed');

// Test 5: Parse extraction response — markdown fenced
r = parseExtractionResponse('```json\n{"name": "Jane"}\n```');
assert.equal(r.name, 'Jane', 'Parsed from markdown fence');
console.log('  ✅ Markdown fenced JSON parsed');

// Test 6: Parse extraction response — with reasoning prefix
r = parseExtractionResponse('Based on the resume, I extracted: {"name": "Bob", "email": "bob@test.com"}');
assert.equal(r.name, 'Bob', 'Parsed with prefix text');
assert.equal(r.email, 'bob@test.com', 'Email parsed with prefix');
console.log('  ✅ JSON with prefix text parsed');

// Test 7: Parse empty/invalid
assert.equal(parseExtractionResponse(''), null, 'Empty returns null');
assert.equal(parseExtractionResponse('Not JSON at all'), null, 'No JSON returns null');
console.log('  ✅ Invalid responses handled');

// Test 8: Parse extraction from reasoning model
r = parseExtractionResponse('{"name": "Alice"}');
assert.equal(r.name, 'Alice', 'Reasoning model format parsed');
console.log('  ✅ Reasoning model response parsed');

// Test 9: Resume text truncation (max 4000 chars)
function truncate(text, max) { return text.length > max ? text.slice(0, max) : text; }
assert.equal(truncate('short', 4000).length, 5, 'Short stays short');
assert.equal(truncate('x'.repeat(5000), 4000).length, 4000, 'Long truncated to 4000');
console.log('  ✅ Resume truncation correct');

// Test 10: Handle reasoning_content
function extractReply(data) {
  const msg = data.choices?.[0]?.message;
  if (!msg) return '';
  return (msg.content || msg.reasoning_content || '').trim();
}
const normal = { choices: [{ message: { content: 'Hello', reasoning_content: 'thinking...' } }] };
assert.equal(extractReply(normal), 'Hello', 'content preferred over reasoning_content');

const reasoning = { choices: [{ message: { content: '', reasoning_content: 'The answer is 42' } }] };
assert.equal(extractReply(reasoning), 'The answer is 42', 'reasoning_content fallback');

const empty = { choices: [{ message: { content: '', reasoning_content: '' } }] };
assert.equal(extractReply(empty), '', 'Empty returns empty string');
console.log('  ✅ Reasoning model reply extraction correct');

console.log('\n🎉 All LLM prompt tests passed!\n');
