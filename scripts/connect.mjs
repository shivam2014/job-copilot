import { chromium } from 'playwright';

// Connect to the running Chrome via CDP — does NOT own the browser process.
// Exiting this script does NOT close Chrome.
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const pages = ctx.pages();

console.log('Connected to running Chrome');
console.log('Pages:', pages.length);
for (const p of pages) console.log('  ', p.url());

// Export for use
export { browser, ctx, pages };
