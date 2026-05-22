import { defineConfig } from '@playwright/test';
export default defineConfig({
  testMatch: '**/e2e/*.spec.mjs',
  timeout: 30000,
  use: {
    headless: true,
    launchOptions: {
      args: [
        `--disable-extensions-except=${process.cwd()}/extension`,
        `--load-extension=${process.cwd()}/extension`,
      ],
    },
  },
});
