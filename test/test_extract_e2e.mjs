import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
const cwd = process.cwd();
const ud = mkdtempSync(join(tmpdir(), 'jc-ex-'));
const ctx = await chromium.launchPersistentContext(ud, {
  channel: 'chromium', headless: true,
  args: ['--disable-extensions-except=' + cwd + '/extension', '--load-extension=' + cwd + '/extension'],
});
try {
  const sw = await new Promise(r => ctx.on('serviceworker', r));
  const extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)[1];
  const p = await ctx.newPage();
  const logs = [];
  p.on('pageerror', err => logs.push('ERR: ' + err.message));
  p.on('console', msg => { if (msg.type() === 'error') logs.push('CONSOLE: ' + msg.text()); });
  
  await p.goto('chrome-extension://' + extId + '/options/options.html');
  await new Promise(r => setTimeout(r, 2000));

  // Fill LLM config
  await p.fill('#llm_base_url', 'http://localhost:19530/v1');
  await p.fill('#llm_api_key', 'dummy');
  
  // Select model
  await p.click('#llm_model');
  await new Promise(r => setTimeout(r, 4000));
  const items = await p.locator('.md-item').all();
  if (items.length > 0) await items[0].click();
  await new Promise(r => setTimeout(r, 1000));

  // Upload PDF by triggering the file input
  const pdfPath = cwd + '/test/test_resume.pdf';
  // Create a minimal test PDF
  const { writeFileSync } = await import('fs');
  writeFileSync(pdfPath, '%PDF-1.4 test');
  
  const fileInput = await p.$('#resume_file');
  if (fileInput) {
    await fileInput.setInputFiles(pdfPath);
    await new Promise(r => setTimeout(r, 2000));
    console.log('PDF upload triggered');
  }

  await new Promise(r => setTimeout(r, 1000));
  console.log('Errors:', logs.length > 0 ? logs : 'none');
  
  await ctx.close();
} finally {
  try { rmSync(ud, { recursive: true, force: true }); } catch {}
}
