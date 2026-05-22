import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

const cwd = process.cwd();
const ud = mkdtempSync(join(tmpdir(), 'jc-fv-'));
const ctx = await chromium.launchPersistentContext(ud, {
  channel: 'chromium', headless: true,
  args: [
    '--disable-extensions-except=' + cwd + '/extension',
    '--load-extension=' + cwd + '/extension',
    '--allow-insecure-localhost',
    '--disable-web-security',
  ],
});

try {
  const sw = await new Promise(r => ctx.on('serviceworker', r));
  const extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)[1];
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', err => errors.push(err.message));
  p.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text().substring(0, 150)); });

  console.log('1. Opening options page...');
  await p.goto('chrome-extension://' + extId + '/options/options.html');
  await new Promise(r => setTimeout(r, 2000));

  console.log('2. Configuring LLM (Nyro)...');
  await p.fill('#llm_base_url', 'http://localhost:19530/v1');
  await p.fill('#llm_api_key', 'dummy');
  
  console.log('3. Loading models...');
  await p.click('#llm_model');
  await new Promise(r => setTimeout(r, 5000));
  const items = await p.locator('.md-item').all();
  if (items.length > 0) {
    console.log('   Select:', await items[0].textContent());
    await items[0].click();
  }
  await new Promise(r => setTimeout(r, 1000));

  console.log('4. Uploading PDF...');
  await p.locator('#resume_file').setInputFiles('/Users/shivam94/Documents/Resume/tailored/Honeywell_20260522/Resume_Shivam_Bhalla_Honeywell_20260522.pdf');
  console.log('5. Waiting for extraction...');
  await new Promise(r => setTimeout(r, 60000));

  console.log('6. Checking results...');
  const result = await p.evaluate(() => {
    return new Promise(resolve => {
      chrome.storage.sync.get(['resume_full_data', 'profile_name', 'profile_email'], function(r) {
        const hasData = !!r.resume_full_data;
        let sections = 0, skills = 0, exp = 0;
        if (hasData) {
          try {
            const d = JSON.parse(r.resume_full_data);
            sections = Object.keys(d.rawSections || {}).length;
            skills = (d.rawSections.skills || []).length;
            exp = (d.rawSections.experience || []).length;
          } catch(e) {}
        }
        resolve({ hasData, sections, skills, exp, name: r.profile_name || '' });
      });
    });
  });

  console.log('   hasData:', result.hasData);
  console.log('   sections:', result.sections, 'skills:', result.skills, 'exp:', result.exp);
  console.log('   name:', result.name);
  console.log('   errors:', errors.length > 0 ? errors.slice(0, 2) : 'none');

  if (result.hasData && result.name) {
    console.log('\n✅ PDF EXTRACTION WORKS');
  } else {
    console.log('\n❌ FAILED');
  }

  await ctx.close();
} finally {
  try { rmSync(ud, { recursive: true, force: true }); } catch {}
}
