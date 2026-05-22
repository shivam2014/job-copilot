import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

const cwd = process.cwd();
const ud = mkdtempSync(join(tmpdir(), 'jc-si-'));
const ctx = await chromium.launchPersistentContext(ud, {
  channel: 'chromium', headless: true,
  args: ['--disable-extensions-except=' + cwd + '/extension', '--load-extension=' + cwd + '/extension', '--allow-insecure-localhost'],
});

try {
  const sw = await new Promise(r => ctx.on('serviceworker', r));
  const extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)[1];
  const p = await ctx.newPage();

  await p.goto('https://icfcjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Aerospace/job/111402', { waitUntil: 'networkidle', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // Click Apply Now
  await p.click('button:has-text("Apply Now")');
  await new Promise(r => setTimeout(r, 3000));

  // Enter email and click Next
  await p.fill('input[type="email"]', 'test@example.com');
  await p.click('button:has-text("Next")');
  await new Promise(r => setTimeout(r, 5000));

  // Check what appeared
  const pageContent = await p.evaluate(() => {
    const texts = Array.from(document.querySelectorAll('h1, h2, h3, label, span, p, a')).filter(el => el.offsetHeight > 0).map(el => (el.textContent || '').trim()).filter(t => t.length > 0);
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select')).filter(el => el.offsetHeight > 0).map(el => ({
      type: el.type || '',
      name: (el.name || el.id || '').substring(0, 40),
      placeholder: (el.placeholder || '').substring(0, 40),
      autocomplete: (el.autocomplete || '').substring(0, 30),
    }));
    return { texts: texts.slice(0, 20), inputs: inputs.slice(0, 20) };
  });

  console.log('Page texts:', pageContent.texts);
  console.log('\nForm inputs:', pageContent.inputs.length);
  pageContent.inputs.forEach(i => console.log('  type=' + i.type + ' name=' + i.name + ' place=' + i.placeholder + ' auto=' + i.autocomplete));

  await ctx.close();
} finally {
  try { rmSync(ud, { recursive: true, force: true }); } catch {}
}
