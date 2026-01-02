import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for pkg-risk frontend E2E tests.
 *
 * Usage:
 *   npm run test:e2e          # Run all tests headless
 *   npm run test:e2e:headed   # Run with visible browser
 *   npm run test:e2e:ui       # Open Playwright UI
 *
 * Claude Code can also use the Playwright MCP server directly:
 *   browser_navigate, browser_snapshot, browser_take_screenshot, etc.
 */
export default defineConfig({
  testDir: './tests',

  // Run tests in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Limit parallel workers on CI
  workers: process.env.CI ? 1 : undefined,

  // Reporter configuration
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],

  // Shared settings for all projects
  use: {
    // Base URL for navigation
    baseURL: 'http://localhost:5173/pkg-risk/',

    // Collect trace when retrying failed test
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'on-first-retry',
  },

  // Configure projects for browsers and viewports
  projects: [
    // Desktop Chrome (default)
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    // Mobile Chrome
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },

    // Mobile Safari
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 12'] },
    },

    // Tablet
    {
      name: 'tablet',
      use: { ...devices['iPad (gen 7)'] },
    },

    // Responsive tests - run on desktop Chrome but tests set their own viewports
    {
      name: 'responsive',
      testMatch: '**/*.responsive.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Run local dev server before starting tests
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173/pkg-risk/',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },

  // Output folder for test artifacts
  outputDir: 'test-results/',
});
