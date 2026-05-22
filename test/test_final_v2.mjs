import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

const cwd = process.cwd();
const ud = mkdtempSync(join(tmpdir(), 'jc-fv2-'));
const ctx = await chromium.launchPersistentContext(ud, {
  channel: 'chromium', headless: true,
  args: ['--disable-extensions-except=' + cwd + '/extension', '--load-extension=' + cwd + '/extension', '--allow-insecure-localhost', '--disable-web-security'],
});

try {
  const sw = await new Promise(r => ctx.on('serviceworker', r));
  const extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)[1];
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', err => errors.push(err.message));
  p.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text().substring(0, 150)); });

  await p.goto('chrome-extension://' + extId + '/options/options.html');
  await new Promise(r => setTimeout(r, 2000));

  await p.fill('#llm_base_url', 'http://localhost:19530/v1');
  await p.fill('#llm_api_key', 'dummy');

  // Click model field to load dropdown
  await p.click('#llm_model');
  await new Promise(r => setTimeout(r, 5000));

  // Select deepseek-v4-flash-2 specifically
  const items = await p.locator('.md-item').all();
  let selected = false;
  for (const item of items) {
    const text = await item.textContent();
    if (text.includes('deepseek')) {
      await item.click();
      selected = true;
      console.log('Selected:', text);
      break;
    }
  }
  if (!selected && items.length > 0) {
    await items[0].click();
    console.log('Selected first:', await items[0].textContent());
  }
  await new Promise(r => setTimeout(r, 2000));

  console.log('Uploading PDF...');
  await p.locator('#resume_file').setInputFiles('/Users/shivam94/Documents/Resume/tailored/Honeywell_20260522/Resume_Shivam_Bhalla_Honeywell_20260522.pdf');
  console.log('Waiting 60s for extraction...');
  await new Promise(r => setTimeout(r, 60000));

  const result = await p.evaluate(() => {
    return new Promise(resolve => {
      chrome.storage.sync.get(['resume_full_data', 'profile_name', 'profile_email'], function(r) {
        const hasData = !!r.resume_full_data;
        let sections = 0, skills = 0, exp = 0, edu = 0;
        if (hasData) {
          try {
            const d = JSON.parse(r.resume_full_data);
            sections = Object.keys(d.rawSections || {}).length;
            skills = (d.rawSections.skills || []).length;
            exp = (d.rawSections.experience || []).length;
            edu = (d.rawSections.education || []).length;
          } catch(e) {}
        }
        resolve({ hasData, sections, skills, exp, edu, name: r.profile_name || '' });
      });
    });
  });

  console.log('hasData:', result.hasData, '| sections:', result.sections, '| skills:', result.skills, '| exp:', result.exp, '| edu:', result.edu);
  console.log('name:', result.name || '(empty)');
  
  if (result.hasData && result.name) {
    console.log('\n✅ PDF EXTRACTION WORKS');
  } else {
    const extractErr = await p.$eval('#extract-status', el => el.textContent).catch(() => '?');
    console.log('Extract status:', extractErr);
    console.log('Errors:', errors.length > 0 ? errors.slice(0, 2) : 'none');
    console.log('\n❌ FAILED');
  }

  await ctx.close();
} finally {
  try { rmSync(ud, { recursive: true, force: true }); } catch {}
}
