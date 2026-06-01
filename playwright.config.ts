import * as path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Backlogger Phase 2 e2e suite.
 *
 * Run locally:
 *   npx playwright install --with-deps chromium
 *   npm run test:e2e
 *
 * The webServer block starts the full dev stack using a dedicated data dir
 * (.e2e-data/ at the repo root) so tests never touch the real ./data directory.
 *
 * NOTE: We resolve BACKLOGGER_DATA_DIR to an ABSOLUTE path here. The API dev
 * script runs via `npm -w @backlogger/api run dev`, which changes the working
 * directory to packages/api/ — so a relative path would resolve to the wrong
 * location. The same env var is exported into the playwright process so tests
 * and globalSetup read/write the same directory the server does.
 */
const E2E_DATA_DIR = path.resolve(process.cwd(), '.e2e-data');
process.env.BACKLOGGER_DATA_DIR = E2E_DATA_DIR;

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  globalSetup: 'e2e/global-setup.ts',
  webServer: {
    command: 'npm run dev',
    env: {
      BACKLOGGER_DATA_DIR: E2E_DATA_DIR,
      BACKLOGGER_PORT: '3333',
    },
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
