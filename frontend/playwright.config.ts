import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 30_000,
    env: {
      ...process.env,
      VITE_BACKEND_URL: "http://127.0.0.1:8000",
    },
  },
  projects: [
    {
      name: "Desktop Chrome",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // Chromium-based (not WebKit) so it doesn't need a separate browser
      // download -- we're testing our own responsive layout/touch behavior,
      // not Safari-specific rendering quirks.
      name: "Mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
