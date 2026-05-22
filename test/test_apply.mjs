import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

const cwd = process.cwd();
const ud = mkdtempSync(join(tmpdir(), 'jc-ap-'));
const ctx = await chromium.launchPersistentContext(ud, {
  channel: 'chromium', headless: true,
  args: ['--disable-extensions-except=' + cwd + '/extension', '--load-extension=' + cwd + '/extension', '--allow-insecure-localhost'],
});

try {
  const sw = await new Promise(r => ctx.on('serviceworker', r));
  const extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)[1];
  const p = await ctx.newPage();
  const logs = [];
  p.on('console', msg => logs.push(msg.text().substring(0, 200)));

  await p.goto('https://icfcjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Aerospace/job/111402', { waitUntil: 'networkidle', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // Click "Apply Now"
  const applyBtn = await p.$('button:has-text("Apply Now")');
  if (applyBtn) {
    console.log('Clicking Apply Now...');
    await applyBtn.click();
    await new Promise(r => setTimeout(r, 5000));
    
    // Check what appeared
    const fields = await p.evaluate(() => {
      return Array.from(document.querySelectorAll('input, textarea, select, button')).map(el => ({
        tag: el.tagName,
        type: el.type || '',
        text: (el.textContent || '').substring(0, 40),
        name: (el.name || '').substring(0, 40),
        id: (el.id || '').substring(0, 40),
        placeholder: (el.placeholder || '').substring(0, 40),
        visible: el.offsetHeight > 0 && el.offsetWidth > 0,
      })).filter(f => f.visible);
    });
    console.log('Visible interactive elements after Apply:', fields.length);
    fields.slice(0, 15).forEach(f => console.log('  ' + f.tag + ' ' + (f.text || f.placeholder || f.name || f.id)));
    
    // Check JC floating button still there
    const jcBtn = await p.$('#jc-float-btn');
    console.log('\nJC button still visible:', !!jcBtn);
    
    // Check JC form detection
    const jcFields = await p.evaluate(() => {
      if (typeof FormDetector === 'undefined') return null;
      return FormDetector.debugLog ? 'has debug' : 'no debug';
    }).catch(() => 'no FormDetector');
    console.log('FormDetector accessible:', jcFields);
  } else {
    console.log('No Apply Now button found');
  }

  await ctx.close();
} finally {
  try { rmSync(ud, { recursive: true, force: true }); } catch {}
}
