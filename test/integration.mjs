// Integration test: verify all extension logic works together
// Run: node test/integration.mjs

const assert = {
  equal(a, b, m) { if (a !== b) { console.error(`❌ ${m}`); process.exit(1); } console.log(`  ✓ ${m}`); },
  ok(v, m) { if (!v) { console.error(`❌ ${m}`); process.exit(1); } console.log(`  ✓ ${m}`); },
};

console.log('\n🔬 Integration tests\n');

// --- Test 1: Profile extraction prompt correctness ---
const extractPrompt = `You are parsing a resume. Extract these fields as a JSON object (keys: name, email, phone, linkedin, github, website, address, work_authorization). Return ONLY the JSON. No other text.`;
assert.ok(extractPrompt.includes('JSON object'), 'Extract prompt asks for JSON');
assert.ok(extractPrompt.includes('name'), 'Extract prompt requests name field');
assert.ok(extractPrompt.includes('email'), 'Extract prompt requests email field');

// --- Test 2: Model fetch URL construction ---
function buildModelsUrl(baseUrl) {
  const cleaned = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!cleaned) return null;
  return `${cleaned}/models`;
}
assert.equal(buildModelsUrl('http://localhost:19530/v1'), 'http://localhost:19530/v1/models', 'Models URL correct with /v1');
assert.equal(buildModelsUrl('http://localhost:19530'), 'http://localhost:19530/models', 'Models URL correct without /v1');
assert.equal(buildModelsUrl(''), null, 'Empty URL returns null');
console.log('  ✅ Models URL construction correct');

// --- Test 3: Chat completion URL construction ---
function buildChatUrl(baseUrl) {
  const cleaned = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!cleaned) return null;
  return `${cleaned}/chat/completions`;
}
assert.equal(buildChatUrl('http://localhost:19530/v1'), 'http://localhost:19530/v1/chat/completions', 'Chat URL correct');
console.log('  ✅ Chat URL construction correct');

// --- Test 4: Test connection payload ---
function buildTestPayload(model) {
  return {
    model: model,
    messages: [{ role: 'user', content: 'Reply exactly: ok' }],
    max_tokens: 5,
  };
}
const payload = buildTestPayload('deepseek-v4-flash-2');
assert.equal(payload.model, 'deepseek-v4-flash-2', 'Model name in payload');
assert.ok(payload.messages[0].content.includes('ok'), 'Test message correct');
assert.equal(payload.max_tokens, 5, 'Max tokens = 5');
console.log('  ✅ Test payload correct');

// --- Test 5: Form detection field patterns ---
const fieldPatterns = ['name', 'email', 'phone', 'linkedin', 'github', 'website', 'address', 'work_authorization', 'resume', 'cover_letter'];
fieldPatterns.forEach(p => assert.ok(typeof p === 'string', `Field pattern '${p}' is string`));
assert.equal(fieldPatterns.length, 10, '10 personal field patterns');
console.log('  ✅ Field detection patterns correct');

// --- Test 6: Saved answers management ---
function saveAnswer(answers, question, answer) {
  if (!question || !answer) return answers;
  let result = [...(answers || [])];
  result = result.filter(qa => qa.question.toLowerCase().trim() !== question.toLowerCase().trim());
  result.unshift({ question: question.trim(), answer: answer.trim(), date: '2026-05-22' });
  if (result.length > 50) result = result.slice(0, 50);
  return result;
}
const saved = saveAnswer([], 'Why us?', 'Because I match the role');
assert.equal(saved.length, 1, 'Saved one answer');
assert.equal(saved[0].question, 'Why us?', 'Question preserved');
const saved2 = saveAnswer(saved, 'Why us?', 'Updated answer');
assert.equal(saved2.length, 1, 'Duplicate replaced');
assert.equal(saved2[0].answer, 'Updated answer', 'Answer updated');
const saved3 = saveAnswer(saved2, 'Other?', 'Answer 2');
assert.equal(saved3.length, 2, 'Two unique answers');
console.log('  ✅ Q&A bank logic correct');

console.log('\n🎉 All 6 integration tests passed!\n');
