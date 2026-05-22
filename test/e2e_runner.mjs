// E2E Test Runner — Playwright with correct Chrome Extension support
// Key: channel:'chromium' + launchPersistentContext (per Playwright docs)
// Run: node test/e2e_runner.mjs

import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_PATH = join(__dirname, '..', 'extension');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('='.repeat(60));
  console.log('  Job Copilot — E2E Tests');
  console.log('='.repeat(60));
  console.log(`  Extension: ${EXT_PATH}\n`);

  const userDataDir = mkdtempSync(join(tmpdir(), 'jc-e2e-'));

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',  // REQUIRED for headless extension support
    headless: true,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
    ],
  });

  try {
    // Wait for extension service worker to register
    const swPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for service worker')), 15000);
      context.on('serviceworker', sw => {
        clearTimeout(timeout);
        resolve(sw);
      });
    });

    // Open a page to trigger extension loading
    const page = await context.newPage();
    await page.goto('about:blank');
    
    const sw = await swPromise;
    const swUrl = sw.url();
    const extMatch = swUrl.match(/chrome-extension:\/\/([^/]+)/);
    if (!extMatch) throw new Error(`Could not parse extension ID from: ${swUrl}`);
    const extId = extMatch[1];
    
    console.log(`  Ext ID: ${extId}`);
    console.log(`  SW: ${swUrl.split('/').pop()}\n`);

    // ====== TESTS ======
    const tests = [
      async () => {
        const p = await context.newPage();
        await p.goto(`chrome-extension://${extId}/options/options.html`);
        await p.waitForSelector('#llm_base_url', { timeout: 5000 });
        await p.waitForSelector('#extract-btn');
        await p.waitForSelector('#save-btn');
        await p.waitForSelector('#upload-area');
        await p.waitForSelector('#profile_name');
        await p.waitForSelector('#show-paste-link');
        await p.waitForSelector('#model-count');
        await p.waitForSelector('#reset-tokens-btn');
        await p.waitForSelector('#saved-answers-list');
        const title = await p.title();
        if (!title.includes('Job Copilot')) throw new Error(`Title: ${title}`);
        await p.close();
        return 'All 9+ elements render on options page';
      },

      async () => {
        const p = await context.newPage();
        await p.goto(`chrome-extension://${extId}/options/options.html`);
        
        // Textarea hidden
        const hidden = await p.$eval('#resume_text', el => el.style.display === 'none');
        if (!hidden) throw new Error('Textarea should be hidden');
        
        // Click paste link
        await p.click('#show-paste-link');
        await sleep(200);
        
        // Textarea visible
        const visible = await p.$eval('#resume_text', el => el.style.display !== 'none');
        if (!visible) throw new Error('Textarea should be visible after click');
        
        await p.close();
        return 'Paste link reveals textarea ✅';
      },

      async () => {
        const p = await context.newPage();
        await p.goto(`chrome-extension://${extId}/options/options.html`);
        
        // Fill LLM config
        await p.fill('#llm_base_url', 'http://localhost:19530/v1');
        await p.fill('#llm_api_key', 'dummy');
        await p.fill('#llm_model', 'deepseek-v4-flash-2');
        
        // Verify
        const url = await p.$eval('#llm_base_url', el => el.value);
        if (!url.includes('localhost')) throw new Error(`URL: ${url}`);
        
        await p.close();
        return 'LLM config fields accept values';
      },

      async () => {
        const p = await context.newPage();
        await p.goto(`chrome-extension://${extId}/options/options.html`);
        
        const fields = ['profile_name', 'profile_email', 'profile_phone', 'profile_linkedin', 'profile_github', 'profile_address', 'profile_skills', 'profile_languages', 'profile_summary'];
        for (const id of fields) {
          await p.fill(`#${id}`, 'test-value');
          const val = await p.$eval(`#${id}`, el => el.value);
          if (val !== 'test-value') throw new Error(`${id} value: ${val}`);
        }
        
        await p.close();
        return `${fields.length} profile fields accept input`;
      },

      async () => {
        const p = await context.newPage();
        await p.goto(`chrome-extension://${extId}/options/options.html`);
        
        const extractEnabled = await p.$eval('#extract-btn', el => !el.disabled);
        if (!extractEnabled) throw new Error('Extract btn disabled');
        
        const saveText = await p.$eval('#save-btn', el => el.textContent);
        if (!saveText.includes('Auto-save')) throw new Error('Save btn: ' + saveText);
        
        await p.close();
        return 'Buttons enabled with correct text';
      },
    ];

    let passed = 0;
    let failed = 0;
    for (const testFn of tests) {
      try {
        const msg = await testFn();
        console.log(`  ✅ ${msg}`);
        passed++;
      } catch (err) {
        console.log(`  ❌ ${err.message}`);
        failed++;
      }
    }

    console.log(`\n  📊 ${passed} passed, ${failed} failed, ${tests.length} total`);
    process.exit(failed > 0 ? 1 : 0);
  } finally {
    await context.close();
    // Cleanup temp dir
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
}

main();
