#!/usr/bin/env node
/**
 * Advanced CDP — Circuit Breaker Edition
 *
 * Creates a fresh Oracle tab with console suppression to avoid the bridge
 * crash caused by Oracle's SPA console flood.
 *
 * Usage: node scripts/cdp_adv.mjs <command>
 *
 * Commands:
 *   fresh-email       Create fresh Oracle tab → email page
 *   fill-email        Fill email on current page
 *   click-next        Click the NEXT button
 *   status            Check page state
 *
 * Circuit Breaker: shares state via /tmp/jc-cdp-circuit.json with cdp.mjs.
 * See GUIDE.md → "Circuit Breaker Architecture" for design rationale.
 */
import * as http from 'node:http';
import * as fs from 'node:fs';

// ─── Config ─────────────────────────────────────────────────────────────────
const BRIDGE_HTTP = 'http://127.0.0.1:9222';
const BRIDGE_WS   = 'ws://127.0.0.1:9222/devtools/browser';
const CIRCUIT_FILE = '/tmp/jc-cdp-circuit.json';
const TIMEOUT_MS = 8000;
const COOLDOWN_MS = 15000;
const FAIL_THRESHOLD = 2;

// ─── Circuit Breaker ────────────────────────────────────────────────────────
const STATE = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

function loadCircuitState() {
  try {
    if (fs.existsSync(CIRCUIT_FILE)) {
      return JSON.parse(fs.readFileSync(CIRCUIT_FILE, 'utf-8'));
    }
  } catch (_) {}
  return { state: STATE.CLOSED, failCount: 0, lastFailure: 0, lastError: '' };
}

function saveCircuitState(s) {
  try { fs.writeFileSync(CIRCUIT_FILE, JSON.stringify(s, null, 2), 'utf-8'); } catch (_) {}
}

function checkCircuit() {
  const cb = loadCircuitState();
  const now = Date.now();
  if (cb.state === STATE.OPEN && now - cb.lastFailure >= COOLDOWN_MS) {
    cb.state = STATE.HALF_OPEN;
    console.error(`[cb] Circuit → HALF_OPEN`);
    saveCircuitState(cb);
    return { ok: true, cb };
  }
  return cb.state === STATE.OPEN ? { ok: false, cb } : { ok: true, cb };
}

function recordFailure(cb, msg) {
  cb.failCount++;
  cb.lastFailure = Date.now();
  cb.lastError = (msg || '').substring(0, 200);
  if (cb.failCount >= FAIL_THRESHOLD) { cb.state = STATE.OPEN; console.error(`[cb] Circuit → OPEN`); }
  saveCircuitState(cb);
}

function recordSuccess(cb) {
  cb.state = STATE.CLOSED; cb.failCount = 0; cb.lastFailure = 0; cb.lastError = '';
  saveCircuitState(cb);
}

// ─── Pre-flight Ping ────────────────────────────────────────────────────────
function pingBridge() {
  return new Promise((resolve) => {
    const req = http.get(`${BRIDGE_HTTP}/json/version`, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ ok: true, version: JSON.parse(data).Browser || 'unknown' }); }
        catch (_) { resolve({ ok: false, error: 'bad JSON' }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

// ─── WebSocket ──────────────────────────────────────────────────────────────
let msgId = 0, sessionId = null, ws;
const pending = new Map();

function send(method, params = {}, sId = null) {
  const id = ++msgId;
  const msg = { id, method, params };
  if (sId) msg.sessionId = sId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else { clearTimeout(timer); pending.delete(id); reject(new Error('WS not connected')); }
  });
}

function parseData(raw) {
  return typeof raw === 'string' ? raw
    : raw instanceof Buffer ? raw.toString('utf8')
    : raw instanceof ArrayBuffer ? Buffer.from(raw).toString('utf8')
    : Buffer.from(raw).toString('utf8');
}

async function connect() {
  ws = new WebSocket(BRIDGE_WS);
  ws.binaryType = 'arraybuffer';
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS connect timeout')), 5000);
    ws.onopen = () => { clearTimeout(t); resolve(); };
    ws.onerror = () => { clearTimeout(t); reject(new Error('WS error')); };
  });
  ws.onmessage = (event) => {
    const data = parseData(event.data);
    try {
      const msg = JSON.parse(data);
      const p = pending.get(msg.id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.error.message} (code:${msg.error.code})`));
        else p.resolve(msg.result);
      }
    } catch (_) {}
  };
}

// ─── Page Commands ──────────────────────────────────────────────────────────
async function freshOracleTab() {
  const target = await send('Target.createTarget', { url: 'about:blank' });
  const tid = target.targetId;
  console.error(`Tab created: ${tid}`);

  const attach = await send('Target.attachToTarget', { targetId: tid, flatten: true });
  sessionId = attach.sessionId;
  console.error(`Session: ${sessionId}`);

  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  console.error('Domains enabled');

  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'console.log=console.warn=console.error=console.info=console.debug=function(){};'
  }, sessionId);
  console.error('Console suppressed');

  await send('Page.navigate', {
    url: 'https://icfcjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Aerospace/job/111402/apply/email'
  }, sessionId);
  console.error('Navigated, waiting 15s...');
  await new Promise(r => setTimeout(r, 15000));
  console.error('Page loaded');
  return { targetId: tid, sessionId };
}

async function evalInPage(expr) {
  const r = await send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true
  }, sessionId);
  if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails) };
  return { value: r.result?.value };
}

// ─── Main ───────────────────────────────────────────────────────────────────
const cmd = process.argv[2];

async function main() {
  // Circuit check
  const { ok: circuitOk, cb } = checkCircuit();
  if (!circuitOk) {
    console.log(JSON.stringify({ status: 'error', error: 'Circuit is OPEN', circuit_state: cb }));
    process.exit(5);
  }

  // Pre-flight
  const ping = await pingBridge();
  if (!ping.ok) {
    recordFailure(cb, `Bridge ping failed: ${ping.error}`);
    console.log(JSON.stringify({ status: 'error', error_type: 'bridge_down', error: ping.error }));
    process.exit(2);
  }

  // Connect
  try { await connect(); }
  catch (err) {
    recordFailure(cb, `WS connect: ${err.message}`);
    console.log(JSON.stringify({ status: 'error', error_type: 'bridge_down', error: err.message }));
    process.exit(2);
  }

  try {
    if (cmd === 'fresh-email') {
      const { targetId } = await freshOracleTab();
      console.log(JSON.stringify({ status: 'ok', targetId, sessionId }));
      recordSuccess(cb);
    } else if (cmd === 'fill-email') {
      const email = process.argv[3] || 'shivam.bhalla07@gmail.com';
      const r1 = await evalInPage(
        `document.getElementById('primary-email-0')?.value='${email}';` +
        `document.getElementById('primary-email-0')?.dispatchEvent(new Event('input',{bubbles:true}));` +
        `'email set to ${email}'`
      );
      if (r1.error) { console.log(JSON.stringify({ status: 'error', error: r1.error })); recordFailure(cb, r1.error); process.exit(1); }
      console.log(r1.value);

      const r2 = await evalInPage(
        `var cb=document.getElementById('legal-disclaimer-checkbox');` +
        `if(cb){cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));return'checkbox checked';}return'no checkbox';`
      );
      console.log(r2.value || r2.error || '');
      recordSuccess(cb);
    } else if (cmd === 'click-next') {
      const r = await evalInPage(
        `var b=document.querySelectorAll('button');` +
        `for(var i=0;i<b.length;i++){if(b[i].innerText.trim()==='NEXT'){b[i].click();return'clicked NEXT via JS';}}` +
        `return'NEXT not found';`
      );
      console.log(r.value || r.error || '');
      await new Promise(r => setTimeout(r, 8000));
      const url = await evalInPage('window.location.href');
      console.log('URL after click:', url.value);
      recordSuccess(cb);
    } else if (cmd === 'status') {
      const r = await evalInPage(
        'document.title + " | " + window.location.href + " | inputs: " + document.querySelectorAll("input:not([type=hidden])").length'
      );
      console.log(r.value || r.error || '');
      recordSuccess(cb);
    } else {
      console.log('Commands: fresh-email, fill-email, click-next, status');
    }
  } catch (err) {
    recordFailure(cb, err.message);
    console.log(JSON.stringify({ status: 'error', error: err.message, circuit_state: loadCircuitState() }));
    process.exit(err.message.startsWith('Timeout:') ? 3 : 1);
  } finally {
    if (ws) ws.close();
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
