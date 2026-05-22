import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

const cwd = process.cwd();
const ud = mkdtempSync(join(tmpdir(), 'jc-di-'));
const ctx = await chromium.launchPersistentContext(ud, {
  channel: 'chromium', headless: true,
  args: ['--disable-extensions-except=' + cwd + '/extension', '--load-extension=' + cwd + '/extension', '--allow-insecure-localhost', '--disable-web-security'],
});

try {
  const sw = await new Promise(r => ctx.on('serviceworker', r));
  const extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)[1];
  const p = await ctx.newPage();
  const msgs = [];
  p.on('console', msg => msgs.push({ type: msg.type(), text: msg.text() }));
  
  await p.goto('chrome-extension://' + extId + '/options/options.html');
  await new Promise(r => setTimeout(r, 2000));

  // Fill config
  await p.fill('#llm_base_url', 'http://localhost:19530/v1');
  await p.fill('#llm_api_key', 'dummy');
  await p.click('#llm_model');
  await new Promise(r => setTimeout(r, 5000));
  const items = await p.locator('.md-item').all();
  if (items.length > 0) await items[0].click();
  await new Promise(r => setTimeout(r, 1000));

  // Check upload status after file input
  const statusBefore = await p.$eval('#upload-status', el => el.textContent).catch(() => 'no-status');
  console.log('Status before:', statusBefore);

  // Upload
  await p.locator('#resume_file').setInputFiles('/Users/shivam94/Documents/Resume/tailored/Honeywell_20260522/Resume_Shivam_Bhalla_Honeywell_20260522.pdf');
  
  // Check status periodically
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const status = await p.$eval('#upload-status', el => el.textContent).catch(() => 'waiting');
    const extractStatus = await p.$eval('#extract-status', el => el.textContent).catch(() => '');
    console.log(`t=${(i+1)*5}s  upload: "${status}"  extract: "${extractStatus}"`);
    if (status.includes('✅') || status.includes('❌')) break;
  }

  // Print errors
  const errMsgs = msgs.filter(m => m.type === 'error').map(m => m.text).slice(0, 3);
  console.log('Errors:', errMsgs.length > 0 ? errMsgs : 'none');

  await ctx.close();
} finally {
  try { rmSync(ud, { recursive: true, force: true }); } catch {}
}
