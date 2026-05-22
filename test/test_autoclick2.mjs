import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';

// Create a test HTML page with an Apply Now button
const testHtml = '/tmp/test_apply.html';
writeFileSync(testHtml, '<html><body><button>Apply Now</button><p>Job description here</p></body></html>');

const cwd = process.cwd();
const ud = mkdtempSync(join(tmpdir(), 'jc-ac2-'));
const ctx = await chromium.launchPersistentContext(ud, {
  channel: 'chromium', headless: true,
  args: ['--disable-extensions-except=' + cwd + '/extension', '--load-extension=' + cwd + '/extension', '--allow-insecure-localhost'],
});

try {
  const sw = await new Promise(r => ctx.on('serviceworker', r));
  const extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)[1];
  const p = await ctx.newPage();
  
  const logs = [];
  p.on('console', msg => { if (msg.text().includes('JC:')) logs.push(msg.text()); });
  
  await p.goto('file://' + testHtml, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 5000));
  
  console.log('Auto-click logs:', logs.length > 0 ? logs : '(none)');
  
  // Check if Apply Now was clicked - the button might have been removed or page navigated
  // Since it's a local file, clicking won't navigate anywhere
  const applyBtn = await p.$('button');
  console.log('Apply Now button still exists:', !!applyBtn);
  
  if (logs.length > 0) {
    console.log('✅ Auto-click WORKS');
  } else {
    console.log('❌ Auto-click did not fire');
  }

  await ctx.close();
} finally {
  try { rmSync(ud, { recursive: true, force: true }); } catch {}
}
