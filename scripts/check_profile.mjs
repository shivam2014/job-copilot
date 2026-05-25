#!/usr/bin/env node
// Check extension profile data via options page
import { request } from 'node:http';
import { randomBytes } from 'node:crypto';

const CDP_PORT = 9222;
const EXT_ID = 'nbpeoddibjhngmomojgpeoiceocnoknn';

const socket = await new Promise(r => {
  const key = randomBytes(16).toString('base64');
  const req = request({ hostname: '127.0.0.1', port: CDP_PORT, path: '/devtools/browser', method: 'GET',
    headers: { 'Connection': 'Upgrade', 'Upgrade': 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key } });
  req.on('upgrade', (_, s) => r(s));
  req.end();
});

let buf = Buffer.alloc(0), msgId = 100, pending = new Map();
socket.on('data', c => {
  buf = Buffer.concat([buf, c]);
  let offset = 0;
  while (offset < buf.length) {
    if (buf.length - offset < 2) break;
    let len = buf[offset + 1] & 0x7f, hdr = 2;
    if (len === 126) { if (buf.length - offset < 4) break; len = buf.readUInt16BE(offset + 2); hdr = 4; }
    const total = hdr + len;
    if (buf.length - offset < total) break;
    const msg = buf.slice(offset + hdr, offset + total).toString();
    offset += total;
    try { const p = JSON.parse(msg); if (p.id && pending.has(p.id)) { pending.get(p.id)(p); pending.delete(p.id); } } catch {}
  }
  buf = buf.slice(offset);
});

function cdp(method, params = {}, sid) {
  const id = ++msgId;
  const cmd = sid ? { id, sessionId: sid, method, params } : { id, method, params };
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(method)), 15000);
    pending.set(id, r => { clearTimeout(t); res(r); });
    const b = Buffer.from(JSON.stringify(cmd));
    const h = b.length < 126 ? Buffer.alloc(2) : Buffer.alloc(4);
    h[0] = 0x81;
    if (b.length < 126) h[1] = b.length;
    else { h[1] = 126; h.writeUInt16BE(b.length, 2); }
    socket.write(Buffer.concat([h, b]));
  });
}

// Create tab, navigate to options page
const { targetId } = (await cdp('Target.createTarget', { url: 'about:blank' })).result;
const { sessionId } = (await cdp('Target.attachToTarget', { targetId, flatten: true })).result;
await cdp('Page.enable', {}, sessionId);
await cdp('Runtime.enable', {}, sessionId);
await new Promise(r => setTimeout(r, 1000));

await cdp('Page.navigate', { url: `chrome-extension://${EXT_ID}/options/options.html` }, sessionId);
await new Promise(r => setTimeout(r, 5000));

// Check profile fields
const fields = ['profile-name', 'profile-email', 'profile-phone', 'profile-address', 'profile-linkedin', 'profile-github', 'profile-website'];
for (const id of fields) {
  const r = await cdp('Runtime.evaluate', {
    expression: `document.getElementById('${id}')?.value || ''`,
    returnByValue: true
  }, sessionId);
  console.log(`${id}: "${r.result?.result?.value || ''}"`);
}

socket.end();
process.exit(0);
