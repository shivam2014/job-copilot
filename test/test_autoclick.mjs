import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

const cwd = process.cwd();
const ud = mkdtempSync(join(tmpdir(), 'jc-ac-'));
const ctx = await chromium.launchPersistentContext(ud, {
  channel: 'chromium', headless: false,
  args: ['--disable-extensions-except=' + cwd + '/extension', '--load-extension=' + cwd + '/extension', '--allow-insecure-localhost', '--window-size=1280,900'],
});

try {
  const sw = await new Promise(r => ctx.on('serviceworker', r));
  const extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)[1];
  const p = await ctx.newPage();

  p.on('console', msg => {
    const t = msg.text();
    if (t.includes('JC:') || t.includes('🔍') || t.includes('FormDetector') || msg.type() === 'error') {
      console.log('[' + msg.type() + '] ' + t.substring(0, 150));
    }
  });

  console.log('Loading Oracle job page...');
  await p.goto('https://icfcjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Aerospace/job/111402', { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // Wait for auto-click (2s delay + 4s page load)
  await new Promise(r => setTimeout(r, 8000));
  
  // Check if "Apply Now" was clicked (sign-in form should appear)
  const emailInput = await p.$('input[type="email"]');
  console.log('Email input visible after auto-click:', emailInput ? '✅ YES' : '❌ NO');
  
  if (emailInput) {
    const placeholder = await emailInput.getAttribute('placeholder') || '';
    const name = await emailInput.getAttribute('name') || '';
    console.log('Email field:', name, placeholder);
    
    // Form detection report
    const fields = await p.evaluate(() => {
      // Check JC panel content
      const stats = document.getElementById('jc-stats');
      return stats ? stats.textContent : 'no JC stats';
    }).catch(() => 'page error');
    console.log('JC stats:', fields);
  }

  console.log('\nBrowser open. Tell me email to use.');
  await new Promise(r => setTimeout(r, 600000));
  await ctx.close();
} finally {
  try { rmSync(ud, { recursive: true, force: true }); } catch {}
}
