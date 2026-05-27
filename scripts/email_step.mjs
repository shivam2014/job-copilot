#!/usr/bin/env node
/**
 * CDP automation for Oracle email verification step.
 * Uses real browser-level events that KO observables respond to.
 */
import * as fs from 'node:fs';

const BRIDGE = 'ws://127.0.0.1:9222/devtools/browser';

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
    }, 30000);
    pending.set(id, { resolve, reject, timeout });
    ws.send(JSON.stringify(msg));
  });
}

function parseData(raw) {
  return typeof raw === 'string' ? raw
    : raw instanceof Buffer ? raw.toString('utf8')
    : raw instanceof ArrayBuffer ? Buffer.from(raw).toString('utf8')
    : Buffer.from(raw).toString('utf8');
}

async function connect() {
  ws = new WebSocket(BRIDGE);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.binaryType = 'arraybuffer';
    ws.onerror = () => reject(new Error('WebSocket error'));
  });
  ws.onmessage = (event) => {
    const data = parseData(event.data);
    try {
      const msg = JSON.parse(data);
      const p = pending.get(msg.id);
      if (p) {
        clearTimeout(p.timeout);
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.error.message} (code:${msg.error.code})`));
        else p.resolve(msg.result);
      }
    } catch (e) { /* non-JSON */ }
  };
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function evalInPage(sessionId, expr) {
  const result = await send('Runtime.evaluate',
    { expression: expr, returnByValue: true, awaitPromise: true, timeout: 10000 },
    sessionId
  );
  if (result.exceptionDetails) {
    return { error: result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails) };
  }
  return { value: result.result?.value };
}

async function main() {
  await connect();
  console.log('Connected to CDP bridge');
  
  const { sessionId, targetInfo } = await getOracleSession();
  console.log('Attached to:', targetInfo.url);
  
  // Step 1: Clear email field and focus it
  console.log('\n--- Step 1: Clear and focus email field ---');
  const clearResult = await evalInPage(sessionId,
    `(function(){
      var el = document.getElementById('primary-email-0');
      if (!el) return 'no email field';
      el.value = '';
      el.focus();
      // Also dispatch events to ensure KO catches it
      el.dispatchEvent(new Event('input', {bubbles: true}));
      el.dispatchEvent(new Event('change', {bubbles: true}));
      return 'cleared and focused';
    })()`
  );
  console.log('Clear result:', JSON.stringify(clearResult));
  await sleep(300);
  
  // Step 2: Type the email via CDP Input.insertText (trusted events)
  console.log('\n--- Step 2: Type email via CDP Input.insertText ---');
  await send('Input.insertText', { text: 'shivam.bhalla07@gmail.com' }, sessionId);
  console.log('Email inserted');
  await sleep(500);
  
  // Step 3: Check what value is now in the field
  const checkResult = await evalInPage(sessionId,
    `document.getElementById('primary-email-0') ? document.getElementById('primary-email-0').value : 'no field'`
  );
  console.log('Email field value now:', checkResult.value || 'ERROR: ' + (checkResult.error || ''));
  await sleep(300);
  
  // Step 4: Click the checkbox via CDP mouse click at its coordinates
  console.log('\n--- Step 3: Click checkbox via CDP ---');
  const cbResult = await evalInPage(sessionId,
    `(function(){
      var cb = document.getElementById('legal-disclaimer-checkbox');
      if (!cb) return JSON.stringify({error: 'no checkbox'});
      var r = cb.getBoundingClientRect();
      return JSON.stringify({
        x: Math.round(r.x + r.width/2),
        y: Math.round(r.y + r.height/2)
      });
    })()`
  );
  
  let cbCoords;
  try {
    cbCoords = JSON.parse(cbResult.value);
  } catch(e) {
    console.error('Failed to get checkbox coords:', cbResult);
    // Try clicking Next anyway
  }
  
  if (cbCoords && cbCoords.x) {
    // First click to uncheck (it's currently checked in DOM but not in KO)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cbCoords.x, y: cbCoords.y, button: 'left', clickCount: 1 }, sessionId);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cbCoords.x, y: cbCoords.y, button: 'left', clickCount: 1 }, sessionId);
    console.log('Checkbox clicked (uncheck)');
    await sleep(300);
    
    // Second click to re-check (this updates KO's observable)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cbCoords.x, y: cbCoords.y, button: 'left', clickCount: 1 }, sessionId);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cbCoords.x, y: cbCoords.y, button: 'left', clickCount: 1 }, sessionId);
    console.log('Checkbox clicked (re-check)');
    await sleep(500);
  }
  
  // Step 5: Verify checkbox state
  const verifyResult = await evalInPage(sessionId,
    `(function(){
      var cb = document.getElementById('legal-disclaimer-checkbox');
      if (!cb) return 'no checkbox';
      return 'checked=' + cb.checked + ' aria-invalid=' + cb.getAttribute('aria-invalid');
    })()`
  );
  console.log('Checkbox state:', verifyResult.value || verifyResult.error);
  
  // Step 6: Click the Next button via CDP mouse click
  console.log('\n--- Step 4: Click Next button via CDP ---');
  const nextResult = await evalInPage(sessionId,
    `(function(){
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim() === 'Next') {
          var r = btns[i].getBoundingClientRect();
          return JSON.stringify({
            x: Math.round(r.x + r.width/2),
            y: Math.round(r.y + r.height/2),
            disabled: btns[i].disabled,
            visible: btns[i].offsetParent !== null
          });
        }
      }
      return JSON.stringify({error: 'next button not found'});
    })()`
  );
  
  let nextCoords;
  try {
    nextCoords = JSON.parse(nextResult.value);
  } catch(e) {
    console.error('Failed to get next coords:', nextResult);
  }
  
  if (nextCoords && nextCoords.x) {
    console.log('Next button coords:', nextCoords);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: nextCoords.x, y: nextCoords.y, button: 'left', clickCount: 1 }, sessionId);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: nextCoords.x, y: nextCoords.y, button: 'left', clickCount: 1 }, sessionId);
    console.log('Next button clicked!');
  }
  
  // Wait for navigation
  console.log('\nWaiting 8 seconds for page transition...');
  await sleep(8000);
  
  // Check current URL
  const urlResult = await evalInPage(sessionId, 'window.location.href');
  console.log('Current URL:', urlResult.value || urlResult.error);
  
  const titleResult = await evalInPage(sessionId, 'document.title');
  console.log('Page title:', titleResult.value || titleResult.error);
  
  ws.close();
  console.log('\nDone.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
