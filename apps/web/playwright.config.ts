import { defineConfig, devices } from "@playwright/test";

/**
 * Slice 6 functional/WebKit coverage (implementation doc "Verification"). Every spec
 * intercepts the Personal Album HTTP contracts via `AlbumApiMock` — no real backend
 * is involved, so `webServer` only needs the Vite dev server itself.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
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
      testIgnore: "**/webkit-mobile-smoke.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // 320px WebKit functional smoke (implementation doc "Verification").
      name: "mobile-webkit",
      testMatch: "**/webkit-mobile-smoke.spec.ts",
      use: { browserName: "webkit", viewport: { width: 320, height: 640 } },
    },
  ],
});
