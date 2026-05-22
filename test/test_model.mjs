import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync, readFileSync } from 'fs';

const cwd = process.cwd();
const ud = mkdtempSync(join(tmpdir(), 'jc-tm-'));
const ctx = await chromium.launchPersistentContext(ud, {
  channel: 'chromium', headless: true,
  args: ['--disable-extensions-except=' + cwd + '/extension', '--load-extension=' + cwd + '/extension'],
});

try {
  const sw = await new Promise(r => ctx.on('serviceworker', r));
  const extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)[1];
  const p = await ctx.newPage();

  const logs = [];
  p.on('console', msg => logs.push({ type: msg.type(), text: msg.text() }));
  p.on('pageerror', err => logs.push({ type: 'error', text: err.message }));

  await p.goto('chrome-extension://' + extId + '/options/options.html');
  await new Promise(r => setTimeout(r, 2000));

  // Fill URL and key
  await p.fill('#llm_base_url', 'http://localhost:19530/v1');
  await p.fill('#llm_api_key', 'dummy');
  
  // Check hint before clicking model
  const hintBefore = await p.$eval('#model-count', el => el.textContent);
  console.log('Hint before click:', `"${hintBefore}"`);

  // Click the model field
  await p.click('#llm_model');
  console.log('Clicked model field, waiting for models...');
  await new Promise(r => setTimeout(r, 5000));

  // Check hint after
  const hintAfter = await p.$eval('#model-count', el => el.textContent);
  console.log('Hint after click:', `"${hintAfter}"`);

  // Check dropdown
  const dropdownOpen = await p.$eval('#model-dropdown', el => el.classList.contains('open'));
  const itemCount = await p.$$eval('.md-item', els => els.length);
  console.log('Dropdown open:', dropdownOpen, 'Items:', itemCount);

  // Check for errors
  const errs = logs.filter(l => l.type === 'error');
  console.log('Errors:', errs.length > 0 ? errs.map(e => e.text).join(' | ') : 'none');

  if (itemCount > 0) {
    console.log('✅ Models loaded successfully');
  } else if (errs.length > 0) {
    console.log('❌ Failed with errors');
  } else {
    console.log('⚠️ No models loaded, no errors - might need investigation');
  }

  await ctx.close();
} finally {
  try { rmSync(ud, { recursive: true, force: true }); } catch {}
}
