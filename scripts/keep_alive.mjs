import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extPath = path.resolve(__dirname, '..', 'extension');
const userDataDir = path.resolve(__dirname, '..', '.chrome-profile-pw');

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: null,
  args: [
    '--load-extension=' + extPath,
    '--disable-extensions-except=' + extPath,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    '--remote-debugging-port=9222',
  ],
  ignoreDefaultArgs: ['--disable-extensions'],
});

console.log('=== Chrome launcher running ===');
console.log('Extension loaded, remote debugging on port 9222');
console.log('Chrome will stay alive until you kill this process (Ctrl+C)');
console.log('');

const page = context.pages()[0] || await context.newPage();
for (const p of context.pages()) {
  console.log('Page:', p.url());
}

// Prevent any exit from closing Chrome
context.on('close', () => { console.log('WARNING: context closed unexpectedly'); });
process.on('SIGINT', () => { console.log('Use Ctrl+C again to actually quit.'); });
process.on('SIGTERM', () => { console.log('SIGTERM ignored — Chrome stays alive.'); });

// Keep alive
await new Promise(() => {});
