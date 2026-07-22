import { defineConfig, devices } from "@playwright/test";

/**
 * Slice 0 acceptance harness (execution plan "Slice 0 — Acceptance Harness"). Every spec
 * intercepts the Personal Album HTTP contracts via `AlbumApiMock` — no real backend
 * is involved, so `webServer` only needs the Vite dev server itself.
 *
 * Timing/heap thresholds live in `playwright.performance.config.ts`, not here — these
 * blocking functional projects must stay independent of hardware-specific measurements.
 */
export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/performance/**",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // One CI retry is permitted to absorb infra flake; the acceptance record itself
  // must still come from a clean, retry-free passing run (execution plan Delivery Rules).
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: {
    // A production build+preview (not `vite dev`) avoids React StrictMode's dev-only double-invoked
    // effects, which would otherwise consume two of each mocked network response per navigation.
    command: "npm run build:e2e && npm run preview:e2e",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      // Project-level `testIgnore` replaces the root one rather than merging with it, so the
      // performance directory must be repeated here to actually stay out of this portable project.
      testIgnore: ["**/webkit-mobile-smoke.spec.ts", "**/mobile-chromium-smoke.spec.ts", "**/performance/**"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      testIgnore: ["**/webkit-mobile-smoke.spec.ts", "**/mobile-chromium-smoke.spec.ts", "**/performance/**"],
      use: { ...devices["Desktop Firefox"] },
    },
    {
      // 360px mobile Chromium functional smoke (execution plan Slice 0.1).
      name: "mobile-chromium",
      testMatch: "**/mobile-chromium-smoke.spec.ts",
      use: { browserName: "chromium", viewport: { width: 360, height: 740 } },
    },
    {
      // 320px WebKit functional smoke (implementation doc "Verification").
      name: "mobile-webkit",
      testMatch: "**/webkit-mobile-smoke.spec.ts",
      use: { browserName: "webkit", viewport: { width: 320, height: 640 } },
    },
  ],
});
