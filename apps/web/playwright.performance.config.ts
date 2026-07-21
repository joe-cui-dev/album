import { defineConfig, devices } from "@playwright/test";

/**
 * Slice 5's pinned 20,000-Photo measurement profile (execution plan Slice 0.1 /
 * "Keep timing/heap thresholds out of the portable functional projects"). Deliberately a
 * separate config/command (`verify:performance`) from the portable acceptance run: this
 * profile is hardware-specific and not part of the pass/fail acceptance gate for a PR.
 *
 * No specs live under `e2e/performance/` yet -- Slice 5 adds the 20,000-Photo generator
 * and measurement spec described in the execution plan.
 */
export default defineConfig({
  testDir: "./e2e/performance",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build:e2e && npm run preview:e2e",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "performance-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
