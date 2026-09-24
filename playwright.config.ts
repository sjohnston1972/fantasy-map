// Browser tests for the map page (e2e/): the editing gestures, zoom, sharing and export,
// run in the three browser engines (Chrome's, Firefox's and Safari's) and on a phone-sized
// touch screen. `npm run e2e` builds the page first; see e2e/server.mjs for the test server.

import { defineConfig, devices } from "@playwright/test";

const PORT = 8810;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // One retry, so a test slowed by a busy machine is reported as flaky rather than failed.
  retries: 1,
  workers: 3,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1400, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node e2e/server.mjs`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    env: { E2E_PORT: String(PORT) },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 1000 } } },
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1400, height: 1000 } } },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1400, height: 1000 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
    { name: "tablet", use: { ...devices["iPad (gen 7)"] } },
  ],
});
