#!/usr/bin/env node
/**
 * Launch Chrome for Testing with JC extension loaded.
 * Chrome 137+ removed --load-extension. Replacement:
 * --remote-debugging-pipe + Extensions.loadUnpacked CDP,
 * bridged to a WebSocket server on port 9222.
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { launch, Launcher } from 'chrome-launcher';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(__dirname, '..', 'extension');
const PROFILE = path.resolve(__dirname, '..', '.chrome-profile');
const STARTING_URL = process.argv[2] || 'about:blank';
const PORT = 9222;
const CHROME = path.resolve(process.env.HOME, 'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function acceptWS(req, socket) {
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
}

function encodeWS(data) {
  const b = Buffer.from(data, 'utf8');
  const h = b.length < 126 ? Buffer.alloc(2) : b.length < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  h[0] = 0x81;
  if (b.length < 126) h[1] = b.length;
  else if (b.length < 65536) { h[1] = 126; h.writeUInt16BE(b.length, 2); }
  else { h[1] = 127; h.writeBigUInt64BE(BigInt(b.length), 2); }
  return Buffer.concat([h, b]);
}

function decodeWS(buffer) {
  const msgs = []; let offset = 0;
  while (buffer.length - offset >= 2) {
    const opcode = buffer[offset] & 0x0f;
    const masked = (buffer[offset + 1] & 0x80) !== 0;
    let len = buffer[offset + 1] & 0x7f, hdr = 2;
    if (len === 126) { if (buffer.length - offset < 4) break; len = buffer.readUInt16BE(offset + 2); hdr = 4; }
    else if (len === 127) { if (buffer.length - offset < 10) break; len = Number(buffer.readBigUInt64BE(offset + 2)); hdr = 10; }
    const maskLen = masked ? 4 : 0, total = hdr + maskLen + len;
    if (buffer.length - offset < total) break;
    const mask = masked ? buffer.slice(offset + hdr, offset + hdr + 4) : null;
    let payload = Buffer.from(buffer.slice(offset + hdr + maskLen, offset + total));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    msgs.push({ opcode, payload: payload.toString('utf8') });
    offset += total;
  }
  return { msgs, remaining: buffer.slice(offset) };
}

// One-shot CDP command, returns parsed result
function cdpOnce(pipes, method, params, tmo = 15000) {
  const id = Math.floor(Math.random() * 1000000) + 1;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout: ${method}`)), tmo);
    let buf = '';
    const handler = (chunk) => {
      buf += chunk.toString();
      let end;
      while ((end = buf.indexOf('\x00')) !== -1) {
        const msg = buf.slice(0, end); buf = buf.slice(end + 1);
        try {
          const p = JSON.parse(msg);
          if (p.id === id) {
            clearTimeout(timeout);
            pipes.incoming.removeListener('data', handler);
            if (p.error) reject(new Error(p.error.message)); else resolve(p.result);
            return;
          }
        } catch {}
      }
    };
    pipes.incoming.on('data', handler);
    pipes.outgoing.write(JSON.stringify({ id, method, params }) + '\x00');
  });
}

// --- Main ---
process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

async function main() {
  console.log(`=== Launching Chrome + JC (CDP port ${PORT}) ===\n`);

  // 1. Launch Chrome
  console.log('1. Launching Chrome in pipe mode...');
  fs.mkdirSync(PROFILE, { recursive: true });
  const chrome = await launch({
    chromeFlags: Launcher.defaultFlags()
      .filter(f => f !== '--disable-extensions')
      .concat(['--remote-debugging-pipe', '--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check']),
    ignoreDefaultFlags: true, userDataDir: PROFILE, startingUrl: 'about:blank',
    chromePath: CHROME, handleSIGINT: false, logLevel: 'error',
  });
  const pipes = chrome.remoteDebuggingPipes;
  if (!pipes) throw new Error('No pipes');
  console.log(`   PID: ${chrome.pid}`);

  // 2. Load extension
  console.log('\n2. Loading JC extension...');
  await sleep(500);
  const ext = await cdpOnce(pipes, 'Extensions.loadUnpacked', { path: EXT_PATH });
  console.log(`   ✅ ID: ${ext.id}`);

  // 3. Open URL
  console.log('\n3. Opening URL...');
  await cdpOnce(pipes, 'Target.createTarget', { url: STARTING_URL });
  console.log('   Done');

  // 4. WebSocket bridge
  console.log(`\n4. WebSocket bridge on port ${PORT}...`);
  const server = createServer((req, res) => {
    const u = (req.url || '').replace(/\/+$/, '');
    if (u === '/json/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ Browser: 'Chrome/148 via pipe', webSocketDebuggerUrl: `ws://127.0.0.1:${PORT}/devtools/browser` }));
    } else if (u === '/json' || u.startsWith('/json/list')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{ id: 'bridge', type: 'page', title: 'JC Chrome', url: STARTING_URL, webSocketDebuggerUrl: `ws://127.0.0.1:${PORT}/devtools/page/bridge` }]));
    } else { res.writeHead(404); res.end(); }
  });

  server.on('upgrade', (req, socket) => {
    if (!pipes.outgoing.writable) { try { socket.end(); } catch {} return; }
    acceptWS(req, socket);
    let wsBuf = Buffer.alloc(0);
    let closed = false;
    const close = () => { if (!closed) { closed = true; try { socket.end(); } catch {} } };
    
    const onData = (chunk) => {
      if (closed) return;
      let b = chunk.toString(), end;
      while ((end = b.indexOf('\x00')) !== -1) {
        try { socket.write(encodeWS(b.slice(0, end))); } catch { close(); return; }
        b = b.slice(end + 1);
      }
    };
    pipes.incoming.on('data', onData);
    
    socket.on('data', (chunk) => {
      if (closed) return;
      wsBuf = Buffer.concat([wsBuf, chunk]);
      const { msgs, remaining } = decodeWS(wsBuf);
      wsBuf = remaining;
      for (const m of msgs) {
        if (m.opcode === 8) { close(); return; }
        if (m.opcode === 9) { try { socket.write(encodeWS('')); } catch {} continue; }
        try { JSON.parse(m.payload); pipes.outgoing.write(m.payload + '\x00'); } catch {}
      }
    });
    
    const cleanup = () => { close(); pipes.incoming.removeListener('data', onData); };
    socket.on('error', cleanup);
    socket.on('close', cleanup);
  });

  server.listen(PORT, '127.0.0.1');
  console.log(`   ✅ ws://127.0.0.1:${PORT}`);

  console.log(`\n🎉 Chrome ready! Ctrl+C to stop.`);
  chrome.process.on('exit', () => process.exit(0));
  process.on('SIGINT', () => chrome.kill());
  await new Promise(() => {});
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
