import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
const cwd = process.cwd();
const ud = mkdtempSync(join(tmpdir(), 'jc-cc-'));
const ctx = await chromium.launchPersistentContext(ud, {
  channel: 'chromium', headless: true,
  args: ['--disable-extensions-except=' + cwd + '/extension', '--load-extension=' + cwd + '/extension'],
});
try {
  const sw = await new Promise(r => ctx.on('serviceworker', r));
  const extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)[1];
  const p = await ctx.newPage();
  await p.goto('chrome-extension://' + extId + '/options/options.html');
  await new Promise(r => setTimeout(r, 2000));
  
  // Set test data
  await p.evaluate(() => new Promise(r => chrome.storage.sync.set({
    resume_full_data: JSON.stringify({
      rawSections: {
        experience: [{ title: 'Engineer', company: 'Corp' }]
      },
      extractedFields: {}
    })
  }, r)));
  await p.reload();
  await new Promise(r => setTimeout(r, 3000));
  
  const html = await p.$eval('#rd-experience-list', el => el.innerHTML);
  // Check if buttons are in a flex row with the content
  const hasFlexRow = html.includes('display:flex') && html.includes('justify-content');
  const hasEditInline = html.includes('rd-card-edit') && !html.trimStart().startsWith('<button');
  console.log('Flex layout:', hasFlexRow);
  console.log('Edit btn inline:', html.includes('rd-card-edit'));
  console.log('HTML snippet:', html.substring(0, 300));
  
  await ctx.close();
} finally {
  try { rmSync(ud, { recursive: true, force: true }); } catch {}
}
