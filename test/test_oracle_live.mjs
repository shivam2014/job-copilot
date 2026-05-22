import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

const cwd = process.cwd();
const ud = mkdtempSync(join(tmpdir(), 'jc-ol-'));
const ctx = await chromium.launchPersistentContext(ud, {
  channel: 'chromium', headless: false,  // headed so we can see what's happening
  args: ['--disable-extensions-except=' + cwd + '/extension', '--load-extension=' + cwd + '/extension', '--allow-insecure-localhost', '--window-size=1280,800'],
});

try {
  const sw = await new Promise(r => ctx.on('serviceworker', r));
  const extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)[1];
  const p = await ctx.newPage();
  
  // Collect console messages from content script
  p.on('console', msg => {
    const text = msg.text();
    if (text.includes('JC:') || text.includes('Job Copilot') || text.includes('FormDetector') || text.includes('form') || text.includes('field')) {
      console.log(`[${msg.type()}] ${text.substring(0, 150)}`);
    }
  });
  p.on('pageerror', err => console.log('PAGE ERROR:', err.message.substring(0, 150)));

  // Step 1: Navigate to the Oracle job page
  console.log('\n=== STEP 1: Loading Oracle job page ===');
  await p.goto('https://icfcjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Aerospace/job/111402', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  // Check form detection
  let fields = await p.evaluate(() => {
    try {
      return FormDetector.detect();
    } catch(e) { return null; }
  }).catch(() => null);
  console.log('FormDetector accessible:', !!fields);

  // If FormDetector isn't accessible (scoped), read from the page
  const detectedViaJC = await p.evaluate(() => {
    const btn = document.getElementById('jc-float-btn');
    const panel = document.getElementById('jc-panel');
    return { hasBtn: !!btn, hasPanel: !!panel };
  });
  console.log('JC button:', detectedViaJC.hasBtn ? '✅' : '❌');
  console.log('JC panel:', detectedViaJC.hasPanel ? '✅' : '❌');

  // Manually detect forms via DOM inspection
  const allInputs = await p.evaluate(() => {
    return Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select')).map(el => ({
      tag: el.tagName,
      type: el.type || '',
      name: (el.name || '').substring(0, 40),
      id: (el.id || '').substring(0, 40),
      placeholder: (el.placeholder || '').substring(0, 40),
      autocomplete: (el.autocomplete || '').substring(0, 30),
      ariaLabel: (el.getAttribute('aria-label') || '').substring(0, 40),
      required: el.required || el.hasAttribute('required'),
      visible: el.offsetHeight > 0,
    })).filter(f => f.visible);
  });
  console.log(`\nVisible form fields on page: ${allInputs.length}`);
  allInputs.forEach(f => console.log(`  ${f.tag} ${f.type} name="${f.name}" auto="${f.autocomplete}" req="${f.required}"`));

  // Check action buttons
  const actions = await p.evaluate(() => {
    return Array.from(document.querySelectorAll('button, a')).filter(el => el.offsetHeight > 0).map(el => ({
      tag: el.tagName,
      text: (el.textContent || '').trim().substring(0, 40),
      href: (el.href || '').substring(0, 60),
    })).filter(a => a.text || a.href);
  });
  console.log(`\nAction buttons: ${actions.length}`);
  actions.forEach(a => console.log(`  ${a.tag}: "${a.text}" ${a.href ? '→ ' + a.href : ''}`));

  // Step 2: Click Apply Now
  console.log('\n=== STEP 2: Clicking Apply Now ===');
  const applyBtn = await p.$('button:has-text("Apply Now")');
  if (applyBtn) {
    await applyBtn.click();
    await new Promise(r => setTimeout(r, 4000));
    
    const step2Inputs = await p.evaluate(() => {
      return Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select')).filter(el => el.offsetHeight > 0).map(el => ({
        tag: el.tagName,
        type: el.type || '',
        name: (el.name || '').substring(0, 40),
        placeholder: (el.placeholder || '').substring(0, 40),
        autocomplete: (el.autocomplete || '').substring(0, 30),
        required: el.required || el.hasAttribute('required'),
      }));
    });
    console.log(`Form fields after Apply: ${step2Inputs.length}`);
    step2Inputs.forEach(f => console.log(`  ${f.tag} ${f.type} name="${f.name}" place="${f.placeholder}" auto="${f.autocomplete}" req="${f.required}"`));
    
    // Check JC re-detection
    await new Promise(r => setTimeout(r, 2500));
    const jcAfter = await p.evaluate(() => !!document.getElementById('jc-float-btn'));
    console.log('JC button still present:', jcAfter ? '✅' : '❌');
  }

  // Keep browser open for 2 minutes for manual inspection
  console.log('\n=== Keeping browser open for 120s for manual inspection ===');
  await new Promise(r => setTimeout(r, 120000));

  await ctx.close();
} finally {
  try { rmSync(ud, { recursive: true, force: true }); } catch {}
}
