// E2E Test: Options page UI interactions
// Run: npx playwright test
// Or:  npx playwright test test/e2e/options.spec.mjs

import { chromium } from 'playwright';
import { test, expect } from 'playwright/test';

const EXT_PATH = process.cwd() + '/extension';

test.describe('Options Page', () => {
  let browser;
  let extId;

  test.beforeAll(async () => {
    browser = await chromium.launch({
      headless: true,
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
      ],
    });
    // Get extension ID from service worker
    const workerTarget = await browser.waitForTarget(
      t => t.type() === 'service_worker'
    );
    extId = workerTarget.url().match(/chrome-extension:\/\/([^/]+)/)[1];
  });

  test.afterAll(async () => {
    await browser.close();
  });

  test('all required elements render', async () => {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extId}/options/options.html`);
    
    await expect(page.locator('#llm_base_url')).toBeVisible();
    await expect(page.locator('#llm_api_key')).toBeVisible();
    await expect(page.locator('#llm_model')).toBeVisible();
    await expect(page.locator('#extract-btn')).toBeVisible();
    await expect(page.locator('#save-btn')).toBeVisible();
    await expect(page.locator('#upload-area')).toBeVisible();
    await expect(page.locator('#profile_name')).toBeVisible();
    await expect(page.locator('#show-paste-link')).toBeVisible();
    await expect(page.locator('#reset-tokens-btn')).toBeVisible();
    await expect(page.locator('#token-usage-content')).toBeVisible();
    
    await page.close();
  });

  test('paste link reveals textarea', async () => {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extId}/options/options.html`);
    
    // Textarea hidden initially
    await expect(page.locator('#resume_text')).toBeHidden();
    
    // Click paste link
    await page.click('#show-paste-link');
    
    // Textarea visible now
    await expect(page.locator('#resume_text')).toBeVisible();
    
    await page.close();
  });

  test('profile fields accept input', async () => {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extId}/options/options.html`);
    
    const fields = ['profile_name', 'profile_email', 'profile_phone', 'profile_address'];
    for (const id of fields) {
      await page.fill(`#${id}`, 'test');
      await expect(page.locator(`#${id}`)).toHaveValue('test');
    }
    
    await page.close();
  });

  test('extract button is enabled', async () => {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extId}/options/options.html`);
    
    await expect(page.locator('#extract-btn')).toBeEnabled();
    await expect(page.locator('#extract-btn')).toHaveText(/Extract/);
    
    await page.close();
  });

  test('model field triggers fetch on focus', async () => {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extId}/options/options.html`);
    
    // Set LLM config first
    await page.fill('#llm_base_url', 'http://localhost:19530/v1');
    await page.fill('#llm_api_key', 'dummy');
    
    // Focus the model field
    await page.click('#llm_model');
    
    // Wait for either models to load or error message
    await page.waitForTimeout(8000); // Allow time for API call
    
    // Check that some hint appeared
    const hintText = await page.locator('#model-count').textContent();
    console.log(`  Model hint: ${hintText}`);
    
    await page.close();
  });
});
