/**
 * DeepSight-managed Playwright config (do not edit — regenerated on run_tests).
 * Requires env: DEEPSIGHT_PROJECT_ROOT, optional DEEPSIGHT_TEST_DIR, DEEPSIGHT_BASE_URL.
 */
import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const projectRoot = process.env.DEEPSIGHT_PROJECT_ROOT;
if (!projectRoot) {
  throw new Error('DEEPSIGHT_PROJECT_ROOT is required for DeepSight Playwright runs');
}

const testDir = path.join(projectRoot, process.env.DEEPSIGHT_TEST_DIR || 'deepsight_tests');
const baseURL = (process.env.DEEPSIGHT_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const jsonOut = path.join(
  projectRoot,
  'deepsight_tests',
  'tmp',
  'playwright-raw.json',
);

export default defineConfig({
  testDir,
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  reporter: [['list'], ['json', { outputFile: jsonOut }]],
});
