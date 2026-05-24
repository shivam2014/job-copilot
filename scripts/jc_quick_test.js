#!/usr/bin/env node
/**
 * JC Quick Test — Reusable script for testing the extension on Oracle
 *
 * Reuses the persistent Chrome profile so resume/LLM config are already set.
 * Use this for rapid iteration: edit extension code, save, run this script.
 *
 * Usage:
 *   cd /Users/shivam94/job-copilot && node scripts/jc_quick_test.js
 *
 * Flags:
 *   --headless     Run without visible browser window
 *   --no-apply     Skip clicking Apply Now
 *   --open-panel   Auto-open the JC panel
 *   --fill         Auto-click Fill Personal
 */

const { chromium } = require('playwright');

const EXT_PATH = '/Users/shivam94/job-copilot/extension';
const PROFILE_DIR = '/tmp/jc-playwright-profile-v4';
const ORACLE_URL = 'https://icfcjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Aerospace/job/111402';

const args = process.argv.slice(2);
const HEADLESS = args.includes('--headless');
const NO_APPLY = args.includes('--no-apply');
const OPEN_PANEL = args.includes('--open-panel');
const FILL = args.includes('--fill');

(async () => {
  console.log('Launching Chrome with Job Copilot extension...');
  console.log('  Profile:', PROFILE_DIR);
  console.log('  Extension:', EXT_PATH);
  console.log('  Headless:', HEADLESS);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: HEADLESS,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
    ],
  });

  await new Promise(r => setTimeout(r, 3000));

  const serviceWorkers = context.serviceWorkers();
  let extId = null;
  for (const sw of serviceWorkers) {
    const m = sw.url().match(/chrome-extension:\/\/([a-z]+)/);
    if (m) extId = m[1];
  }
  console.log('Extension ID:', extId || 'unknown');

  const oraclePage = await context.newPage();
  await oraclePage.goto(ORACLE_URL);
  await oraclePage.waitForTimeout(4000);
  console.log('Oracle page loaded');

  let state = await oraclePage.evaluate(() => ({
    hasBtn: !!document.getElementById('jc-float-btn'),
    hasPanel: !!document.getElementById('jc-panel'),
    panelOpen: document.getElementById('jc-panel')?.classList.contains('open') || false,
  }));
  console.log('JC state:', JSON.stringify(state));

  if (!NO_APPLY) {
    const applyNow = oraclePage.locator('text=/Apply Now/i');
    if (await applyNow.isVisible().catch(() => false)) {
      await applyNow.click();
      console.log('Apply Now clicked');
      await oraclePage.waitForTimeout(5000);
    } else {
      console.log('Apply Now button not visible');
    }
  }

  if (OPEN_PANEL && state.hasBtn) {
    await oraclePage.click('#jc-float-btn');
    await oraclePage.waitForTimeout(800);
    console.log('JC panel opened');
  }

  state = await oraclePage.evaluate(() => ({
    hasBtn: !!document.getElementById('jc-float-btn'),
    panelOpen: document.getElementById('jc-panel')?.classList.contains('open') || false,
    stats: document.getElementById('jc-stats')?.innerText?.trim() || null,
  }));
  console.log('JC state after:', JSON.stringify(state));

  if (FILL) {
    await oraclePage.evaluate(() => {
      const btn = document.getElementById('jc-fill-personal');
      if (btn) btn.click();
    });
    await oraclePage.waitForTimeout(2000);
    const email = await oraclePage.evaluate(() => {
      const el = document.querySelector('input[name="primary-email"]');
      return el ? el.value : null;
    });
    console.log('Email after fill:', email);
  }

  await oraclePage.screenshot({ path: '/tmp/jc_quick_test.png', timeout: 5000 });
  console.log('Screenshot saved: /tmp/jc_quick_test.png');

  if (!HEADLESS) {
    console.log('Browser staying open for 15 seconds...');
    await new Promise(r => setTimeout(r, 15000));
  }

  await context.close();
  console.log('Done.');
})();
