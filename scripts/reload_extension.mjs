#!/usr/bin/env node
/**
 * reload_extension.mjs — Reload the JC extension and optionally refresh the Oracle page.
 *
 * Usage:
 *   node scripts/reload_extension.mjs              # reload ext + refresh Oracle page
 *   node scripts/reload_extension.mjs --ext-only    # reload ext only, skip page refresh
 *
 * How it works:
 *   1. Connects to Chrome via Playwright CDP
 *   2. Opens chrome://extensions, finds the JC extension card via shadow DOM
 *   3. Clicks the dev-reload-button
 *   4. (default) Reloads the Oracle CX page so the new content script injects
 *
 * Key learning: After reloading the extension, you MUST reload the target
 * page — otherwise the old content script keeps running from the previous load.
 */

import { chromium } from 'playwright';

const extOnly = process.argv.includes('--ext-only');

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];

// 1. Open chrome://extensions in a temp tab
console.log('Opening chrome://extensions...');
const extPage = await ctx.newPage();
await extPage.goto('chrome://extensions', { waitUntil: 'domcontentloaded' });
await extPage.waitForTimeout(2000);

// 2. Find the JC extension and click reload via shadow DOM
const result = await extPage.evaluate(() => {
  const manager = document.querySelector('extensions-manager');
  if (!manager) return { error: 'extensions-manager not found' };

  const itemList = manager.shadowRoot?.querySelector('extensions-item-list');
  if (!itemList) return { error: 'extensions-item-list not found' };

  const cards = itemList.shadowRoot?.querySelectorAll('extensions-item');
  if (!cards || cards.length === 0) return { error: 'no extension cards' };

  for (const card of cards) {
    const name = card.shadowRoot?.querySelector('#name')?.textContent?.trim() || '';
    // Match "Job Copilot" or anything with "jc" / "copilot"
    if (/job.?copilot|jc\b/i.test(name)) {
      const reloadBtn = card.shadowRoot?.querySelector('#dev-reload-button');
      if (!reloadBtn) return { error: 'reload button not found', name };
      reloadBtn.click();
      return { ok: true, name };
    }
  }
  return { error: 'JC extension not found', names: Array.from(cards).map(c => c.shadowRoot?.querySelector('#name')?.textContent?.trim()) };
});

await extPage.waitForTimeout(1500);
await extPage.close();

if (result.error) {
  console.error('Extension reload FAILED:', result.error);
  if (result.names) console.error('  Available extensions:', result.names.join(', '));
  process.exit(1);
}

console.log(`Extension reloaded: "${result.name}"`);

// 3. Reload the Oracle page (unless --ext-only)
if (extOnly) {
  console.log('--ext-only: skipping page refresh');
} else {
  const oraclePage = ctx.pages().find(p => p.url().includes('oraclecloud'));
  if (oraclePage) {
    console.log('Refreshing Oracle page...');
    await oraclePage.reload({ waitUntil: 'domcontentloaded' });
    // Wait for content script to inject (Oracle renders async)
    await oraclePage.waitForTimeout(6000);
    console.log('Oracle page refreshed:', oraclePage.url());
  } else {
    console.log('No Oracle page open — skipping page refresh');
  }
}

console.log('Done.');
process.exit(0);
