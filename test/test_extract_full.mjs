import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync, readFileSync } from 'fs';

const cwd = process.cwd();
const ud = mkdtempSync(join(tmpdir(), 'jc-ef-'));
const ctx = await chromium.launchPersistentContext(ud, {
  channel: 'chromium', headless: true,
  args: ['--disable-extensions-except=' + cwd + '/extension', '--load-extension=' + cwd + '/extension'],
});

try {
  const sw = await new Promise(r => ctx.on('serviceworker', r));
  const extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)[1];
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', err => errors.push(err.message));

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

  // Upload the actual resume PDF using file input
  const pdfPath = '/Users/shivam94/Documents/Resume/tailored/Honeywell_20260522/Resume_Shivam_Bhalla_Honeywell_20260522.pdf';
  const fileInput = await p.$('#resume_file');
  if (fileInput) {
    await fileInput.setInputFiles(pdfPath);
    console.log('PDF uploaded, waiting for extraction...');
    await new Promise(r => setTimeout(r, 30000)); // Wait for LLM
  }

  // Check what's in resume_full_data storage
  const stored = await p.evaluate(() => {
    return new Promise(resolve => {
      chrome.storage.sync.get('resume_full_data', function(r) {
        resolve(r.resume_full_data ? r.resume_full_data.substring(0, 500) : 'EMPTY');
      });
    });
  });
  console.log('Stored resume_full_data:', stored);

  // Check the preview section
  const previewText = await p.$eval('#resume-data-content', el => el.textContent).catch(() => 'no element');
  console.log('Preview:', previewText.substring(0, 200));

  // Check profile fields
  const name = await p.$eval('#profile_name', el => el.value).catch(() => 'no field');
  console.log('Profile name:', name);

  console.log('Errors:', errors.length > 0 ? errors : 'none');
  await ctx.close();
} finally {
  try { rmSync(ud, { recursive: true, force: true }); } catch {}
}
