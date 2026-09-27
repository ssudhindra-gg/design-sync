import { defineConfig, devices } from "@playwright/test";

import { BASE_URL } from "./stack";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  // One compose stack is shared by every test.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
