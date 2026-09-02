#!/usr/bin/env node
/**
 * Standalone Lighthouse scan script.
 *
 * Runs independently of the other scripts/tests. It launches Lighthouse against
 * a URL (or reads a saved LHR JSON), converts the result through the toolkit,
 * and prints/writes an accessibility report. Optionally files Jira tickets.
 *
 * Usage:
 *   npm run scan:lighthouse -- https://example.com
 *   npm run scan:lighthouse -- https://example.com https://example.com/about   # many pages
 *   npm run scan:lighthouse -- --urls ./urls.txt                               # one URL per line
 *   npm run scan:lighthouse -- --sitemap https://example.com/sitemap.xml       # crawl a sitemap
 *   npm run scan:lighthouse -- https://example.com --format markdown --out lh.md
 *   npm run scan:lighthouse -- --lhr ./lighthouse-result.json                  # no Chrome needed
 *   npm run scan:lighthouse -- https://example.com --jira --min-severity high
 *
 * `lighthouse` and `chrome-launcher` are optional peer deps; install them to run
 * live scans:
 *   npm install -D lighthouse chrome-launcher
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  lighthouseToAssessment,
  combineLighthouseResults,
  type LighthouseResult,
  type LighthousePage,
} from "../src/integrations/lighthouse.js";
import { formatConsole, formatJson, formatMarkdown } from "../src/report.js";
import { createJiraTickets } from "../src/integrations/jira.js";
import type { Severity, WcagLevel } from "../src/types.js";

interface Args {
  urls: string[];
  urlsFile?: string;
  sitemap?: string;
  lhrFile?: string;
  level: WcagLevel;
  format: "console" | "json" | "markdown";
  out?: string;
  saveLhr?: string;
  jira: boolean;
  minSeverity?: Severity;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { urls: [], level: "AA", format: "console", jira: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--lhr": args.lhrFile = argv[++i]; break;
      case "--urls": args.urlsFile = argv[++i]; break;
      case "--sitemap": args.sitemap = argv[++i]; break;
      case "--level": args.level = argv[++i] as WcagLevel; break;
      case "--format": args.format = argv[++i] as Args["format"]; break;
      case "--out": args.out = argv[++i]; break;
      case "--save-lhr": args.saveLhr = argv[++i]; break;
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

/** Run a live Lighthouse accessibility scan against a URL. */
async function runLighthouse(url: string): Promise<LighthouseResult> {
  // Optional deps — imported lazily and typed loosely so the toolkit builds
  // without them installed. Install to enable live scans:
  //   npm install -D lighthouse chrome-launcher
  let chromeLauncher: { launch(opts: Record<string, unknown>): Promise<{ port: number; kill(): Promise<void> }> };
  let lighthouse: { default?: unknown } & Record<string, unknown>;
  try {
    chromeLauncher = (await import("chrome-launcher" as string)) as typeof chromeLauncher;
    lighthouse = (await import("lighthouse" as string)) as typeof lighthouse;
  } catch {
    throw new Error(
      "Live scans require optional deps. Run: npm install -D lighthouse chrome-launcher",
    );
  }

  const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless=new"] });
  try {
    const runner = (lighthouse.default ?? lighthouse) as (
      url: string,
      opts: Record<string, unknown>,
    ) => Promise<{ lhr: LighthouseResult } | undefined>;
    const result = await runner(url, {
      port: chrome.port,
      onlyCategories: ["accessibility"],
      output: "json",
      logLevel: "error",
    });
    if (!result?.lhr) throw new Error("Lighthouse returned no result.");
    return result.lhr;
  } finally {
    await chrome.kill();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Resolve the full list of URLs to scan from positional args, --urls file, and --sitemap.
  const urls = [...args.urls];
  if (args.urlsFile) urls.push(...readUrlsFile(args.urlsFile));
  if (args.sitemap) urls.push(...(await readSitemap(args.sitemap)));
  const uniqueUrls = [...new Set(urls)];

  if (uniqueUrls.length === 0 && !args.lhrFile) {
    process.stderr.write(
      "Usage: npm run scan:lighthouse -- <url> [<url> ...] | --urls <file> | --sitemap <url> | --lhr <file.json> [--format ...] [--out ...] [--jira]\n",
    );
    process.exitCode = 1;
    return;
  }

  let assessment;

  if (args.lhrFile) {
    // Single pre-computed LHR file.
    const lhr = JSON.parse(readFileSync(args.lhrFile, "utf8")) as LighthouseResult;
    if (args.saveLhr) writeFileSync(args.saveLhr, JSON.stringify(lhr, null, 2));
    assessment = lighthouseToAssessment(lhr, { targetLevel: args.level });
  } else if (uniqueUrls.length === 1) {
    // Single live page.
    const lhr = await runLighthouse(uniqueUrls[0]!);
    if (args.saveLhr) {
      writeFileSync(args.saveLhr, JSON.stringify(lhr, null, 2));
      process.stdout.write(`Raw Lighthouse result saved to ${args.saveLhr}\n`);
    }
    assessment = lighthouseToAssessment(lhr, { targetLevel: args.level });
  } else {
    // Multiple live pages -> one combined report.
    process.stdout.write(`Scanning ${uniqueUrls.length} page(s)...\n`);
    const pages: LighthousePage[] = [];
    for (const url of uniqueUrls) {
      process.stdout.write(`  → ${url}\n`);
      try {
        const lhr = await runLighthouse(url);
        pages.push({ url, lhr });
      } catch (err) {
        process.stderr.write(
          `    ! skipped (${err instanceof Error ? err.message : String(err)})\n`,
        );
      }
    }
    if (pages.length === 0) throw new Error("No pages could be scanned.");
    if (args.saveLhr) {
      writeFileSync(args.saveLhr, JSON.stringify(pages, null, 2));
      process.stdout.write(`Raw Lighthouse results saved to ${args.saveLhr}\n`);
    }
    assessment = combineLighthouseResults(pages, { targetLevel: args.level });
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
