#!/usr/bin/env node
/**
 * CDP connector — fixed to target Oracle page.
 * Usage: node scripts/cdp_connect.mjs eval "expr"
 *        node scripts/cdp_connect.mjs screenshot
 *        node scripts/cdp_connect.mjs html
 *        node scripts/cdp_connect.mjs list
 */
import * as fs from 'node:fs';

const BRIDGE = 'ws://127.0.0.1:9222/devtools/browser';
const CMD = process.argv[2] || 'list';
const ARG = process.argv.slice(3).join(' ');

let msgId = 0;
const pending = new Map();
let ws;

function send(method, params = {}, sId = null) {
  const id = ++msgId;
  const msg = { id, method, params };
  if (sId) msg.sessionId = sId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout: ${method}`));
    }, 25000);
    pending.set(id, { resolve, reject, timeout });
    ws.send(JSON.stringify(msg));
  });
}

async function getOracleSession() {
  await send('Target.setDiscoverTargets', { discover: true });
  const targets = await send('Target.getTargets');
  const oracle = targets.targetInfos.find(t =>
    t.type === 'page' && t.url && t.url.includes('oracle')
  );
  if (!oracle) throw new Error('Oracle page not found');
  const attach = await send('Target.attachToTarget', { targetId: oracle.targetId, flatten: true });
  return { sessionId: attach.sessionId, targetInfo: oracle };
}

async function evalInPage(expr, sessionId) {
  const result = await send('Runtime.evaluate',
    { expression: expr, returnByValue: true, awaitPromise: true },
    sessionId
  );
  if (result.exceptionDetails) {
    return { error: result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails) };
  }
  return { value: result.result?.value };
}

async function main() {
  ws = new WebSocket(BRIDGE);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('WebSocket error'));
  });

  ws.binaryType = 'arraybuffer';
  ws.onmessage = (event) => {
    const raw = event.data;
    const data = typeof raw === 'string' ? raw
      : raw instanceof Buffer ? raw.toString('utf8')
      : raw instanceof ArrayBuffer ? Buffer.from(raw).toString('utf8')
      : Buffer.from(raw).toString('utf8');
    const msg = JSON.parse(data);
    const p = pending.get(msg.id);
    if (p) {
      clearTimeout(p.timeout);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.error.message} (code:${msg.error.code})`));
      else p.resolve(msg.result);
    }
  };

  try {
    if (CMD === 'list') {
      await send('Target.setDiscoverTargets', { discover: true });
      const targets = await send('Target.getTargets');
      console.log(JSON.stringify(targets.targetInfos, null, 2));
    } else {
      const { sessionId, targetInfo } = await getOracleSession();
      console.error(`Target: ${targetInfo.title} (${targetInfo.url.substring(0, 60)}...)`);

      if (CMD === 'eval') {
        const r = await evalInPage(ARG || 'document.title', sessionId);
        console.log(JSON.stringify(r.value ?? r.error, null, 2));
      } else if (CMD === 'html') {
        const r = await evalInPage('document.documentElement.outerHTML.substring(0, 80000)', sessionId);
        console.log(r.value);
      } else if (CMD === 'screenshot') {
        await send('Page.enable', {}, sessionId);
        const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
        const buf = Buffer.from(result.data, 'base64');
        fs.writeFileSync('page_screenshot.png', buf);
        console.error(`Screenshot saved: page_screenshot.png (${buf.length} bytes)`);
      } else if (CMD === 'inject') {
        // Inject JS into the page context
        const r = await evalInPage(ARG, sessionId);
        console.log(JSON.stringify(r.value ?? r.error, null, 2));
      } else {
        console.error('Usage: list | eval <expr> | html | screenshot | inject <code>');
      }
    }
  } finally {
    ws.close();
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
