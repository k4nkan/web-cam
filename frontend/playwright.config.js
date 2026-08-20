import { defineConfig } from '@playwright/test';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export default defineConfig({
  testDir: './tests',
  testIgnore: '**/*.unit.test.js',
  outputDir: './test-results',
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5175',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: chromePath,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
    permissions: ['camera'],
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: true,
    timeout: 20_000,
  },
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'mobile',
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'mobile-landscape',
      use: {
        viewport: { width: 844, height: 390 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
});
