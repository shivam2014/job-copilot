// Reproduce the exact JSON parsing error
import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

const cwd = process.cwd();
const ud = mkdtempSync(join(tmpdir(), 'jc-rp-'));
const ctx = await chromium.launchPersistentContext(ud, {
  channel: 'chromium', headless: true,
  args: ['--disable-extensions-except=' + cwd + '/extension', '--load-extension=' + cwd + '/extension', '--allow-insecure-localhost', '--disable-web-security'],
});

try {
  const sw = await new Promise(r => ctx.on('serviceworker', r));
  const extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)[1];
  const p = await ctx.newPage();
  
  // Collect ALL console messages
  const allLogs = [];
  p.on('console', msg => allLogs.push({ type: msg.type(), text: msg.text() }));
  p.on('pageerror', err => allLogs.push({ type: 'pageerror', text: err.message }));

  await p.goto('chrome-extension://' + extId + '/options/options.html');
  await new Promise(r => setTimeout(r, 2000));

  // Fill config
  await p.fill('#llm_base_url', 'http://localhost:19530/v1');
  await p.fill('#llm_api_key', 'dummy');
  
  // Select model
  await p.click('#llm_model');
  await new Promise(r => setTimeout(r, 5000));
  const items = await p.locator('.md-item').all();
  if (items.length > 0) await items[0].click();
  await new Promise(r => setTimeout(r, 1000));

  // Extract a short resume text (not PDF) to trigger extraction
  // Paste short text into textarea
  await p.click('#show-paste-link');
  await new Promise(r => setTimeout(r, 300));
  await p.fill('#resume_text', 'Shivam Bhalla\nshivam.bhalla07@gmail.com\n+33-753788537\nSystems Engineer');
  
  // Click extract
  await p.click('#extract-btn');
  console.log('Clicked extract, waiting...');
  await new Promise(r => setTimeout(r, 15000));

  // Show all logs related to JSON parsing
  const jsonErrors = allLogs.filter(l => l.text.includes('JSON') || l.text.includes('json') || l.text.includes('position') || l.text.includes('parse'));
  console.log('\nJSON-related logs:');
  jsonErrors.forEach(l => console.log(`  [${l.type}] ${l.text}`));
  
  // Show all errors
  const errors = allLogs.filter(l => l.type === 'error' || l.type === 'pageerror');
  console.log('\nAll errors:');
  errors.forEach(l => console.log(`  [${l.type}] ${l.text.substring(0, 200)}`));

  // Check what the extract status says
  const extractStatus = await p.$eval('#extract-status', el => el.textContent).catch(() => 'no element');
  console.log('\nExtract status:', extractStatus);

  await ctx.close();
} finally {
  try { rmSync(ud, { recursive: true, force: true }); } catch {}
}
