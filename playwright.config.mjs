import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:4194',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: true,
  },
  webServer: {
    command: `node --input-type=module -e "import Anthropic from '@anthropic-ai/sdk'; import { createApp } from './app.js'; const sql = async () => []; const app = createApp({ anthropic: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'test-key' }), sql, env: process.env }); app.listen(process.env.PORT, () => console.log('AppForge test server ready'));"`,
    url: 'http://127.0.0.1:4194',
    reuseExistingServer: false,
    env: {
      PORT: '4194',
      ANTHROPIC_API_KEY: 'test-anthropic-key',
      ADMIN_SECRET: 'test-admin-secret',
      APP_URL: 'http://127.0.0.1:4194',
    },
  },
});

