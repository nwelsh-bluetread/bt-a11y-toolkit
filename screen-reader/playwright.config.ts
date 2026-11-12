// Playwright config for screen reader runs (real VoiceOver via Guidepup).
// VoiceOver takes over the Mac, so tests run one at a time in a visible browser.
import { defineConfig, devices } from "@playwright/test";
import { screenReaderConfig } from "@guidepup/playwright";
import { screenReaderPaths } from "../src/screen-reader/paths.ts";

export default defineConfig({
  ...screenReaderConfig,
  testDir: ".",
  testMatch: "**/*.sr.ts",
  // VoiceOver is slow: each announcement is captured in full (~5-10s per item),
  // so reading or Tabbing through a real app page easily takes several minutes.
  timeout: 15 * 60 * 1000,
  retries: 0,
  reporter: [["list"]],
  outputDir: screenReaderPaths().testResults,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], headless: false } }],
});
