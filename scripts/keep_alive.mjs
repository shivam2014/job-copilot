import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extPath = path.resolve(__dirname, '..', 'extension');
const userDataDir = path.resolve(__dirname, '..', '.chrome-profile-pw');
const HEALTH_FILE = '/tmp/cdc-chrome-health.json';
const HEARTBEAT_INTERVAL = 5000;

// ── Health file helpers ─────────────────────────────────────────────

function writeHealth(data) {
  try { fs.writeFileSync(HEALTH_FILE, JSON.stringify(data, null, 2)); } catch (_) {}
}

function getChromePid() {
  try {
    // Find Chrome process listening on port 9222
    const pid = execSync("lsof -i :9222 -t 2>/dev/null | head -1", { encoding: 'utf-8' }).trim();
    return pid ? parseInt(pid) : null;
  } catch { return null; }
}

function diagnoseClose(pid) {
  if (!pid) return 'unknown';
  try {
    // macOS: check if process still exists and get exit info
    // kill -0 checks existence without sending a signal
    process.kill(pid, 0);
    return 'alive'; // still running
  } catch (e) {
    if (e.code === 'ESRCH') {
      // Process gone — check crash reports
      const crashDir = path.join(userDataDir, 'Crashpad', 'reports');
      try {
        const reports = fs.readdirSync(crashDir);
        if (reports.length > 0) {
          // Check if any crash report is recent (within last 30s)
          const recent = reports.some(f => {
            try {
              const stat = fs.statSync(path.join(crashDir, f));
              return Date.now() - stat.mtimeMs < 30000;
            } catch { return false; }
          });
          if (recent) return 'crashed';
        }
      } catch (_) {}
      return 'killed';
    }
    return 'unknown';
  }
}

// ── Launch Chrome ───────────────────────────────────────────────────

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: null,
  args: [
    '--load-extension=' + extPath,
    '--disable-extensions-except=' + extPath,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    '--remote-debugging-port=9222',
  ],
  ignoreDefaultArgs: ['--disable-extensions'],
});

// Get Chrome PID
const chromePid = getChromePid();
const startTime = Math.floor(Date.now() / 1000);

writeHealth({ pid: chromePid, startTime, lastHeartbeat: startTime, status: 'running' });

console.log('=== Chrome launcher running ===');
console.log(`Chrome PID: ${chromePid || 'unknown'}`);
console.log('Extension loaded, remote debugging on port 9222');
console.log(`Health file: ${HEALTH_FILE}`);
console.log('');

const page = context.pages()[0] || await context.newPage();
for (const p of context.pages()) {
  console.log('Page:', p.url());
}

// ── Heartbeat ───────────────────────────────────────────────────────

const heartbeat = setInterval(() => {
  writeHealth({ pid: chromePid, startTime, lastHeartbeat: Math.floor(Date.now() / 1000), status: 'running' });
}, HEARTBEAT_INTERVAL);

// ── Close handler ───────────────────────────────────────────────────

context.on('close', () => {
  clearInterval(heartbeat);
  const reason = diagnoseClose(chromePid);
  const closeTime = Math.floor(Date.now() / 1000);
  writeHealth({ pid: chromePid, startTime, closeTime, reason, status: 'stopped' });
  console.log(`Chrome closed: ${reason} (pid: ${chromePid})`);
});

process.on('SIGINT', () => {
  clearInterval(heartbeat);
  writeHealth({ pid: chromePid, startTime, closeTime: Math.floor(Date.now() / 1000), reason: 'shutdown', status: 'stopped' });
  process.exit(0);
});

process.on('SIGTERM', () => {
  clearInterval(heartbeat);
  writeHealth({ pid: chromePid, startTime, closeTime: Math.floor(Date.now() / 1000), reason: 'shutdown', status: 'stopped' });
  process.exit(0);
});

// Keep alive
await new Promise(() => {});
