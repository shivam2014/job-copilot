#!/usr/bin/env node
// Quick CDP test: connect to Oracle page, check JC state
// Uses raw WebSocket, handles Oracle's console flood

import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const WS_URL = 'ws://127.0.0.1:9222/devtools/browser';

// WS connect
const socket = await new Promise((resolve, reject) => {
  const key = randomBytes(16).toString('base64');
  const req = request({
    hostname: '127.0.0.1', port: 9222, path: '/devtools/browser', method: 'GET',
    headers: { 'Connection': 'Upgrade', 'Upgrade': 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key }
  });
  req.on('upgrade', (_, s) => resolve(s));
  req.on('error', reject);
  req.end();
});

let buf = Buffer.alloc(0), msgId = 100;
const pending = new Map();

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
    try {
      const p = JSON.parse(msg);
      if (p.id && pending.has(p.id)) { pending.get(p.id)(p); pending.delete(p.id); }
    } catch {}
  }
  buf = buf.slice(offset);
});

function cdp(method, params = {}, sessionId) {
  const id = ++msgId;
  const cmd = sessionId ? { id, sessionId, method, params } : { id, method, params };
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 15000);
    pending.set(id, r => { clearTimeout(timeout); resolve(r); });
    const b = Buffer.from(JSON.stringify(cmd));
    const hdr = Buffer.alloc(b.length < 126 ? 2 : 4);
    hdr[0] = 0x81;
    if (b.length < 126) { hdr[1] = b.length; }
    else { hdr[1] = 126; hdr.writeUInt16BE(b.length, 2); }
    socket.write(Buffer.concat([hdr, b]));
  });
}

// Get targets
await cdp('Target.getTargets');
const targets = (await cdp('Target.getTargets')).result.targetInfos;
const oraclePages = targets.filter(t => t.type === 'page' && t.url.includes('oraclecloud'));
console.log('Oracle pages:', oraclePages.length);
oraclePages.forEach(p => console.log('  ' + (p.url.includes('apply') ? '→ ' : '  ') + p.url.slice(0, 90)));

// Pick the apply page or first Oracle page
const target = oraclePages.find(p => p.url.includes('apply')) || oraclePages[0];
if (!target) { console.log('No Oracle page'); process.exit(0); }

socket.end();
console.log('\nDone.');
process.exit(0);
