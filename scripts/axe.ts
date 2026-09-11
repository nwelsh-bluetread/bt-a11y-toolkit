#!/usr/bin/env node
/**
 * Standalone axe-core scan script.
 *
 * Runs independently of the other scripts/tests. It launches axe-core against a
 * URL (via Puppeteer) or reads a saved axe results JSON, converts the result
 * through the toolkit, and prints/writes an accessibility report. Optionally
 * files Jira tickets.
 *
 * Usage:
 *   npm run scan:axe -- https://example.com
 *   npm run scan:axe -- https://example.com https://example.com/about   # many pages
 *   npm run scan:axe -- --urls ./urls.txt                               # one URL per line
 *   npm run scan:axe -- --sitemap https://example.com/sitemap.xml       # crawl a sitemap
 *   npm run scan:axe -- https://example.com --format markdown --out axe.md
 *   npm run scan:axe -- --results ./axe-result.json                     # no browser needed
 *   npm run scan:axe -- https://example.com --jira --min-severity high
 *
 * `puppeteer` and `@axe-core/puppeteer` are optional peer deps; install them to
 * run live scans:
 *   npm install -D puppeteer @axe-core/puppeteer
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  axeToAssessment,
  combineAxeResults,
  type AxeResults,
  type AxePage,
} from "../src/integrations/axe.js";
import { formatConsole, formatJson, formatMarkdown } from "../src/report.js";
import { createJiraTickets } from "../src/integrations/jira.js";
import type { Severity, WcagLevel } from "../src/types.js";

interface Args {
  urls: string[];
  urlsFile?: string;
  sitemap?: string;
  resultsFile?: string;
  level: WcagLevel;
  format: "console" | "json" | "markdown";
  out?: string;
  saveResults?: string;
  jira: boolean;
  minSeverity?: Severity;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { urls: [], level: "AA", format: "console", jira: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--results": args.resultsFile = argv[++i]; break;
      case "--urls": args.urlsFile = argv[++i]; break;
      case "--sitemap": args.sitemap = argv[++i]; break;
      case "--level": args.level = argv[++i] as WcagLevel; break;
      case "--format": args.format = argv[++i] as Args["format"]; break;
      case "--out": args.out = argv[++i]; break;
      case "--save-results": args.saveResults = argv[++i]; break;
      case "--jira": args.jira = true; break;
      case "--min-severity": args.minSeverity = argv[++i] as Severity; break;
      default:
        if (a && !a.startsWith("--")) args.urls.push(a);
    }
  }
  return args;
}

/** Read a URL list file (one URL per line, `#` comments and blanks ignored). */
function readUrlsFile(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

/** Fetch a sitemap.xml and extract its <loc> URLs. */
async function readSitemap(sitemapUrl: string): Promise<string[]> {
  const res = await fetch(sitemapUrl);
  if (!res.ok) throw new Error(`Failed to fetch sitemap (${res.status}): ${sitemapUrl}`);
  const xml = await res.text();
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!);
  return locs;
}

/** Run a live axe-core accessibility scan against a URL using Puppeteer. */
async function runAxe(url: string): Promise<AxeResults> {
  // Optional deps — imported lazily and typed loosely so the toolkit builds
  // without them installed. Install to enable live scans:
  //   npm install -D puppeteer @axe-core/puppeteer
  let puppeteer: { launch(opts?: Record<string, unknown>): Promise<PuppeteerBrowser> };
  let AxePuppeteer: new (page: unknown) => { analyze(): Promise<AxeResults> };
  try {
    puppeteer = ((await import("puppeteer" as string)) as { default?: unknown }).default as typeof puppeteer;
    AxePuppeteer = ((await import("@axe-core/puppeteer" as string)) as { AxePuppeteer: typeof AxePuppeteer }).AxePuppeteer;
  } catch {
    throw new Error(
      "Live scans require optional deps. Run: npm install -D puppeteer @axe-core/puppeteer",
    );
  }

  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2" });
    const results = await new AxePuppeteer(page).analyze();
    return { ...results, url };
  } finally {
    await browser.close();
  }
}

interface PuppeteerBrowser {
  newPage(): Promise<{ goto(url: string, opts?: Record<string, unknown>): Promise<unknown> }>;
  close(): Promise<void>;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Resolve the full list of URLs to scan from positional args, --urls file, and --sitemap.
  const urls = [...args.urls];
  if (args.urlsFile) urls.push(...readUrlsFile(args.urlsFile));
  if (args.sitemap) urls.push(...(await readSitemap(args.sitemap)));
  const uniqueUrls = [...new Set(urls)];

  if (uniqueUrls.length === 0 && !args.resultsFile) {
    process.stderr.write(
      "Usage: npm run scan:axe -- <url> [<url> ...] | --urls <file> | --sitemap <url> | --results <file.json> [--format ...] [--out ...] [--jira]\n",
    );
    process.exitCode = 1;
    return;
  }

  let assessment;

  if (args.resultsFile) {
    // Single pre-computed axe results file.
    const results = JSON.parse(readFileSync(args.resultsFile, "utf8")) as AxeResults;
    if (args.saveResults) writeFileSync(args.saveResults, JSON.stringify(results, null, 2));
    assessment = axeToAssessment(results, { targetLevel: args.level });
  } else if (uniqueUrls.length === 1) {
    // Single live page.
    const results = await runAxe(uniqueUrls[0]!);
    if (args.saveResults) {
      writeFileSync(args.saveResults, JSON.stringify(results, null, 2));
      process.stdout.write(`Raw axe result saved to ${args.saveResults}\n`);
    }
    assessment = axeToAssessment(results, { targetLevel: args.level });
  } else {
    // Multiple live pages -> one combined report.
    process.stdout.write(`Scanning ${uniqueUrls.length} page(s)...\n`);
    const pages: AxePage[] = [];
    for (const url of uniqueUrls) {
      process.stdout.write(`  → ${url}\n`);
      try {
        const results = await runAxe(url);
        pages.push({ url, results });
      } catch (err) {
        process.stderr.write(
          `    ! skipped (${err instanceof Error ? err.message : String(err)})\n`,
        );
      }
    }
    if (pages.length === 0) throw new Error("No pages could be scanned.");
    if (args.saveResults) {
      writeFileSync(args.saveResults, JSON.stringify(pages, null, 2));
      process.stdout.write(`Raw axe results saved to ${args.saveResults}\n`);
    }
    assessment = combineAxeResults(pages, { targetLevel: args.level });
  }

  const output =
    args.format === "json"
      ? formatJson(assessment)
      : args.format === "markdown"
        ? formatMarkdown(assessment)
        : formatConsole(assessment);

  if (args.out) {
    writeFileSync(args.out, output, "utf8");
    process.stdout.write(`Report written to ${args.out}\n`);
  } else {
    process.stdout.write(output + "\n");
  }

  if (args.jira) {
    const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY } = process.env;
    if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN || !JIRA_PROJECT_KEY) {
      process.stderr.write(
        "\nError: --jira requires JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY env vars.\n",
      );
      process.exitCode = 1;
      return;
    }
    const created = await createJiraTickets(
      assessment,
      {
        baseUrl: JIRA_BASE_URL,
        email: JIRA_EMAIL,
        apiToken: JIRA_API_TOKEN,
        projectKey: JIRA_PROJECT_KEY,
      },
      { minSeverity: args.minSeverity },
    );
    process.stdout.write(`\nCreated ${created.length} Jira ticket(s).\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
