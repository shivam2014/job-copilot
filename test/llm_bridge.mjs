// ═══════════════════════════════════════════════════════════════
// llm_bridge.mjs — [FIX E] regression tests
// ═══════════════════════════════════════════════════════════════
// Loads the REAL modules (extension/background/background.js and
// extension/lib/llm-client.js) inside a vm sandbox with a chrome stub —
// no logic is re-implemented here.
//
// Covers:
//   - URL joining never yields "//" and always appends /chat/completions
//   - extras merge: explicit Content-Type wins, extras still sent
//   - timeout / network failure → {ok:false, error} carrying the reason
//   - HTTP error carries status + provider type (MissingSessionID)
//   - reasoning-only response still yields usable text
//   - empty-answer guard rejects "   "
//   - content-script path prefers chrome.runtime.sendMessage, falls back to fetch
//
// Run: node test/llm_bridge.mjs  (also invoked by test/run_all.mjs)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const BACKGROUND_SRC = fs.readFileSync(path.join(ROOT, 'extension/background/background.js'), 'utf8');
const LLM_CLIENT_SRC = fs.readFileSync(path.join(ROOT, 'extension/lib/llm-client.js'), 'utf8');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ✅ ' + name);
  } catch (err) {
    failed++;
    console.log('  ❌ ' + name + ': ' + err.message);
  }
}

// ── chrome stub (callback + promise styles, like MV3) ─────────────
function makeChrome(opts = {}) {
  const store = opts.store || {};
  const listeners = [];
  const chrome = {
    runtime: {
      id: 'llm-bridge-test',
      getURL: (p) => 'chrome-extension://test/' + p,
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: (fn) => listeners.push(fn) },
      openOptionsPage: () => {},
      reload: () => {},
    },
    storage: {
      sync: {
        get(keys, cb) {
          const out = {};
          if (Array.isArray(keys)) { for (const k of keys) if (k in store) out[k] = store[k]; }
          else if (typeof keys === 'string') { if (keys in store) out[keys] = store[keys]; }
          else Object.assign(out, store);
          if (typeof cb === 'function') { cb(out); return undefined; }
          return Promise.resolve(out);
        },
        set(obj, cb) {
          Object.assign(store, obj);
          if (typeof cb === 'function') cb();
          return Promise.resolve();
        },
      },
    },
  };
  if ('sendMessage' in opts) chrome.runtime.sendMessage = opts.sendMessage;
  return { chrome, listeners, store };
}

function loadBackground(opts) {
  const { chrome, listeners } = makeChrome(opts);
  const sandbox = { chrome, fetch: opts.fetch, console, setTimeout, clearTimeout, AbortController };
  vm.runInContext(BACKGROUND_SRC, vm.createContext(sandbox), { filename: 'background.js' });
  return listeners;
}

function loadLlmClient(opts) {
  const sandbox = { fetch: opts.fetch, console, setTimeout, clearTimeout };
  if (opts.chrome !== null) sandbox.chrome = makeChrome(opts).chrome;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(LLM_CLIENT_SRC, ctx, { filename: 'llm-client.js' });
  return vm.runInContext('LLMClient', ctx);
}

// Invoke the jc_llm_chat handler like chrome.runtime would: first listener
// that returns true owns the response (sendResponse called exactly once).
function callBridge(listeners, msg) {
  return new Promise((resolve) => {
    let settled = false;
    const send = (r) => { if (!settled) { settled = true; resolve(r); } };
    for (const listener of listeners) {
      let ret;
      try { ret = listener(msg, { id: 'test-frame' }, send); } catch (e) { ret = undefined; }
      if (ret !== true) continue; // listener declined this message
      return;                     // async handler will call send() later
    }
    resolve(undefined); // nobody claimed the message
  });
}

const jsonResponse = (obj, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(obj),
  json: async () => obj,
});

function captureFetch(responder) {
  const calls = [];
  const fn = async (url, opts) => { calls.push({ url, opts }); return responder(url, opts); };
  fn.calls = calls;
  return fn;
}

const slashPairs = (url) => url.split('//').length - 1;

const CHAT_MSG = () => ({
  type: 'jc_llm_chat',
  messages: [{ role: 'user', content: 'hello' }],
  temperature: 0.2,
  maxTokens: 42,
});

const OK_BODY = { choices: [{ message: { content: '  an answer  ' } }] };

// ── 1. URL joining ────────────────────────────────────────────────
await test('URL join: trailing-slash base never yields // and appends /chat/completions', async () => {
  const fetchStub = captureFetch(() => jsonResponse(OK_BODY));
  const listeners = loadBackground({ store: { llm_base_url: 'http://localhost:19530/v1/', llm_api_key: 'dummy', llm_model: 'test-model' }, fetch: fetchStub });
  const resp = await callBridge(listeners, CHAT_MSG());
  assert.equal(resp.ok, true);
  const url = fetchStub.calls[0].url;
  assert.equal(url, 'http://localhost:19530/v1/chat/completions');
  assert.equal(slashPairs(url), 1, 'exactly one // (the scheme): ' + url);
  assert.ok(url.endsWith('/chat/completions'));
});

await test('URL join: base without /v1 and without trailing slash still works', async () => {
  const fetchStub = captureFetch(() => jsonResponse(OK_BODY));
  const listeners = loadBackground({ store: { llm_base_url: 'http://localhost:19530', llm_model: 'test-model' }, fetch: fetchStub });
  await callBridge(listeners, CHAT_MSG());
  const url = fetchStub.calls[0].url;
  assert.equal(url, 'http://localhost:19530/chat/completions');
  assert.equal(slashPairs(url), 1);
});

// ── 2. Extras merge ───────────────────────────────────────────────
await test('extras merge: explicit Content-Type/Authorization win, extras still sent', async () => {
  const fetchStub = captureFetch(() => jsonResponse(OK_BODY));
  const listeners = loadBackground({
    store: {
      llm_base_url: 'http://localhost:19530/v1',
      llm_api_key: 'dummy',
      llm_model: 'test-model',
      llm_extra_headers: '{"x-opencode-session":"pi-local","Content-Type":"text/plain","Authorization":"Bearer extra"}',
    },
    fetch: fetchStub,
  });
  const resp = await callBridge(listeners, CHAT_MSG());
  assert.equal(resp.ok, true);
  const headers = fetchStub.calls[0].opts.headers;
  assert.equal(headers['x-opencode-session'], 'pi-local');
  assert.equal(headers['Content-Type'], 'application/json', 'explicit Content-Type must win');
  assert.equal(headers['Authorization'], 'Bearer dummy', 'explicit Authorization must win');
  const body = JSON.parse(fetchStub.calls[0].opts.body);
  assert.equal(body.model, 'test-model', '[FIX K4] model comes from storage — no pinned default');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'hello' }]);
  assert.equal(body.temperature, 0.2);
  assert.equal(body.max_tokens, 42);
});

// ── 3. Failure paths ──────────────────────────────────────────────
await test('timeout: aborted request maps to {ok:false, error} with the reason', async () => {
  const hungFetch = (url, opts) => new Promise((_, reject) => {
    if (opts.signal) opts.signal.addEventListener('abort', () => {
      const e = new Error('The operation was aborted');
      e.name = 'AbortError';
      reject(e);
    });
  });
  const listeners = loadBackground({
    store: { llm_base_url: 'http://localhost:19530/v1', llm_model: 'test-model', llm_timeout_ms: 30 },
    fetch: hungFetch,
  });
  const resp = await callBridge(listeners, CHAT_MSG());
  assert.equal(resp.ok, false);
  assert.match(resp.error, /timed out after 30ms/);
});

await test('network failure: {ok:false, error} carries "Failed to fetch"', async () => {
  const listeners = loadBackground({
    store: { llm_base_url: 'http://localhost:19530/v1', llm_model: 'test-model' },
    fetch: async () => { throw new Error('Failed to fetch'); },
  });
  const resp = await callBridge(listeners, CHAT_MSG());
  assert.equal(resp.ok, false);
  assert.match(resp.error, /Failed to fetch/);
});

await test('HTTP 400: error includes status + provider type (MissingSessionID)', async () => {
  const listeners = loadBackground({
    store: { llm_base_url: 'http://localhost:19530/v1', llm_model: 'test-model' },
    fetch: async () => ({ ok: false, status: 400, text: async () => '{"error":{"type":"MissingSessionID","message":"no session header"}}' }),
  });
  const resp = await callBridge(listeners, CHAT_MSG());
  assert.equal(resp.ok, false);
  assert.match(resp.error, /400/);
  assert.match(resp.error, /MissingSessionID/);
});

// ── 4. Reasoning-only responses ───────────────────────────────────
await test('reasoning-only response yields usable text end to end', async () => {
  const listeners = loadBackground({
    store: { llm_base_url: 'http://localhost:19530/v1', llm_model: 'test-model' },
    fetch: async () => jsonResponse({ choices: [{ message: { content: '', reasoning_content: 'reasoned answer' } }] }),
  });
  const swResp = await callBridge(listeners, CHAT_MSG());
  assert.equal(swResp.ok, true);
  assert.equal(swResp.content, '');
  assert.equal(swResp.reasoningContent, 'reasoned answer');

  // llm-client turns that bridge payload into usable text.
  const client = loadLlmClient({
    sendMessage: async () => swResp,
    store: { llm_model: 'test-model' },
    fetch: async () => { throw new Error('fetch must not be used in content-script context'); },
  });
  assert.equal(await client.chat([{ role: 'user', content: 'q' }]), 'reasoned answer');
});

await test('truly empty LLM response → {ok:false, error: "empty response"}', async () => {
  const listeners = loadBackground({
    store: { llm_base_url: 'http://localhost:19530/v1', llm_model: 'test-model' },
    fetch: async () => jsonResponse({ choices: [{ message: { content: '   ' } }] }),
  });
  const resp = await callBridge(listeners, CHAT_MSG());
  assert.equal(resp.ok, false);
  assert.match(resp.error, /empty response/i);
});

// ── 5. Empty-answer guard ─────────────────────────────────────────
await test('empty-answer guard still rejects whitespace-only answers', async () => {
  const client = loadLlmClient({ sendMessage: async () => ({ ok: true, content: 'x' }), store: { llm_model: 'test-model' } });
  assert.equal(client.isBlankAnswer('   '), true);
  assert.equal(client.isBlankAnswer(''), true);
  assert.equal(client.isBlankAnswer(undefined), true);
  assert.equal(client.isBlankAnswer('answer'), false);

  // Whitespace bridge response must throw, never reach a form field.
  const blankClient = loadLlmClient({ sendMessage: async () => ({ ok: true, content: '   ' }), store: { llm_model: 'test-model' } });
  await assert.rejects(() => blankClient.chat([{ role: 'user', content: 'q' }]), /empty response/i);
});

// ── 6. Bridge preference / fallback ───────────────────────────────
await test('content-script path prefers chrome.runtime.sendMessage (fetch untouched)', async () => {
  let fetchCalls = 0;
  const client = loadLlmClient({
    sendMessage: async (msg) => {
      assert.equal(msg.type, 'jc_llm_chat');
      return { ok: true, content: 'from-service-worker' };
    },
    store: { llm_model: 'test-model' },
    fetch: async () => { fetchCalls++; throw new Error('unexpected'); },
  });
  assert.equal(await client.chat([{ role: 'user', content: 'q' }]), 'from-service-worker');
  assert.equal(fetchCalls, 0);
});

await test('no chrome.runtime.sendMessage → direct fetch fallback with joined URL', async () => {
  const fetchStub = captureFetch(() => jsonResponse(OK_BODY));
  // chrome present (storage works) but no runtime.sendMessage — unit test /
  // options-page style context: the direct fetch is the only path.
  const client = loadLlmClient({
    fetch: fetchStub,
    store: { llm_base_url: 'http://localhost:19530/v1/', llm_api_key: 'dummy', llm_model: 'deepseek-v4-flash-2' },
  });
  assert.equal(typeof client.serviceWorkerBridgeAvailable(), 'boolean');
  assert.equal(client.serviceWorkerBridgeAvailable(), false);
  assert.equal(await client.chat([{ role: 'user', content: 'q' }]), 'an answer');
  assert.equal(fetchStub.calls.length, 1);
  assert.equal(fetchStub.calls[0].url, 'http://localhost:19530/v1/chat/completions');
  assert.equal(slashPairs(fetchStub.calls[0].url), 1);
});

await test('bridge channel failure falls back to direct fetch', async () => {
  const fetchStub = captureFetch(() => jsonResponse(OK_BODY));
  const client = loadLlmClient({
    sendMessage: async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); },
    store: { llm_base_url: 'http://localhost:19530/v1', llm_model: 'test-model' },
    fetch: fetchStub,
  });
  assert.equal(await client.chat([{ role: 'user', content: 'q' }]), 'an answer');
  assert.equal(fetchStub.calls.length, 1);
});

await test('bridge error propagates as a normal LLM error (no crash)', async () => {
  const client = loadLlmClient({
    sendMessage: async () => ({ ok: false, error: 'LLM API error 401: invalid_api_key' }),
    store: { llm_model: 'test-model' },
  });
  await assert.rejects(
    () => client.chat([{ role: 'user', content: 'q' }]),
    /LLM API error 401: invalid_api_key/,
  );
});

// ── 7. [FIX K4] No model configured ─────────────────────────────
await test('bridge: no model configured ⇒ actionable error, no request sent', async () => {
  const fetchStub = captureFetch(() => jsonResponse(OK_BODY));
  const listeners = loadBackground({ store: { llm_base_url: 'http://localhost:19530/v1' }, fetch: fetchStub });
  const resp = await callBridge(listeners, CHAT_MSG());
  assert.equal(resp.ok, false);
  assert.match(resp.error, /No model configured — open Settings and pick one from the fetched model list/);
  assert.equal(fetchStub.calls.length, 0, 'no request is sent to the gateway without a model');
});

await test('client: no model configured ⇒ throws actionable error, fetch untouched', async () => {
  let fetchCalls = 0;
  const client = loadLlmClient({
    fetch: async () => { fetchCalls++; return jsonResponse(OK_BODY); },
    store: { llm_base_url: 'http://localhost:19530/v1' },
  });
  await assert.rejects(
    () => client.chat([{ role: 'user', content: 'q' }]),
    /No model configured — open Settings and pick one from the fetched model list/,
  );
  assert.equal(fetchCalls, 0);
});

console.log('llm_bridge: ' + passed + ' passed, ' + failed + ' failed ' + (failed === 0 ? '🎉' : ''));
// exitCode (not process.exit) — process.exit can truncate piped stdout.
process.exitCode = failed > 0 ? 1 : 0;
