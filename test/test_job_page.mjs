import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

const cwd = process.cwd();
const ud = mkdtempSync(join(tmpdir(), 'jc-jp-'));
const ctx = await chromium.launchPersistentContext(ud, {
  channel: 'chromium', headless: true,
  args: ['--disable-extensions-except=' + cwd + '/extension', '--load-extension=' + cwd + '/extension', '--allow-insecure-localhost'],
});

try {
  const sw = await new Promise(r => ctx.on('serviceworker', r));
  const extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)[1];
  const p = await ctx.newPage();

  // Navigate to the Oracle job page
  console.log('Navigating to Oracle job page...');
  await p.goto('https://icfcjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Aerospace/job/111402?utm_medium=jobboard&utm_source=linkedin', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 5000));

  console.log('Page title:', await p.title().catch(() => 'N/A'));

  // Check if extension's content script detects forms
  const hasJcButton = await p.$('#jc-float-btn');
  console.log('JC floating button detected:', !!hasJcButton);

  // Check for form fields
  const formFields = await p.evaluate(() => {
    const inputs = document.querySelectorAll('input, textarea, select');
    return Array.from(inputs).slice(0, 20).map(el => ({
      tag: el.tagName,
      type: el.type || '',
      name: (el.name || '').substring(0, 50),
      id: (el.id || '').substring(0, 50),
      placeholder: (el.placeholder || '').substring(0, 50),
    }));
  });
  console.log('Form fields found:', formFields.length);
  formFields.slice(0, 10).forEach(f => console.log('  ', f.tag, f.type, f.name || f.id || f.placeholder));

  // Check if "Apply" or "Sign in" buttons exist
  const buttons = await p.evaluate(() => {
    return Array.from(document.querySelectorAll('button, a')).filter(el => {
      const text = (el.textContent || '').toLowerCase();
      return text.includes('apply') || text.includes('sign in') || text.includes('register') || text.includes('create account');
    }).map(el => ({
      tag: el.tagName,
      text: (el.textContent || '').substring(0, 50),
      href: (el.href || '').substring(0, 80),
    }));
  });
  console.log('Action buttons:', buttons.length);
  buttons.forEach(b => console.log('  ', b.tag, b.text, b.href));

  await ctx.close();
} finally {
  try { rmSync(ud, { recursive: true, force: true }); } catch {}
}
