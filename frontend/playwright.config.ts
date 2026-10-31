import path from 'node:path'

import { defineConfig, devices } from '@playwright/test'

// E2E runs its own backend (port 8001) against the *test* database and its own Vite server
// (port 5174), so it never touches development data or a dev server you have open.
const backendDir = path.resolve(import.meta.dirname, '../backend')
const python =
  process.platform === 'win32'
    ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
    : path.join(backendDir, '.venv', 'bin', 'python')

const API_PORT = 8001
const WEB_PORT = 5174

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: `"${python}" -m uvicorn app.main:app --app-dir "${backendDir}" --host 127.0.0.1 --port ${API_PORT}`,
      url: `http://127.0.0.1:${API_PORT}/api/v1/health`,
      env: {
        DB_NAME: process.env.E2E_DB_NAME ?? 'denote_test',
        FRONTEND_ORIGINS: `http://localhost:${WEB_PORT}`,
        FRONTEND_BASE_URL: `http://localhost:${WEB_PORT}`,
        LOG_LEVEL: 'WARNING',
        // Many registrations from one IP; the limits themselves are covered by backend tests.
        RATE_LIMITS_ENABLED: 'false',
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npm run dev -- --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      env: { VITE_API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
