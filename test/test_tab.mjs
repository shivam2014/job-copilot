import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
const cwd = process.cwd();
const ud = mkdtempSync(join(tmpdir(), 'jc-tb-'));
const ctx = await chromium.launchPersistentContext(ud, {
  channel: 'chromium', headless: true,
  args: ['--disable-extensions-except=' + cwd + '/extension', '--load-extension=' + cwd + '/extension'],
});
try {
  const sw = await new Promise(r => ctx.on('serviceworker', r));
  const extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)[1];
  const p = await ctx.newPage();
  await p.goto('chrome-extension://' + extId + '/options/options.html');
  await new Promise(r => setTimeout(r, 3000));

  // Click "Add Experience" to show the form
  await p.click('#rd-exp-show-form');
  await new Promise(r => setTimeout(r, 500));

  // Check if the form is visible
  const formVisible = await p.$eval('#rd-exp-form', el => el.style.display);
  console.log('Experience form visible:', formVisible);

  // Focus the month select and type "Oc"
  const monthSelect = await p.$('#rd-exp-start');
  if (monthSelect) {
    await monthSelect.focus();
    console.log('Month select focused');
    
    // Type "Oc" - native select should jump to October
    await monthSelect.press('o');
    await new Promise(r => setTimeout(r, 300));
    const val = await monthSelect.evaluate(el => el.value);
    console.log('After typing "o":', val);
    
    await monthSelect.press('c');
    await new Promise(r => setTimeout(r, 300));
    const val2 = await monthSelect.evaluate(el => el.value);
    console.log('After typing "c":', val2);
    
    // Press Tab to go to year
    await monthSelect.press('Tab');
    await new Promise(r => setTimeout(r, 300));
    
    // Check which element is now focused
    const focusedId = await p.evaluate(() => document.activeElement?.id || 'none');
    console.log('Focused element after Tab:', focusedId);
  }

  await ctx.close();
} finally {
  try { rmSync(ud, { recursive: true, force: true }); } catch {}
}
