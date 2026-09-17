import { defineConfig } from '@playwright/test';

const port = Number(process.env.WB3D_TEST_PORT || 4173);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  // Las mediciones de FPS deben ejecutarse sin otro mundo 3D compitiendo por la GPU/CPU.
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: process.platform === 'win32' ? 'msedge' : undefined,
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: `vite --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
