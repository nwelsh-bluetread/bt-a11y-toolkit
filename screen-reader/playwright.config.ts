// Playwright config for screen reader runs (real VoiceOver via Guidepup).
// VoiceOver takes over the Mac, so tests run one at a time in a visible browser.
import { defineConfig, devices } from "@playwright/test";
import { screenReaderConfig } from "@guidepup/playwright";

export default defineConfig({
  ...screenReaderConfig,
  testDir: ".",
  testMatch: "**/*.sr.ts",
  timeout: 3 * 60 * 1000,
  retries: 0,
  reporter: [["list"]],
  outputDir: "../reports/screen-reader/test-results",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], headless: false } }],
});
