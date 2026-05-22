import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

const cwd = process.cwd();
const ud = mkdtempSync(join(tmpdir(), 'jc-ed-'));
const ctx = await chromium.launchPersistentContext(ud, {
  channel: 'chromium', headless: true,
  args: ['--disable-extensions-except=' + cwd + '/extension', '--load-extension=' + cwd + '/extension'],
});

try {
  const sw = await new Promise(r => ctx.on('serviceworker', r));
  const extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)[1];
  const p = await ctx.newPage();
  
  const logs = [];
  p.on('console', msg => { if (msg.type() === 'error' || msg.text().includes('JC:')) logs.push(msg.text()); });
  p.on('pageerror', err => logs.push('PAGE_ERROR: ' + err.message));

  await p.goto('chrome-extension://' + extId + '/options/options.html');
  await new Promise(r => setTimeout(r, 2000));

  // Fill config, select model
  await p.fill('#llm_base_url', 'http://localhost:19530/v1');
  await p.fill('#llm_api_key', 'dummy');
  await p.click('#llm_model');
  await new Promise(r => setTimeout(r, 5000));
  const items = await p.locator('.md-item').all();
  if (items.length > 0) await items[0].click();
  await new Promise(r => setTimeout(r, 1000));

  // Upload the real PDF
  const pdfPath = '/Users/shivam94/Documents/Resume/tailored/Honeywell_20260522/Resume_Shivam_Bhalla_Honeywell_20260522.pdf';
  const fileInput = await p.$('#resume_file');
  if (fileInput) {
    console.log('Uploading PDF...');
    await fileInput.setInputFiles(pdfPath);
    console.log('Waiting 40s for extraction...');
    await new Promise(r => setTimeout(r, 45000));
  }

  // Check storage
  const stored = await p.evaluate(() => {
    return new Promise(resolve => {
      chrome.storage.sync.get(null, function(r) {
        const keys = Object.keys(r);
        const hasResumeData = 'resume_full_data' in r;
        const rdLen = r.resume_full_data ? r.resume_full_data.length : 0;
        const profileName = r.profile_name || '(empty)';
        const storedPdfText = r.resume_text ? r.resume_text.substring(0, 100) : '(empty)';
        resolve({ keys, hasResumeData, rdLen, profileName, storedPdfText });
      });
    });
  });
  console.log('Stored keys:', stored.keys.join(', '));
  console.log('Has resume_full_data:', stored.hasResumeData);
  console.log('resume_full_data length:', stored.rdLen);
  console.log('Profile name:', stored.profileName);

  // Check preview section
  const previewEl = await p.$('#resume-data-content');
  if (previewEl) {
    const previewText = await previewEl.textContent();
    console.log('Preview text:', previewText.substring(0, 200));
  }

  console.log('Console errors:', logs.length > 0 ? logs : 'none');
  await ctx.close();
} finally {
  try { rmSync(ud, { recursive: true, force: true }); } catch {}
}
