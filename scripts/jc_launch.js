// JC Launch: persistent profile, JC extension loaded, Bitwarden page opened
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '..', '.chrome-profile');
const EXT = path.join(__dirname, '..', 'extension');
const EXT_ID_FILE = path.join(__dirname, '..', '.ext_id');

async function main() {
  console.log('[JC] Launching Chrome with persistent profile...');
  console.log('[JC] Profile:', PROFILE);
  console.log('[JC] Extension:', EXT);

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chromium',
    headless: false,
    args: [
      '--load-extension=' + EXT,
      '--no-first-run',
      '--window-size=1280,900',
    ],
  });

  console.log('[JC] Context created, waiting for extension registration...');

  // Wait for extension service worker
  const extId = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    ctx.on('serviceworker', (sw) => {
      const m = sw.url().match(/chrome-extension:\/\/([^/]+)/);
      if (m && m[1] !== 'ghbmnnjooekpmoecnnnilnnbdlolhkhi') {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
  });

  // Fallback: check existing service workers
  let finalExtId = extId;
  if (!finalExtId) {
    for (const sw of ctx.serviceWorkers()) {
      const m = sw.url().match(/chrome-extension:\/\/([^/]+)/);
      if (m && m[1] !== 'ghbmnnjooekpmoecnnnilnnbdlolhkhi') {
        finalExtId = m[1];
        break;
      }
    }
  }

  // Save extension ID for future reference
  if (finalExtId) {
    fs.writeFileSync(EXT_ID_FILE, finalExtId);
    console.log('[JC] Extension ID:', finalExtId);
  } else {
    console.log('[JC] WARNING: Could not detect JC extension ID');
  }

  // Open a tab
  const page = await ctx.newPage();
  
  if (finalExtId) {
    console.log('[JC] Checking JC options page...');
    try {
      await page.goto('chrome-extension://' + finalExtId + '/options/options.html', {
        waitUntil: 'domcontentloaded',
        timeout: 8000,
      });
      await page.waitForTimeout(1000);
      console.log('[JC] Options page loaded:', await page.title());
    } catch (e) {
      console.log('[JC] Options page check:', e.message.slice(0, 80));
    }
  }

  // Navigate to Bitwarden Chrome Web Store
  console.log('[JC] Opening Bitwarden Chrome Web Store page...');
  await page.goto(
    'https://chromewebstore.google.com/detail/bitwarden-password-manage/nngceckbapebfimnlniiiahkandclblb',
    { waitUntil: 'domcontentloaded', timeout: 15000 }
  );
  await page.waitForTimeout(2000);
  
  const pageUrl = await page.url();
  console.log('[JC] Current URL:', pageUrl);
  
  console.log('\n=== LAUNCH COMPLETE ===');
  console.log('  Profile: ' + PROFILE);
  console.log('  JC Extension: ' + (finalExtId ? '✅ LOADED (ID: ' + finalExtId + ')' : '❌ NOT FOUND'));
  console.log('  Bitwarden: ' + (pageUrl.includes('chromewebstore') ? '📄 Page opened for install' : '⚠️ Navigation issue'));
  console.log('  Tip: Click "Add to Chrome" on the Bitwarden page to install the extension.');
  console.log('\nBrowser will stay open. Press Ctrl+C in terminal to close.');

  // Keep alive
  await new Promise(() => {});
}

main().catch(err => {
  console.error('[JC] FATAL:', err.message, err.stack);
  process.exit(1);
});
