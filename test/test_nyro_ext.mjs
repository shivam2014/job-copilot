import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

const cwd = process.cwd();
const ud = mkdtempSync(join(tmpdir(), 'jc-ny-'));
const ctx = await chromium.launchPersistentContext(ud, {
  channel: 'chromium', headless: true,
  args: ['--disable-extensions-except=' + cwd + '/extension', '--load-extension=' + cwd + '/extension', '--allow-insecure-localhost', '--disable-web-security'],
});

try {
  const sw = await new Promise(r => ctx.on('serviceworker', r));
  const extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)[1];
  
  // Test fetch from extension page context
  const p = await ctx.newPage();
  await p.goto('chrome-extension://' + extId + '/options/options.html');
  await new Promise(r => setTimeout(r, 2000));
  
  // Try fetching from within the extension page
  const result = await p.evaluate(async () => {
    try {
      const resp = await fetch('http://localhost:19530/v1/models', {
        headers: { 'Authorization': 'Bearer dummy' }
      });
      const data = await resp.json();
      return { ok: resp.ok, status: resp.status, models: (data.data || []).length };
    } catch (e) {
      return { error: e.message, name: e.name };
    }
  });
  console.log('Fetch from extension page:', JSON.stringify(result));
  
  await ctx.close();
} finally {
  try { rmSync(ud, { recursive: true, force: true }); } catch {}
}
