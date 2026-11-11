#!/usr/bin/env node
/**
 * Create a baseline screen reader workflow for each page: read the whole page
 * with VoiceOver, then reload and Tab through every control.
 *
 * Writes screen-reader/workflows/baseline-<page>.json. Existing files are kept
 * (so hand edits survive) unless --force is passed.
 *
 * Usage:
 *   npm run sr:baseline                                     # every URL in ./urls.txt
 *   npm run sr:baseline -- https://example.com/login        # specific pages
 *   npm run sr:baseline -- --urls ./other-urls.txt
 *   npm run sr:baseline -- --sitemap https://example.com/sitemap.xml
 *   npm run sr:baseline -- --force                          # overwrite existing baselines
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveUrls } from "../src/integrations/lighthouse-runner.js";

const WORKFLOW_DIR = join(import.meta.dirname, "..", "screen-reader", "workflows");

/** `https://example.com/account/settings` → `example-com-account-settings`. */
export function pageSlug(url: string): string {
  const u = new URL(url);
  return `${u.hostname}${u.pathname}`
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function baselineWorkflow(url: string) {
  return {
    name: `Baseline: ${url}`,
    url,
    steps: [{ read: "page" }, { goto: url }, { tab: "all" }],
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const sitemap = flag("--sitemap");
  const urlsFlag = flag("--urls");
  const positional = argv.filter((a, i) => !a.startsWith("--") && !["--urls", "--sitemap"].includes(argv[i - 1] ?? ""));
  const urlsFile = urlsFlag ?? (positional.length === 0 && !sitemap ? "urls.txt" : undefined);

  const urls = await resolveUrls({ urls: positional, urlsFile, sitemap });
  if (urls.length === 0) {
    console.error("No URLs found. Add pages to urls.txt, or pass them: npm run sr:baseline -- https://example.com");
    process.exit(1);
  }

  mkdirSync(WORKFLOW_DIR, { recursive: true });
  for (const url of urls) {
    const file = join(WORKFLOW_DIR, `baseline-${pageSlug(url)}.json`);
    if (existsSync(file) && !force) {
      console.log(`kept     ${file} (exists; --force to overwrite)`);
      continue;
    }
    writeFileSync(file, JSON.stringify(baselineWorkflow(url), null, 2) + "\n");
    console.log(`wrote    ${file}`);
  }
  console.log(`\nRun them with: npm run sr:test -- -g "Baseline"`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
