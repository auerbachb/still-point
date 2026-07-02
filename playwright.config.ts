import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const baseURL = process.env.E2E_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const isLaneRun = Boolean(process.env.E2E_LANE);
const shouldReuseExternalServer = process.env.E2E_REUSE_SERVER === "true" || Boolean(process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
  testDir: "./e2e",
  globalSetup: process.env.E2E_WEB_SETUP_USER === "true" ? "./e2e/global-setup.ts" : undefined,
  timeout: 45_000,
  expect: {
    timeout: 8_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 12_000,
    navigationTimeout: 20_000,
  },
  webServer: shouldReuseExternalServer
    ? undefined
    : {
        command: `npm run dev -- --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
      },
  projects: isLaneRun
    ? [
        {
          name: "chromium",
          use: {
            ...devices["iPhone 13"],
            browserName: "chromium",
            hasTouch: true,
          },
        },
      ]
    : [
        {
          name: "mobile-chromium-narrow",
          use: {
            ...devices["iPhone SE"],
            browserName: "chromium",
          },
        },
        {
          name: "mobile-chromium-wide",
          use: {
            ...devices["iPhone 13 Pro Max"],
            browserName: "chromium",
          },
        },
        {
          // Tradeoff note: this keeps one iPhone-class width while adding Safari-class behavior coverage.
          name: "mobile-webkit-iphone",
          use: {
            ...devices["iPhone 13"],
            browserName: "webkit",
          },
        },
      ],
});
