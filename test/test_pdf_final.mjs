import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

const cwd = process.cwd();
const ud = mkdtempSync(join(tmpdir(), 'jc-pf-'));
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
  p.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text().substring(0, 100)); });

  await p.goto('chrome-extension://' + extId + '/options/options.html');
  await new Promise(r => setTimeout(r, 2000));

  await p.fill('#llm_base_url', 'http://localhost:19530/v1');
  await p.fill('#llm_api_key', 'dummy');
  await p.click('#llm_model');
  await new Promise(r => setTimeout(r, 5000));
  const items = await p.locator('.md-item').all();
  if (items.length > 0) await items[0].click();
  await new Promise(r => setTimeout(r, 1000));

  console.log('Uploading PDF...');
  await p.locator('#resume_file').setInputFiles('/Users/shivam94/Documents/Resume/tailored/Honeywell_20260522/Resume_Shivam_Bhalla_Honeywell_20260522.pdf');
  console.log('Waiting 60s...');
  await new Promise(r => setTimeout(r, 60000));

  const result = await p.evaluate(() => {
    return new Promise(resolve => {
      chrome.storage.sync.get(['resume_full_data', 'profile_name', 'profile_email', 'rd_summary'], function(r) {
        const hasData = !!r.resume_full_data;
        let sections = 0, skills = 0, expCount = 0;
        if (hasData) {
          try {
            const d = JSON.parse(r.resume_full_data);
            sections = Object.keys(d.rawSections || {}).length;
            skills = (d.rawSections.skills || []).length;
            expCount = (d.rawSections.experience || []).length;
          } catch(e) {}
        }
        resolve({ hasData, len: r.resume_full_data ? r.resume_full_data.length : 0, sections, skills, expCount, name: r.profile_name || '', email: r.profile_email || '' });
      });
    });
  });

  console.log('resume_full_data:', result.hasData, 'len:', result.len);
  console.log('sections:', result.sections, 'skills:', result.skills, 'exp:', result.expCount);
  console.log('profile name:', result.name, 'email:', result.email);
  console.log('errors:', errors.length > 0 ? errors.slice(0, 3) : 'none');

  if (result.hasData && result.name) {
    console.log('\n✅ PDF EXTRACTION WORKS');
  } else {
    console.log('\n❌ FAILED');
  }

  await ctx.close();
} finally {
  try { rmSync(ud, { recursive: true, force: true }); } catch {}
}
