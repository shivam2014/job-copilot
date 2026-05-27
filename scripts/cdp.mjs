#!/usr/bin/env node
/**
 * CDP Connector — Circuit Breaker Edition
 *
 * Usage: node scripts/cdp.mjs eval <expr>
 *        node scripts/cdp.mjs nav <url>
 *        node scripts/cdp.mjs list
 *        node scripts/cdp.mjs click <x>,<y>
 *        node scripts/cdp.mjs status          ← health check + circuit state
 *
 * Exit codes: 0=success, 2=bridge_down, 3=timeout, 4=no_oracle_page, 5=circuit_open
 *
 * Circuit Breaker pattern: three states (CLOSED → OPEN → HALF-OPEN) prevent
 * silent hangs when the CDP bridge is down. State is persisted in
 * /tmp/jc-cdp-circuit.json so it survives between CLI invocations.
 * See GUIDE.md → "Circuit Breaker Architecture" for design rationale.
 */
import * as http from 'node:http';
import * as fs from 'node:fs';

// ─── Config ─────────────────────────────────────────────────────────────────
const BRIDGE_HTTP = 'http://127.0.0.1:9222';
const BRIDGE_WS   = 'ws://127.0.0.1:9222/devtools/browser';
const CIRCUIT_FILE = '/tmp/jc-cdp-circuit.json';
const TIMEOUT_MS = 8000;       // hard per-command timeout
const COOLDOWN_MS = 15000;     // how long circuit stays OPEN before HALF-OPEN
const FAIL_THRESHOLD = 2;      // consecutive failures → OPEN

// ─── Circuit Breaker ────────────────────────────────────────────────────────
const STATE = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

function loadCircuitState() {
  try {
    if (fs.existsSync(CIRCUIT_FILE)) {
      const raw = fs.readFileSync(CIRCUIT_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (_) { /* corrupted file → start fresh */ }
  return { state: STATE.CLOSED, failCount: 0, lastFailure: 0, lastError: '' };
}

function saveCircuitState(s) {
  try {
    fs.writeFileSync(CIRCUIT_FILE, JSON.stringify(s, null, 2), 'utf-8');
  } catch (_) { /* best-effort */ }
}

function checkCircuit() {
  const cb = loadCircuitState();
  const now = Date.now();

  if (cb.state === STATE.OPEN) {
    if (now - cb.lastFailure >= COOLDOWN_MS) {
      cb.state = STATE.HALF_OPEN;
      console.error(`[cb] Circuit → HALF_OPEN (cooldown expired)`);
      saveCircuitState(cb);
      return { ok: true, cb };
    }
    return { ok: false, cb };
  }

  // HALF_OPEN: allow one test request
  if (cb.state === STATE.HALF_OPEN) {
    return { ok: true, cb };
  }

  return { ok: true, cb };
}

function recordFailure(cb, errorMsg) {
  cb.failCount++;
  cb.lastFailure = Date.now();
  cb.lastError = errorMsg.substring(0, 200);
  if (cb.failCount >= FAIL_THRESHOLD) {
    cb.state = STATE.OPEN;
    console.error(`[cb] Circuit → OPEN (${cb.failCount} failures)`);
  }
  saveCircuitState(cb);
  return cb;
}

function recordSuccess(cb) {
  cb.state = STATE.CLOSED;
  cb.failCount = 0;
  cb.lastFailure = 0;
  cb.lastError = '';
  saveCircuitState(cb);
  return cb;
}

// ─── Pre-flight Ping ────────────────────────────────────────────────────────
function pingBridge() {
  return new Promise((resolve) => {
    const req = http.get(`${BRIDGE_HTTP}/json/version`, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ ok: true, version: parsed.Browser || 'unknown' });
        } catch (_) {
          resolve({ ok: false, error: 'bad JSON response' });
        }
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

// ─── WebSocket Helpers ──────────────────────────────────────────────────────
let msgId = 0;
const pending = new Map();
let ws;
let wsConnected = false;

function wsSend(method, params = {}, sId = null) {
  const id = ++msgId;
  const msg = { id, method, params };
  if (sId) msg.sessionId = sId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout: ${method}`));
    }, TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    } else {
      clearTimeout(timer);
      pending.delete(id);
      reject(new Error('WebSocket not connected'));
    }
  });
}

function parseData(raw) {
  return typeof raw === 'string' ? raw
    : raw instanceof Buffer ? raw.toString('utf8')
    : raw instanceof ArrayBuffer ? Buffer.from(raw).toString('utf8')
    : Buffer.from(raw).toString('utf8');
}

async function wsConnect() {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) { resolve(); return; }
    ws = new WebSocket(BRIDGE_WS);
    ws.binaryType = 'arraybuffer';
    const t = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket connect timeout'));
    }, 5000);

    ws.onopen = () => { clearTimeout(t); wsConnected = true; resolve(); };
    ws.onerror = () => { clearTimeout(t); wsConnected = false; reject(new Error('WebSocket error')); };
    ws.onclose = () => { wsConnected = false; };
    ws.onmessage = (event) => {
      const data = parseData(event.data);
      try {
        const parsed = JSON.parse(data);
        const p = pending.get(parsed.id);
        if (p) {
          clearTimeout(p.timer);
          pending.delete(parsed.id);
          if (parsed.error) p.reject(new Error(`${parsed.error.message} (code:${parsed.error.code})`));
          else p.resolve(parsed.result);
        }
      } catch (_) { /* non-JSON (e.g. screenshot chunks) — ignore */ }
    };
  });
}

// ─── Oracle Session ─────────────────────────────────────────────────────────
async function getOracleSession() {
  await wsSend('Target.setDiscoverTargets', { discover: true });
  const targets = await wsSend('Target.getTargets');
  const oracle = targets.targetInfos.find(t =>
    t.type === 'page' && t.url && t.url.includes('oracle')
  );
  if (!oracle) return null;
  const attach = await wsSend('Target.attachToTarget', { targetId: oracle.targetId, flatten: true });
  return { sessionId: attach.sessionId, targetInfo: oracle };
}

// ─── Structured Result ──────────────────────────────────────────────────────
function result(status, extra = {}) {
  return JSON.stringify({ status, ...extra });
}

// ─── Main ───────────────────────────────────────────────────────────────────
const CMD = process.argv[2] || 'list';
const ARG = process.argv.slice(3).join(' ');

async function main() {
  // 1. Check circuit breaker
  const { ok: circuitOk, cb } = checkCircuit();
  if (!circuitOk) {
    const remaining = Math.max(0, Math.ceil((COOLDOWN_MS - (Date.now() - cb.lastFailure)) / 1000));
    console.log(result('error', {
      error: 'Circuit is OPEN',
      error_type: 'circuit_open',
      retryable: true,
      next_action: `Wait ${remaining}s for cooldown or restart the bridge`,
      circuit_state: cb,
    }));
    process.exit(5);
  }

  // 2. Pre-flight ping
  const ping = await pingBridge();
  if (!ping.ok) {
    recordFailure(cb, `Bridge ping failed: ${ping.error}`);
    console.log(result('error', {
      error: `Bridge unreachable: ${ping.error}`,
      error_type: 'bridge_down',
      retryable: true,
      next_action: 'Start the bridge process or relaunch Chrome with --remote-debugging-pipe',
      circuit_state: loadCircuitState(),
    }));
    process.exit(2);
  }

  // 3. Connect WebSocket
  try {
    await wsConnect();
  } catch (err) {
    recordFailure(cb, `WS connect failed: ${err.message}`);
    console.log(result('error', {
      error: `WebSocket connect failed: ${err.message}`,
      error_type: 'bridge_down',
      retryable: true,
      next_action: 'Check if bridge is running on port 9222',
      circuit_state: loadCircuitState(),
    }));
    process.exit(2);
  }

  try {
    if (CMD === 'list') {
      await wsSend('Target.setDiscoverTargets', { discover: true });
      const targets = await wsSend('Target.getTargets');
      console.log(result('ok', { value: targets.targetInfos }));
      recordSuccess(cb);
    } else if (CMD === 'status') {
      const targets = await wsSend('Target.getTargets');
      const oracleTarget = targets.targetInfos.find(t =>
        t.type === 'page' && t.url && t.url.includes('oracle')
      );
      console.log(result('ok', {
        page: oracleTarget ? { id: oracleTarget.targetId, url: oracleTarget.url, title: oracleTarget.title } : null,
        all_targets: targets.targetInfos.map(t => ({ id: t.targetId, type: t.type, url: (t.url || '').substring(0, 120), title: t.title })),
        circuit_state: loadCircuitState(),
      }));
      recordSuccess(cb);
    } else {
      // Commands that need an Oracle session
      const session = await getOracleSession();
      if (!session) {
        recordFailure(cb, 'No Oracle page found');
        console.log(result('error', {
          error: 'No Oracle page found. Navigate to an Oracle job page first.',
          error_type: 'no_oracle_page',
          retryable: true,
          next_action: 'Open the job URL in Chrome or use `node scripts/cdp.mjs nav <url>`',
          circuit_state: loadCircuitState(),
        }));
        process.exit(4);
      }
      const { sessionId } = session;
      recordSuccess(cb);

      if (CMD === 'eval') {
        const r = await wsSend('Runtime.evaluate',
          { expression: ARG || 'document.title', returnByValue: true, awaitPromise: true },
          sessionId
        );
        if (r.exceptionDetails) {
          console.log(result('error', {
            error: r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails),
            error_type: 'js_eval_error',
            retryable: false,
          }));
        } else {
          console.log(result('ok', { value: r.result?.value ?? r.result }));
        }
      } else if (CMD === 'nav') {
        const url = ARG;
        await wsSend('Page.enable', {}, sessionId);
        const navResult = await wsSend('Page.navigate', { url }, sessionId);
        console.log(result('ok', { value: navResult }));
      } else if (CMD === 'click') {
        const [x, y] = ARG.split(',').map(Number);
        await wsSend('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
        await wsSend('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
        console.log(result('ok', { value: `Clicked at (${x}, ${y})` }));
      } else {
        console.log('Usage: list | eval <expr> | nav <url> | click <x,y> | status');
      }
    }
  } catch (err) {
    const isTimeout = err.message.startsWith('Timeout:');
    recordFailure(cb, err.message);
    const errType = isTimeout ? 'timeout' : 'cdp_error';
    console.log(result('error', {
      error: err.message,
      error_type: errType,
      retryable: !err.message.includes('no_oracle'),
      next_action: isTimeout ? 'Bridge may be overloaded, wait and retry' : undefined,
      circuit_state: loadCircuitState(),
    }));
    process.exit(isTimeout ? 3 : 1);
  } finally {
    if (ws) ws.close();
  }
}

main().catch(e => {
  console.log(result('error', { error: e.message, error_type: 'unhandled', retryable: false }));
  process.exit(1);
});
