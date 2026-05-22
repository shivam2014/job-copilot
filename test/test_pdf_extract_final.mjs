import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

const cwd = process.cwd();
const ud = mkdtempSync(join(tmpdir(), 'jc-pdf-'));
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
  p.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

  console.log('1. Opening options page...');
  await p.goto('chrome-extension://' + extId + '/options/options.html');
  await new Promise(r => setTimeout(r, 2000));

  console.log('2. Configuring LLM...');
  await p.fill('#llm_base_url', 'http://localhost:19530/v1');
  await p.fill('#llm_api_key', 'dummy');
  await p.click('#llm_model');
  await new Promise(r => setTimeout(r, 5000));
  const items = await p.locator('.md-item').all();
  if (items.length > 0) await items[0].click();
  await new Promise(r => setTimeout(r, 1000));

  console.log('3. Uploading PDF...');
  const fileInput = await p.$('#resume_file');
  await fileInput.setInputFiles('/Users/shivam94/Documents/Resume/tailored/Honeywell_20260522/Resume_Shivam_Bhalla_Honeywell_20260522.pdf');
  console.log('4. Waiting for extraction (60s)...');
  await new Promise(r => setTimeout(r, 60000));

  console.log('5. Checking results...');
  const result = await p.evaluate(() => {
    return new Promise(resolve => {
      chrome.storage.sync.get(['resume_full_data', 'profile_name', 'profile_email'], function(r) {
        const hasData = !!r.resume_full_data;
        let sections = 0;
        if (hasData) {
          try {
            const parsed = JSON.parse(r.resume_full_data);
            sections = Object.keys(parsed.rawSections || {}).length;
          } catch(e) {}
        }
        resolve({
          hasData: hasData,
          dataLen: r.resume_full_data ? r.resume_full_data.length : 0,
          sections: sections,
          name: r.profile_name || '(empty)',
          email: r.profile_email || '(empty)'
        });
      });
    });
  });

  console.log('   resume_full_data saved:', result.hasData);
  console.log('   data length:', result.dataLen);
  console.log('   sections count:', result.sections);
  console.log('   name:', result.name);
  console.log('   email:', result.email);
  console.log('   errors:', errors.length > 0 ? errors : 'none');
  
  if (result.hasData && result.name !== '(empty)' && errors.length === 0) {
    console.log('\n✅ EXTRACTION WORKS');
  } else {
    console.log('\n❌ EXTRACTION FAILED');
  }

  await ctx.close();
} finally {
  try { rmSync(ud, { recursive: true, force: true }); } catch {}
}
