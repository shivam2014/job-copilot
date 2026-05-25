#!/usr/bin/env node
/**
 * JC Extension Live Demo Setup
 * 
 * Opens a visible Chrome window, loads the Job Copilot extension,
 * configures LLM settings, uploads resume, and extracts profile.
 * 
 * Profile is stored in the repo (not /tmp) so it persists.
 */

const { chromium } = require('playwright');

const EXT_PATH = '/Users/shivam94/job-copilot/extension';
const PROFILE_DIR = '/Users/shivam94/job-copilot/.chrome-profile';
const RESUME_PATH = '/Users/shivam94/Documents/Resume/tailored/Honeywell_20260522/Resume_Shivam_Bhalla_Honeywell_20260522.pdf';

(async () => {
  console.log('=== Job Copilot Extension Setup Demo ===\n');
  console.log('Profile dir:', PROFILE_DIR);
  console.log('Extension:', EXT_PATH);
  console.log('Resume:', RESUME_PATH);
  console.log('');

  console.log('Launching Chrome with Job Copilot extension...');
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
    ],
  });

  console.log('Chrome launched. Waiting for extension to load...');
  await new Promise(r => setTimeout(r, 3000));

  // Get extension ID from service worker
  const serviceWorkers = context.serviceWorkers();
  let extId = null;
  for (const sw of serviceWorkers) {
    const url = sw.url();
    const m = url.match(/chrome-extension:\/\/([a-z]+)/);
    if (m) extId = m[1];
  }

  if (!extId) {
    console.error('Could not detect extension ID. Service workers:', serviceWorkers.length);
    await context.close();
    return;
  }
  console.log('Extension ID:', extId);

  // Open options page
  const optionsUrl = `chrome-extension://${extId}/options/options.html`;
  console.log('\nOpening options page:', optionsUrl);

  const pages = context.pages();
  const optionsPage = pages.length > 0 ? pages[0] : await context.newPage();

  try {
    await optionsPage.goto(optionsUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
  } catch (e) {
    console.log('Navigation note:', e.message);
  }
  await optionsPage.waitForTimeout(2000);
  console.log('Options page loaded. URL:', await optionsPage.url());

  // Step 1: Fill LLM settings
  console.log('\n--- Step 1: Configuring LLM ---');
  await optionsPage.fill('#llm_base_url', 'http://localhost:19530/v1');
  console.log('✓ API Base URL set');

  await optionsPage.fill('#llm_api_key', 'dummy');
  console.log('✓ API Key set');

  // Click model field to load dropdown
  await optionsPage.click('#llm_model');
  console.log('✓ Clicked Model field (loading models...)');
  await optionsPage.waitForTimeout(3000);

  // Select deepseek-v4-flash-2
  const items = await optionsPage.locator('#model-dropdown .md-item').all();
  let selected = false;
  for (const item of items) {
    const text = await item.textContent();
    if (text && text.includes('deepseek-v4-flash-2')) {
      await item.click();
      selected = true;
      console.log('✓ Selected model: deepseek-v4-flash-2');
      break;
    }
  }

  if (!selected) {
    console.log('✗ Model not in dropdown, typing manually...');
    await optionsPage.fill('#llm_model', 'deepseek-v4-flash-2');
    await optionsPage.press('#llm_model', 'Enter');
  }

  await optionsPage.waitForTimeout(3000);
  const modelVal = await optionsPage.inputValue('#llm_model').catch(() => '');
  console.log('Model field value:', modelVal || '(empty)');

  // Step 2: Upload resume
  console.log('\n--- Step 2: Uploading Resume ---');
  console.log('Clicking upload area...');

  const [fileChooser] = await Promise.all([
    optionsPage.waitForEvent('filechooser', { timeout: 10000 }),
    optionsPage.click('#upload-area'),
  ]);

  await fileChooser.setFiles([RESUME_PATH]);
  console.log('✓ PDF selected:', RESUME_PATH.split('/').pop());

  // Step 3: Wait for extraction
  console.log('\n--- Step 3: Extracting Profile (this takes ~30s) ---');
  let completed = false;
  let lastStatus = '';

  for (let i = 0; i < 90; i++) {
    await optionsPage.waitForTimeout(1000);
    const status = await optionsPage.locator('#extract-status').textContent().catch(() => '');

    if (status !== lastStatus) {
      console.log(`  [${i}s] ${status}`);
      lastStatus = status;
    }

    if (status.includes('Extracted') || status.includes('✅')) {
      completed = true;
      console.log('✓ Extraction completed!');
      break;
    }
    if (status.includes('❌') || status.includes('Error')) {
      console.log('✗ Extraction failed:', status);
      break;
    }
  }

  if (!completed) {
    console.log('⚠ Extraction may still be in progress or failed');
  }

  // Step 4: Verify profile fields
  console.log('\n--- Step 4: Verifying Profile ---');
  const name = await optionsPage.inputValue('#profile_name').catch(() => '');
  const email = await optionsPage.inputValue('#profile_email').catch(() => '');
  const phone = await optionsPage.inputValue('#profile_phone').catch(() => '');

  console.log('Name:', name || '(empty)');
  console.log('Email:', email || '(empty)');
  console.log('Phone:', phone || '(empty)');

  // Check storage
  const storage = await optionsPage.evaluate(() =>
    new Promise(r => chrome.storage.sync.get(null, r))
  );
  console.log('Storage keys:', Object.keys(storage).join(', '));
  console.log('Has resume_full_data:', !!storage.resume_full_data);

  // Screenshot
  const screenshotPath = '/Users/shivam94/job-copilot/jc_setup_result.png';
  await optionsPage.screenshot({ path: screenshotPath, timeout: 10000 });
  console.log('\n✓ Screenshot saved:', screenshotPath);

  console.log('\n=== Setup Complete ===');
  console.log('Chrome window is open. You can now:');
  console.log('  1. Navigate to a job application page');
  console.log('  2. Click "Apply Now"');
  console.log('  3. Click the "JC" floating button to open the panel');
  console.log('  4. Click "Fill Personal Fields" to auto-fill your info');
  console.log('\nKeeping browser open. Press Ctrl+C here to close.');

  // Keep browser open indefinitely
  await new Promise(() => {});
})();
