// Test: LLM config — extra-headers parsing, header merge precedence,
// default model, empty-answer guard.
// Run: node test/llm_config.mjs

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

console.log('\n🔬 LLM Config Tests\n');

// Load extension/lib/llm-client.js the same way the extension does: as a plain
// script (no modules). A sandbox provides the chrome.storage + fetch shims.
const llmClientSrc = readFileSync(join(root, 'extension/lib/llm-client.js'), 'utf8');

function loadClient(storage, fetchImpl) {
  const ctx = vm.createContext({
    chrome: { storage: { sync: { get: async (keys) => {
      const out = {};
      for (const k of keys) if (k in storage) out[k] = storage[k];
      return out;
    } } } },
    fetch: fetchImpl || (async () => jsonResponse({})),
    console,
  });
  return vm.runInNewContext(llmClientSrc + '\n;LLMClient', ctx);
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

// ── 1. parseExtraHeaders — defensive JSON parsing ──────────────────
const c = loadClient({});
assert.deepEqual(c.parseExtraHeaders('{"x-opencode-session":"pi-local"}'), { 'x-opencode-session': 'pi-local' }, 'valid JSON object parsed');
assert.deepEqual(c.parseExtraHeaders(''), {}, 'empty string → {}');
assert.deepEqual(c.parseExtraHeaders('   '), {}, 'whitespace string → {}');
assert.deepEqual(c.parseExtraHeaders(undefined), {}, 'undefined → {}');
assert.deepEqual(c.parseExtraHeaders('{not json'), {}, 'invalid JSON ignored (no throw)');
assert.deepEqual(c.parseExtraHeaders('[1,2]'), {}, 'array ("[1,2]") non-object → {}');
assert.deepEqual(c.parseExtraHeaders('"hello"'), {}, 'string non-object → {}');
assert.deepEqual(c.parseExtraHeaders('null'), {}, 'null → {}');
assert.deepEqual(
  c.parseExtraHeaders('{"n":42,"b":true,"obj":{"x":1},"":"empty"}'),
  { n: '42', b: 'true' },
  'scalars stringified; non-scalars and empty keys dropped'
);
console.log('  ✅ Extra-headers parsing is defensive');

// ── 2. getConfig defaults + storage reads ──────────────────────────
const cfg = await loadClient({}).getConfig();
assert.equal(cfg.model, '', 'no model is pinned by default (empty ⇒ actionable Settings error)');
assert.equal(cfg.baseUrl, 'http://localhost:19530/v1', 'default base URL unchanged');
assert.deepEqual(cfg.extraHeaders, {}, 'no llm_extra_headers stored → {}');

const cfg2 = await loadClient({ llm_extra_headers: '{"x-opencode-session":"pi-local"}' }).getConfig();
assert.deepEqual(cfg2.extraHeaders, { 'x-opencode-session': 'pi-local' }, 'getConfig parses stored llm_extra_headers');
console.log('  ✅ Default model + extra-headers config');

// ── 3. Header merge precedence on the request path ─────────────────
let captured = null;
const c2 = loadClient({
  llm_base_url: 'http://localhost:19530/v1',
  llm_api_key: 'dummy',
  llm_model: 'qwen3.7-plus',
  llm_extra_headers: '{"Content-Type":"text/plain","Authorization":"Bearer bogus","x-opencode-session":"pi-local"}',
}, async (url, opts) => { captured = { url, opts }; return jsonResponse({ choices: [{ message: { content: 'ok' } }] }); });

const text = await c2.chat([{ role: 'user', content: 'hi' }]);
assert.equal(text, 'ok', 'chat() returns the response text');
assert.equal(captured.url, 'http://localhost:19530/v1/chat/completions', 'request hits /chat/completions');
assert.equal(captured.opts.headers['Content-Type'], 'application/json', 'explicit Content-Type wins over extra header');
assert.equal(captured.opts.headers['Authorization'], 'Bearer dummy', 'explicit Authorization wins over extra header');
assert.equal(captured.opts.headers['x-opencode-session'], 'pi-local', 'extra header sent on the request');
assert.deepEqual(
  Object.keys(captured.opts.headers).sort(),
  ['Authorization', 'Content-Type', 'x-opencode-session'],
  'exactly the merged header set is sent'
);

// Invalid extras must never break the request path
let captured2 = null;
const c3 = loadClient({ llm_model: 'test-model', llm_extra_headers: '[1,2]' }, async (url, opts) => {
  captured2 = opts;
  return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
});
const t3 = await c3.chat([{ role: 'user', content: 'x' }]);
assert.equal(t3, 'ok', 'invalid extras → request still succeeds');
assert.equal(captured2.headers['Content-Type'], 'application/json', 'invalid extras → Content-Type intact');
console.log('  ✅ Header merge precedence verified');

// ── 4. Empty-answer guard ──────────────────────────────────────────
assert.equal(c.isBlankAnswer(''), true, 'empty string is blank');
assert.equal(c.isBlankAnswer('   \n\t '), true, 'whitespace-only is blank');
assert.equal(c.isBlankAnswer(undefined), true, 'undefined is blank');
assert.equal(c.isBlankAnswer('ok'), false, 'real answer is not blank');

const c4 = loadClient({ llm_model: 'test-model' }, async () => jsonResponse({ choices: [{ message: { content: '   ', reasoning_content: '' } }] }));
let rejected = false;
try { await c4.chat([{ role: 'user', content: 'x' }]); } catch (e) { rejected = /empty response/.test(e.message); }
assert.ok(rejected, 'whitespace-only LLM response rejected by chat()');
console.log('  ✅ Empty-answer guard verified');

// ── 5. Defaults live where they are declared (grep-based) ──────────
const files = {
  'extension/lib/llm-client.js': readFileSync(join(root, 'extension/lib/llm-client.js'), 'utf8'),
  'extension/background/background.js': readFileSync(join(root, 'extension/background/background.js'), 'utf8'),
  'extension/options/options.js': readFileSync(join(root, 'extension/options/options.js'), 'utf8'),
  'extension/options/options.html': readFileSync(join(root, 'extension/options/options.html'), 'utf8'),
  'extension/content/content.js': readFileSync(join(root, 'extension/content/content.js'), 'utf8'),
  'README.md': readFileSync(join(root, 'README.md'), 'utf8'),
};

// [FIX K4] No model id is pinned as a default anywhere. The gateway answers
// unknown ids with HTTP 404 "no route for model"; with no model configured the
// client must fail with the actionable Settings error instead.
for (const f of ['extension/lib/llm-client.js', 'extension/background/background.js', 'extension/options/options.js', 'extension/content/content.js']) {
  assert.ok(!files[f].includes("'qwen3.7-plus'"), f + ' must not pin qwen3.7-plus');
  assert.ok(!files[f].includes("'deepseek-v4-flash-2'"), f + ' must not pin a model id as default');
}
assert.ok(/DEFAULT_MODEL:\s*''/.test(files['extension/lib/llm-client.js']), 'DEFAULT_MODEL is empty (nothing pinned)');
const NO_MODEL_ERROR = 'No model configured — open Settings and pick one from the fetched model list';
assert.ok(files['extension/lib/llm-client.js'].includes(NO_MODEL_ERROR), 'llm-client.js throws the actionable no-model error');
assert.ok(files['extension/background/background.js'].includes(NO_MODEL_ERROR), 'llm bridge reports the actionable no-model error');
assert.ok(files['extension/background/background.js'].includes('llm_extra_headers'), 'installer defaults include llm_extra_headers');
assert.ok(files['extension/background/background.js'].includes('x-opencode-session'), 'installer default header is x-opencode-session');
assert.ok(files['extension/options/options.js'].includes('llm_extra_headers'), 'options page loads/saves llm_extra_headers');
assert.ok(files['extension/options/options.html'].includes('id="llm_extra_headers"'), 'options page has an extra-headers input');
assert.ok(files['extension/content/content.js'].includes('llm_extra_headers'), 'content script reads llm_extra_headers');
assert.ok(files['extension/content/content.js'].includes('generateVerifiedAnswer'), 'content script uses the guarded answer pipeline (meta-answer retry + skip)');
assert.ok(files['extension/content/content.js'].includes('skipped (no question text)'), 'content script reports no-question-text skips');
assert.ok(files['extension/content/content.js'].includes('AI answers: no LLM configured — open Settings'), 'content script surfaces missing LLM config in the panel');
assert.ok(files['extension/content/content.js'].includes('failed ('), 'content script summary includes failure count + reason');
assert.ok(files['README.md'].includes('${base_url}/models'), 'README documents the /models model list');
console.log('  ✅ Defaults and user-visible messages present in source');

console.log('\n✅ All LLM config tests passed\n');
