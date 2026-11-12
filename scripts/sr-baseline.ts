#!/usr/bin/env node
/**
 * Create a baseline screen reader workflow for each page: read the whole page
 * with VoiceOver, then reload and Tab through every control.
 *
 * Writes workflows/baseline-<page>.json (see src/screen-reader/paths.ts). With
 * no pages given, uses the guided audit's pages, else ./urls.txt. Existing files
 * are kept (so hand edits survive) unless --force is passed. --session <name>
 * signs in with a saved session (bt-a11y sr login) first.
 *
 * Usage:
 *   npm run sr:baseline                                     # the audit's pages, else ./urls.txt
 *   npm run sr:baseline -- https://example.com/login        # specific pages
 *   npm run sr:baseline -- --urls ./other-urls.txt
 *   npm run sr:baseline -- --sitemap https://example.com/sitemap.xml
 *   npm run sr:baseline -- --force                          # overwrite existing baselines
 */
import { existsSync } from "node:fs";
import { resolveUrls } from "../src/integrations/lighthouse-runner.js";
import { writeBaselines } from "../src/screen-reader/baseline.js";
import { screenReaderPaths, srCommand } from "../src/screen-reader/paths.js";
import { loadSession } from "../src/wizard/session.js";

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const sitemap = flag("--sitemap");
  const urlsFlag = flag("--urls");
  const positional = argv.filter((a, i) => !a.startsWith("--") && !["--urls", "--sitemap", "--session"].includes(argv[i - 1] ?? ""));
  const nothingGiven = positional.length === 0 && !sitemap && !urlsFlag;
  // With nothing given: the guided audit's pages, else ./urls.txt.
  const auditUrls = nothingGiven ? (loadSession(screenReaderPaths().root)?.project.urls ?? []) : [];
  const urlsFile = urlsFlag ?? (nothingGiven && auditUrls.length === 0 && existsSync("urls.txt") ? "urls.txt" : undefined);

  const urls = await resolveUrls({ urls: [...positional, ...auditUrls], urlsFile, sitemap });
  if (urls.length === 0) {
    console.error(`No URLs found. Start a guided audit (bt-a11y start), add pages to urls.txt, or pass them: ${srCommand("baseline")} https://example.com`);
    process.exit(1);
  }

  for (const b of writeBaselines(screenReaderPaths().workflows, urls, { force, session: flag("--session") })) {
    console.log(b.written ? `wrote    ${b.file}` : `kept     ${b.file} (exists; --force to overwrite)`);
  }
  console.log(`\nRun them with: ${srCommand("test")} -g "Baseline"`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
