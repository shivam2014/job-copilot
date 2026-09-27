// Test: Answer pipeline — K1 question-label derivation + meta-answer guard,
// K4 empty-model error + bounded transient retry,
// L1 learned-key guard + L2 AI-write markers + one-time inert-key migration.
// Run: node test/answers.mjs
//
// Uses the REAL functions: extension/lib/llm-client.js and
// extension/content/form-detector.js are loaded in a vm sandbox (same pattern
// as test/llm_config.mjs / test/extraction_parse.mjs). Only the DOM elements
// the label derivation walks are hand-built stubs.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const assert = {
  equal(a, b, m) { if (a !== b) { console.error(`❌ ${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); process.exit(1); } console.log(`  ✓ ${m}`); },
  ok(v, m) { if (!v) { console.error(`❌ ${m}`); process.exit(1); } console.log(`  ✓ ${m}`); },
  deepEqual(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`❌ ${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); process.exit(1); } console.log(`  ✓ ${m}`); },
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

console.log('\n🔬 Answer Pipeline Tests (K1/K4)\n');

const llmClientSrc = readFileSync(join(root, 'extension/lib/llm-client.js'), 'utf8');
const formDetectorSrc = readFileSync(join(root, 'extension/content/form-detector.js'), 'utf8');

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

// Real llm-client.js in a vm sandbox (no chrome.runtime ⇒ direct fetch path).
function loadClient(storage, fetchImpl) {
  const ctx = vm.createContext({
    chrome: { storage: { sync: { get: async (keys) => {
      const out = {};
      for (const k of keys) if (k in storage) out[k] = storage[k];
      return out;
    } } } },
    fetch: fetchImpl || (async () => jsonResponse({})),
    console,
    setTimeout,
    clearTimeout,
  });
  return vm.runInNewContext(llmClientSrc + '\n;LLMClient', ctx);
}

// Real form-detector.js in a vm sandbox with a minimal document stub.
function loadFormDetector(doc) {
  const ctx = vm.createContext({
    chrome: { storage: { sync: { get: () => {}, set: () => {} } } },
    window: {},
    document: doc || { body: {}, getElementById: () => null, querySelector: () => null },
    console,
    setTimeout,
    clearTimeout,
    Event: class {},
    InputEvent: class {},
    KeyboardEvent: class {},
    HTMLTextAreaElement: class {},
    HTMLInputElement: class {},
    HTMLSelectElement: class {},
  });
  return vm.runInNewContext(formDetectorSrc + '\n;FormDetector', ctx);
}

// ── DOM stubs: only what deriveQuestionText() walks ────────────────
function makeEl(props = {}) {
  return Object.assign({
    name: '', id: '', placeholder: '', labels: [], value: '',
    parentElement: null, previousElementSibling: null, childNodes: [],
    getAttribute: () => null,
    querySelectorAll: () => [],
    contains: () => false,
  }, props);
}

function makeContainer(text, fieldEl) {
  const heading = {
    textContent: text, childNodes: [], parentElement: null, previousElementSibling: null,
    contains: () => false, querySelectorAll: () => [], getAttribute: () => null,
  };
  return {
    childNodes: [], parentElement: null, previousElementSibling: null,
    contains: (n) => n === fieldEl,
    getAttribute: () => null,
    querySelectorAll: () => [heading], // any heading-like query returns the title
  };
}

const LEVER_NAME = 'cards[a47a5e9b-364a-4c6b-9363-b2e587bd8f04][field0]';

// ── 1. Label derivation: DOM identifier, no label ⇒ '' ⇒ skip ──────
{
  const fd = loadFormDetector();
  const el = makeEl({ name: LEVER_NAME });
  const field = { el, name: 'unknown', label: LEVER_NAME, identifiers: LEVER_NAME, questionText: undefined };

  assert.equal(fd.deriveQuestionText(field), '', 'DOM name cards[uuid][field0] + no label ⇒ empty question text');
  assert.equal(fd.isDomIdentifier(LEVER_NAME, field), true, 'DOM-identifier predicate matches cards[uuid][field0]');
  assert.equal(fd.isDomIdentifier('', field), true, 'empty text is unusable (skip predicate)');
  assert.equal(fd.isDomIdentifier('What is your current location?', field), false, 'real question text is NOT a DOM identifier');
  assert.equal(fd.isDomIdentifier(LEVER_NAME, { el: makeEl({ name: LEVER_NAME }) }), true, 'text equal to the field name is a DOM identifier');

  // The content.js guard clause (K1 step 2), mirrored exactly: no LLM call,
  // nothing written, counted as skipped.
  const client = loadClient({ llm_model: 'test-model' });
  let llmCalls = 0;
  client.chat = async () => { llmCalls++; return 'irrelevant'; };
  const written = [];
  const runQuestionField = async (f) => {
    const question = f.questionText || fd.deriveQuestionText(f);
    if (!question || fd.isDomIdentifier(question, f)) return { skipped: true };
    const res = await client.generateVerifiedAnswer(question, 'jd', 'resume');
    if (!res.answer) return { skipped: true };
    written.push(res.answer);
    return { skipped: false, answer: res.answer };
  };
  const r = await runQuestionField(field);
  assert.equal(r.skipped, true, 'unreadable question ⇒ skipped (no answer requested)');
  assert.equal(llmCalls, 0, 'unreadable question ⇒ NO LLM call');
  assert.equal(written.length, 0, 'unreadable question ⇒ nothing written');
  console.log('  ✅ K1 step 1+2: DOM-identifier questions are skipped, never prompted');
}

// ── 2. Label derivation: real container text, sanitized + capped ───
{
  const fd = loadFormDetector();
  const el = makeEl({ name: LEVER_NAME });
  const container = makeContainer(`Question:   Why   do you want\nto work at Supermove? ${LEVER_NAME}`, el);
  el.parentElement = container;
  const field = { el, name: 'unknown', label: LEVER_NAME };

  assert.equal(
    fd.deriveQuestionText(field),
    'Why do you want to work at Supermove?',
    'container heading ⇒ real question text (DOM identifiers stripped, whitespace collapsed)'
  );

  // explicit sanitizer contracts
  assert.equal(fd.sanitizeQuestionText('  a \n b\tc  ', { el: null }), 'a b c', 'whitespace collapsed');
  assert.equal(
    fd.sanitizeQuestionText('Question: Do you need sponsorship?', { el: null }),
    'Do you need sponsorship?',
    'leading "Question:" prefix stripped'
  );
  assert.equal(
    fd.sanitizeQuestionText(`Tell us about a project. ${LEVER_NAME}`, { el }),
    'Tell us about a project.',
    'the field\'s own DOM name is stripped from the label'
  );
  const long = await0();
  function await0() { return 'word '.repeat(100).trim(); } // 499 chars
  assert.ok(fd.sanitizeQuestionText(long, { el: null }).length <= 300, 'label capped at ~300 chars');
  console.log('  ✅ K1 step 1: label derivation + sanitization');
}

// ── 3. Meta-answer rejection predicates (each case) ────────────────
{
  const c = loadClient({ llm_model: 'test-model' });
  const question = 'What is your motivation for applying to this role at Supermove?';

  const metaCases = [
    [`We need answer application question. Need infer field0? It asks: "Question: ${LEVER_NAME}" Not showing field label. Need a`, 'verbatim live meta-answer (Need infer / Not showing field label)'],
    ['As an AI, I cannot answer this question.', 'refusal (As an AI / I cannot)'],
    ['Question: What is your motivation?\nAnswer: Because I like it.', 'prompt echo (Question: / Answer:)'],
    ['Answer: See the instructions above.', 'Answer: prefix'],
    ['Yes.', 'under 3 words'],
    [`${question} Because the mission.`, 'question echoed verbatim'],
    [`The prompt asks me to answer. Here ${LEVER_NAME}`, 'quotes the prompt + leaks DOM id'],
    [`We need answer directly no explanation. Need craft concise professional answer why Supermove/position, using resume and JD. Need honest, don't invent.`, 'scratchpad style (verbatim live reasoning_content leak)'],
    ['Job Description: Supermove. Resume: aerospace engineer. We must not invent details.', 'prompt-marker echo (Job Description: / Resume:)'],
  ];
  for (const [text, label] of metaCases) {
    assert.equal(c.isMetaAnswer(text, question), true, 'rejected: ' + label);
  }

  const legit = 'I have five years of experience building dashboards. In my current role I shipped two internal tools used daily.';
  assert.equal(c.isMetaAnswer(legit, question), false, 'legitimate 2-sentence answer passes unchanged');
  // Documented limitation of the spec'd predicate: a <3-word answer is always
  // rejected, even when factual. Only AI-question textareas go through this
  // guard — personal fields (city, phone, …) never do.
  assert.equal(c.isMetaAnswer('Gdansk', question), true, 'documented limitation: <3-word output is rejected by the length rule');
  console.log('  ✅ K1 step 3: meta-answer predicates');
}

// ── 4. Guard wiring: at most ONE stricter retry, then skip ─────────
{
  const c = loadClient({ llm_model: 'test-model' });
  let calls = 0;
  c.chat = async () => { calls++; return calls === 1 ? 'Need infer field0? Not showing field label.' : 'I cannot answer that right now.'; };
  const res = await c.generateVerifiedAnswer('What is your motivation?', 'jd', 'resume');
  assert.equal(calls, 2, 'rejected answer ⇒ exactly one stricter retry (2 attempts total, never 3)');
  assert.equal(res.tries, 2, 'tries reported as 2');
  assert.equal(res.answer, '', 'still-unusable answer ⇒ empty answer ⇒ caller leaves the field blank');

  let calls2 = 0;
  c.chat = async () => { calls2++; return calls2 === 1 ? 'As an AI I cannot do that.' : 'I have five years of experience. I led two data migrations.'; };
  const res2 = await c.generateVerifiedAnswer('Why do you want this role?', 'jd', 'resume');
  assert.equal(calls2, 2, 'rejected first answer ⇒ one retry');
  assert.equal(res2.answer, 'I have five years of experience. I led two data migrations.', 'retried answer returned unchanged');
  assert.equal(res2.rejected, true, 'retried flag set');

  let calls3 = 0;
  c.chat = async () => { calls3++; return 'I have five years of experience. I led two data migrations.'; };
  const res3 = await c.generateVerifiedAnswer('Why do you want this role?', 'jd', 'resume');
  assert.equal(calls3, 1, 'good first answer ⇒ no retry');
  assert.equal(res3.tries, 1, 'tries reported as 1');
  assert.equal(res3.answer, 'I have five years of experience. I led two data migrations.', 'legitimate answer passes unchanged');
  console.log('  ✅ K1 step 3 wiring: one retry, then skip (blank)');
}

// ── 5. LLM retry policy: 502/network retried, 4xx never ────────────
{
  const storage = { llm_base_url: 'http://gw/v1', llm_api_key: 'k', llm_model: 'test-model' };

  // 502 once, then 200 ⇒ succeeds, exactly 2 fetches
  let fetches = 0;
  const cA = loadClient(storage, async () => {
    fetches++;
    if (fetches === 1) return { ok: false, status: 502, text: async () => 'bad gateway', json: async () => ({}) };
    return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
  });
  const outA = await cA.chat([{ role: 'user', content: 'x' }]);
  assert.equal(outA, 'ok', '502 then success ⇒ chat succeeds');
  assert.equal(fetches, 2, '502 retried exactly once');

  // 502 always ⇒ surfaced after max 2 attempts
  let fetches2 = 0;
  const cB = loadClient(storage, async () => {
    fetches2++;
    return { ok: false, status: 503, text: async () => 'unavailable', json: async () => ({}) };
  });
  let errB = null;
  try { await cB.chat([{ role: 'user', content: 'x' }]); } catch (e) { errB = e.message; }
  assert.ok(/LLM API error 503/.test(errB || ''), 'persistent 503 ⇒ error surfaced with status');
  assert.equal(fetches2, 2, 'max 2 attempts total (1 retry)');

  // network error once, then 200 ⇒ retried
  let fetches3 = 0;
  const cC = loadClient(storage, async () => {
    fetches3++;
    if (fetches3 === 1) throw new TypeError('Failed to fetch');
    return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
  });
  const outC = await cC.chat([{ role: 'user', content: 'x' }]);
  assert.equal(outC, 'ok', 'network error then success ⇒ chat succeeds');
  assert.equal(fetches3, 2, 'network error retried once');

  // 400 ⇒ NOT retried, surfaced immediately
  let fetches4 = 0;
  const cD = loadClient(storage, async () => {
    fetches4++;
    return { ok: false, status: 400, text: async () => 'bad request', json: async () => ({}) };
  });
  let errD = null;
  try { await cD.chat([{ role: 'user', content: 'x' }]); } catch (e) { errD = e.message; }
  assert.ok(/LLM API error 400/.test(errD || ''), '400 ⇒ error surfaced immediately');
  assert.equal(fetches4, 1, '400 NOT retried (config bug)');

  // 404 (unknown model) ⇒ NOT retried
  let fetches5 = 0;
  const cE = loadClient(storage, async () => {
    fetches5++;
    return { ok: false, status: 404, text: async () => 'no route for model', json: async () => ({}) };
  });
  let errE = null;
  try { await cE.chat([{ role: 'user', content: 'x' }]); } catch (e) { errE = e.message; }
  assert.ok(/LLM API error 404/.test(errE || ''), '404 ⇒ surfaced immediately');
  assert.equal(fetches5, 1, '404 NOT retried');
  console.log('  ✅ K4 retry policy: 502/503/network retried once; 400/404 never');
}

// ── 6. Empty model config ⇒ clear error, no request sent ───────────
{
  let fetchCalls = 0;
  const c = loadClient({ llm_base_url: 'http://gw/v1', llm_api_key: 'k' }, async () => {
    fetchCalls++;
    return jsonResponse({});
  });
  assert.equal(c.DEFAULT_MODEL, '', 'DEFAULT_MODEL is empty (nothing pinned)');
  let err = null;
  try { await c.chat([{ role: 'user', content: 'x' }]); } catch (e) { err = e.message; }
  assert.equal(err, 'No model configured — open Settings and pick one from the fetched model list', 'clear actionable error string');
  assert.equal(fetchCalls, 0, 'no request is sent when no model is configured');
  console.log('  ✅ K4 empty model: actionable error, zero requests');
}

// ── 7. content.js wiring (grep-based) ──────────────────────────────
{
  const content = readFileSync(join(root, 'extension/content/content.js'), 'utf8');
  assert.ok(content.includes('deriveQuestionText'), 'content.js derives question text before prompting');
  assert.ok(content.includes('skipped (no question text)'), 'content.js reports no-question-text skips in the summary');
  assert.ok(content.includes('generateVerifiedAnswer'), 'content.js uses the guarded answer pipeline');
  assert.ok(!content.includes("|| 'qwen3.7-plus'"), 'content.js has no pinned model default');
  assert.ok(!content.includes("|| 'deepseek-v4-flash-2'"), 'content.js has no pinned model default (new id)');
  assert.ok(content.includes('resolveFieldValue'), 'content.js resolves values through resolveFieldValue');
  assert.ok(/name !== 'unknown'/.test(content), "'unknown' is not treated as a data key (K2)");
  const llmSrc = readFileSync(join(root, 'extension/lib/llm-client.js'), 'utf8');
  assert.ok(/maxTokens: 1600/.test(llmSrc), 'answer generation uses a 1600-token budget (reasoning models need room to finish before content)');
  console.log('  ✅ content.js + llm-client.js wiring present');
}

// ── 8. Learned-key guard (L1) + AI-write markers (L2) + migration ──
//
// The learning/migration functions are sliced out of the shipped content.js
// by name (top-level `function name(...) { … }`, closing brace at column 0) and
// executed in a vm sandbox, so the code under test IS the shipped code. Only
// the unrelated helpers (profile-owned keys, category merging) are stubbed.
{
  const contentSrc = readFileSync(join(root, 'extension/content/content.js'), 'utf8');

  function extractFn(src, name) {
    // keep the `async` keyword — indexOf('function name(' would slice it off
    const asyncStart = src.indexOf('async function ' + name + '(');
    const start = asyncStart !== -1 ? asyncStart : src.indexOf('function ' + name + '(');
    if (start === -1) throw new Error('content.js: function not found: ' + name);
    const end = src.indexOf('\n}\n', start);
    if (end === -1) throw new Error('content.js: unterminated function: ' + name);
    return src.slice(start, end + 2);
  }

  const inertConst = contentSrc.match(/const INERT_LEARNED_KEYS = \[[^\]]*\];/);
  assert.ok(inertConst, 'content.js declares INERT_LEARNED_KEYS');
  assert.deepEqual(
    JSON.parse(inertConst[0].replace('const INERT_LEARNED_KEYS = ', '').replace(/;$/, '').replace(/'/g, '"')),
    ['unknown', 'custom'],
    'the inert key set is exactly unknown + custom'
  );

  const learningFns = [
    extractFn(contentSrc, 'isLearnableFieldKey'),
    extractFn(contentSrc, 'markAIFill'),
    extractFn(contentSrc, 'attachGlobalLearning'),
    extractFn(contentSrc, 'saveLearnedCorrection'),
    extractFn(contentSrc, 'migrateInertLearnedKeysOnce'),
  ].join('\n');

  function loadLearning(storage, fields) {
    const store = Object.assign({}, storage);
    const events = { sets: [] };
    const ctx = vm.createContext({
      chrome: { storage: { sync: {
        get: async (keys) => {
          const out = {};
          for (const k of (Array.isArray(keys) ? keys : [keys])) if (k in store) out[k] = store[k];
          return out;
        },
        set: async (obj) => { events.sets.push(obj); Object.assign(store, obj); },
      } } },
      console,
      FormDetector: { detect: () => ({ personal: fields, questions: [], selects: [], unknown: [] }) },
      // Unrelated to the tested predicate: they only gate profile-owned keys
      // and category merging, neither of which the assertions depend on.
      shouldSkipDetectedField: () => false,
      getFieldCategory: (k) => k,
      isProfileOwnedKey: () => false,
    });
    const fns = vm.runInNewContext(
      inertConst[0] + '\nconst _learnedEls = new WeakSet();\n' + learningFns +
      '\n;({ isLearnableFieldKey, markAIFill, attachGlobalLearning, saveLearnedCorrection, migrateInertLearnedKeysOnce })',
      ctx
    );
    return { fns, store, events, ctx };
  }

  function makeLearnEl(props = {}) {
    const listeners = {};
    const el = {
      name: '', id: '', value: '', type: 'text', dataset: {},
      addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
      fire(t) { for (const fn of (listeners[t] || [])) fn(); },
    };
    return Object.assign(el, props);
  }

  const AI_ANSWER = 'I have five years of experience building dashboards. In my current role I shipped two internal tools used daily.';

  // saveLearnedCorrection is async and the blur handlers do not await it —
  // flush the microtask queue before asserting on the storage stub.
  const flush = () => new Promise(r => setTimeout(r, 0));

  // 8a. Predicate — exact contract
  {
    const { fns } = loadLearning({}, []);
    assert.equal(fns.isLearnableFieldKey('unknown', makeLearnEl({ name: LEVER_NAME })), false, "'unknown' is inert even when the element carries a DOM name");
    assert.equal(fns.isLearnableFieldKey('custom', makeLearnEl({ id: 'x' })), false, "'custom' is inert");
    assert.equal(fns.isLearnableFieldKey('', makeLearnEl({ name: 'location' })), false, 'empty key ⇒ not learnable');
    assert.equal(fns.isLearnableFieldKey('   ', makeLearnEl({ name: 'location' })), false, 'blank key ⇒ not learnable');
    assert.equal(fns.isLearnableFieldKey('location', makeLearnEl({})), false, 'element with no name and no id ⇒ not a real field identity');
    assert.equal(fns.isLearnableFieldKey('location', makeLearnEl({ name: 'location' })), true, 'real name ⇒ learnable');
    assert.equal(fns.isLearnableFieldKey('q1', makeLearnEl({ id: 'q1' })), true, 'real id ⇒ learnable');
    console.log('  ✅ L1 predicate: inert keys + identity-less elements are not learnable');
  }

  // 8b. AI-filled Lever textarea (identity 'unknown') ⇒ NO learned_fields write
  {
    const el = makeLearnEl({ name: LEVER_NAME, value: '6' });
    const field = { el, name: 'unknown', label: LEVER_NAME };
    const { fns, events } = loadLearning({}, [field]);
    fns.attachGlobalLearning();
    fns.markAIFill(el, AI_ANSWER);   // L2 markers, set before the fill's blur
    el.value = AI_ANSWER;            // fillField committed the answer
    el.fire('blur');                 // blur fired by fillField
    await flush();
    assert.equal(events.sets.filter(s => 'learned_fields' in s).length, 0, 'AI fill on an identity-less field ⇒ storage.set(learned_fields) never called');
    assert.equal(events.sets.some(s => s.learned_fields && 'unknown' in s.learned_fields), false, "nothing written under the inert key 'unknown'");

    el.value = '7';
    el.fire('blur');                 // later manual edit on the same field
    await flush();
    assert.equal(events.sets.some(s => s.learned_fields), false, 'manual edit on an identity-less field ⇒ still no learned_fields write');
    console.log('  ✅ L1/L2: AI-filled Lever field writes nothing to learned_fields');
  }

  // 8c. Regression: normally-identified field is learned exactly as before
  {
    const el = makeLearnEl({ name: 'location', value: '' });
    const field = { el, name: 'location', label: 'Current location' };
    const { fns, events } = loadLearning({}, [field]);
    fns.attachGlobalLearning();
    el.value = 'Gdansk';
    el.fire('blur');
    await flush();
    const writes = events.sets.filter(s => s.learned_fields);
    assert.equal(writes.length, 1, 'user edit on a field WITH a name ⇒ learned write happens (unchanged behaviour)');
    assert.deepEqual(writes[0].learned_fields, { location: 'Gdansk' }, 'value persisted under the real field name');
    console.log('  ✅ Regression: name/id fields still learn user corrections unchanged');
  }

  // 8d. AI write on a NAMED field ⇒ silent; a later real correction learns
  {
    const el = makeLearnEl({ name: 'why_supermove', value: '' });
    const field = { el, name: 'why_supermove', label: 'Why do you want to work here?' };
    const { fns, events } = loadLearning({}, [field]);
    fns.attachGlobalLearning();
    fns.markAIFill(el, AI_ANSWER);
    el.value = AI_ANSWER;
    el.fire('blur');
    await flush();
    assert.equal(events.sets.some(s => s.learned_fields), false, 'AI write ⇒ blur handler does not treat it as a user edit');
    assert.equal(el.dataset.jcFilled, 'true', 'jcFilled marker set by markAIFill');
    assert.equal(el.dataset.jcValue, AI_ANSWER, 'jcValue marker set by markAIFill');
    assert.equal(el.dataset.jcOriginal, AI_ANSWER, 'jcOriginal marker set by markAIFill (blur compares equal)');
    el.value = 'I want to work on moving. I have shipped logistics tooling.';
    el.fire('blur');
    await flush();
    const writes = events.sets.filter(s => s.learned_fields);
    assert.equal(writes.length, 1, 'genuine user correction after an AI fill is still learned (once)');
    assert.deepEqual(writes[0].learned_fields, { why_supermove: 'I want to work on moving. I have shipped logistics tooling.' }, 'correction persisted under the real field name');
    console.log('  ✅ L2: AI writes are not learned; later user corrections are');
  }

  // 8e. Migration: inert keys only, and only once
  {
    const polluted = { unknown: AI_ANSWER, custom: '6', location: 'Gdansk', email: 'me@example.com', why_supermove: 'Because.' };
    const { fns, events, store } = loadLearning({ learned_fields: Object.assign({}, polluted) }, []);
    await fns.migrateInertLearnedKeysOnce();
    const first = events.sets.filter(s => s.learned_fields);
    assert.equal(first.length, 1, 'migration rewrites learned_fields once');
    assert.deepEqual(Object.keys(first[0].learned_fields).sort(), ['email', 'location', 'why_supermove'], 'only unknown + custom removed; readable keys intact');
    assert.equal(store.jc_learned_migration_v2, true, 'one-shot flag jc_learned_migration_v2 persisted');
    const setsBefore = events.sets.length;
    await fns.migrateInertLearnedKeysOnce();
    assert.equal(events.sets.length, setsBefore, 'second invocation is a no-op (zero storage writes)');
    console.log('  ✅ Migration: removes unknown/custom only, runs once');
  }

  // 8f. Wiring: markers must be set BEFORE fillField blurs the element
  {
    assert.ok(contentSrc.includes('markAIFill(field && field.el, answer)'), 'fillAIQuestions marks the element before fillField');
    assert.ok(contentSrc.includes('markAIFill(field && field.el, result.answer)'), 'fillSingleField marks the element before fillField');
    assert.ok(/migrateInertLearnedKeysOnce\(\);/.test(contentSrc), 'migration v2 is wired into init()');
    console.log('  ✅ content.js wiring: pre-fill markers + migration v2 invoked');
  }
}

console.log('\n✅ All answer-pipeline tests passed\n');
