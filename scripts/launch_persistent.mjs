// Launch Chrome with persistent profile, JC extension, and open Bitwarden Web Store
import { chromium } from 'playwright';
import { join } from 'path';

const PROFILE_DIR = join(process.cwd(), '.chrome-profile');
const EXT_PATH = join(process.cwd(), 'extension');
const BITWARDEN_URL = 'https://chromewebstore.google.com/detail/bitwarden-password-manage/nngceckbapebfimnlniiiahkandclblb';
const JC_OPTIONS_URL = 'chrome-extension://EXT_ID/options/options.html';

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  channel: 'chromium',
  headless: false,
  args: [
    '--load-extension=' + EXT_PATH,
    '--no-first-run',
    '--window-size=1280,900',
    '--disable-sync',
  ],
});

// Wait for JC extension to register its service worker
console.log('Waiting for JC extension service worker...');
let extId = null;

const swPromise = new Promise(resolve => {
  const handler = sw => {
    const m = sw.url().match(/chrome-extension:\/\/([^/]+)/);
    if (m && m[1] !== 'ghbmnnjooekpmoecnnnilnnbdlolhkhi') {  // not Google Docs Offline
      clearTimeout(timer);
      resolve(m[1]);
    }
  };
  ctx.on('serviceworker', handler);
  const timer = setTimeout(() => { ctx.off('serviceworker', handler); resolve(null); }, 10000);
});

// Open a blank page to trigger SW registration
const p = await ctx.newPage();
await p.goto('about:blank', { waitUntil: 'domcontentloaded' });

extId = await swPromise;

if (!extId) {
  console.log('Could not detect JC extension ID via SW event, checking service workers...');
  for (const sw of ctx.serviceWorkers()) {
    const m = sw.url().match(/chrome-extension:\/\/([^/]+)/);
    if (m && m[1] !== 'ghbmnnjooekpmoecnnnilnnbdlolhkhi') {
      extId = m[1];
      break;
    }
  }
}

console.log('JC Extension ID:', extId || 'NOT FOUND');

// Verify JC extension loaded by checking its options page
if (extId) {
  try {
    const optionsUrl = `chrome-extension://${extId}/options/options.html`;
    await p.goto(optionsUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await new Promise(r => setTimeout(r, 1000));
    const pageTitle = await p.title();
    console.log('JC Options page title:', pageTitle);
    
    // Navigate to Bitwarden Web Store
    await p.goto(BITWARDEN_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));
    console.log('Navigated to Bitwarden Chrome Web Store page');
  } catch(e) {
    console.log('Navigation note:', e.message.substring(0, 100));
    // Still navigate to Bitwarden
    await p.goto(BITWARDEN_URL, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  }
} else {
  // Go to Bitwarden directly
  await p.goto(BITWARDEN_URL, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
}

console.log('\n✓ Chrome launched with persistent profile');
console.log('  Profile: ' + PROFILE_DIR);
console.log('  JC Extension: ' + (extId ? 'LOADED (ID: ' + extId + ')' : 'NOT DETECTED'));
console.log('  Bitwarden: Web Store page opened for installation');
console.log('\nBrowser will remain open. Press Ctrl+C in terminal to close.');

// Keep alive - wait indefinitely
await new Promise(() => {});
