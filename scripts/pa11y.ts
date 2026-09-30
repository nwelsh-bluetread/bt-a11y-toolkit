#!/usr/bin/env node
/**
 * Standalone Pa11y scan script.
 *
 * Runs independently of the other scripts/tests. It launches Pa11y against a
 * URL (via its bundled headless Chrome), converts the result through the
 * toolkit, and prints/writes an accessibility report. Optionally files Jira
 * tickets.
 *
 * Usage:
 *   npm run scan:pa11y -- https://example.com
 *   npm run scan:pa11y -- https://example.com https://example.com/about   # many pages
 *   npm run scan:pa11y -- --urls ./urls.txt                               # one URL per line
 *   npm run scan:pa11y -- --sitemap https://example.com/sitemap.xml       # crawl a sitemap
 *   npm run scan:pa11y -- https://example.com --runner axe --runner htmlcs
 *   npm run scan:pa11y -- https://example.com --format markdown --out pa11y.md
 *   npm run scan:pa11y -- --results ./pa11y-result.json                   # no browser needed
 *   npm run scan:pa11y -- https://example.com --jira --min-severity high
 *
 * `pa11y` is an optional peer dep; install it to run live scans:
 *   npm install -D pa11y
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  pa11yToAssessment,
  combinePa11yResults,
  type Pa11yResults,
  type Pa11yPage,
  type Pa11yIssue,
} from "../src/integrations/pa11y.js";
import { formatConsole, formatJson, formatMarkdown } from "../src/report.js";
import { createJiraTickets } from "../src/integrations/jira.js";
import type { Severity, WcagLevel, Platform } from "../src/types.js";
import { readSitemap } from "../src/sitemap.js";
import { resolveFormFactor, type FormFactorConfig } from "../src/formFactor.js";
import { mapWithConcurrency, resolveConcurrency } from "../src/concurrency.js";

interface Args {
  urls: string[];
  urlsFile?: string;
  sitemap?: string;
  resultsFile?: string;
  level: WcagLevel;
  runners: string[];
  format: "console" | "json" | "markdown";
  out?: string;
  saveResults?: string;
  jira: boolean;
  platform?: string;
  formFactor?: string;
  concurrency?: string;
  minSeverity?: Severity;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    urls: [],
    level: "AA",
    runners: [],
    format: "console",
    jira: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--results": args.resultsFile = argv[++i]; break;
      case "--urls": args.urlsFile = argv[++i]; break;
      case "--sitemap": args.sitemap = argv[++i]; break;
      case "--level": args.level = argv[++i] as WcagLevel; break;
      case "--runner": args.runners.push(argv[++i]!); break;
      case "--format": args.format = argv[++i] as Args["format"]; break;
      case "--out": args.out = argv[++i]; break;
      case "--save-results": args.saveResults = argv[++i]; break;
      case "--jira": args.jira = true; break;
      case "--platform": args.platform = argv[++i]; break;
      case "--form-factor": args.formFactor = argv[++i]; break;
      case "--concurrency": args.concurrency = argv[++i]; break;
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

/** Map a WCAG level to the Pa11y `standard` string. */
function pa11yStandard(level: WcagLevel): string {
  return `WCAG2${level}`;
}

/** Run a live Pa11y accessibility scan against a URL. */
async function runPa11y(
  url: string,
  level: WcagLevel,
  runners: string[],
  ff: FormFactorConfig,
): Promise<Pa11yResults> {
  // Optional dep — imported lazily and typed loosely so the toolkit builds
  // without it installed. Install to enable live scans:
  //   npm install -D pa11y
  let pa11y: (url: string, options?: Record<string, unknown>) => Promise<{
    documentTitle?: string;
    pageUrl?: string;
    issues: Pa11yIssue[];
  }>;
  try {
    pa11y = ((await import("pa11y" as string)) as { default?: unknown }).default as typeof pa11y;
  } catch {
    throw new Error("Live scans require an optional dep. Run: npm install -D pa11y");
  }

  const result = await pa11y(url, {
    standard: pa11yStandard(level),
    runners: runners.length > 0 ? runners : ["htmlcs"],
    viewport: { width: ff.width, height: ff.height },
    userAgent: ff.userAgent,
  });
  return { url, pageUrl: result.pageUrl, documentTitle: result.documentTitle, issues: result.issues };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ff = resolveFormFactor(args.formFactor);
  const platform = (args.platform ?? "web") as Platform;

  // Resolve the full list of URLs to scan from positional args, --urls file, and --sitemap.
  const urls = [...args.urls];
  if (args.urlsFile) urls.push(...readUrlsFile(args.urlsFile));
  if (args.sitemap) urls.push(...(await readSitemap(args.sitemap)));
  const uniqueUrls = [...new Set(urls)];

  if (uniqueUrls.length === 0 && !args.resultsFile) {
    process.stderr.write(
      "Usage: npm run scan:pa11y -- <url> [<url> ...] | --urls <file> | --sitemap <url> | --results <file.json> [--runner axe] [--format ...] [--out ...] [--jira]\n",
    );
    process.exitCode = 1;
    return;
  }

  let assessment;

  if (args.resultsFile) {
    // Single pre-computed Pa11y results file (issue array or full object).
    const parsed = JSON.parse(readFileSync(args.resultsFile, "utf8")) as
      | Pa11yResults
      | Pa11yIssue[];
    const results: Pa11yResults = Array.isArray(parsed) ? { issues: parsed } : parsed;
    if (args.saveResults) writeFileSync(args.saveResults, JSON.stringify(results, null, 2));
    assessment = pa11yToAssessment(results, { targetLevel: args.level, platform });
  } else if (uniqueUrls.length === 1) {
    // Single live page.
    const results = await runPa11y(uniqueUrls[0]!, args.level, args.runners, ff);
    if (args.saveResults) {
      writeFileSync(args.saveResults, JSON.stringify(results, null, 2));
      process.stdout.write(`Raw Pa11y result saved to ${args.saveResults}\n`);
    }
    assessment = pa11yToAssessment(results, { targetLevel: args.level, platform });
  } else {
    // Multiple live pages -> one combined report.
    const concurrency = resolveConcurrency(args.concurrency);
    const runnerLabel = (args.runners.length > 0 ? args.runners : ["htmlcs"]).join("+");
    process.stdout.write(
      `Scanning ${uniqueUrls.length} page(s) with Pa11y [${runnerLabel}, ${ff.formFactor} ${ff.width}x${ff.height}, concurrency ${concurrency}]...\n`,
    );
    const scanned = await mapWithConcurrency(uniqueUrls, concurrency, async (url, index) => {
      try {
        const results = await runPa11y(url, args.level, args.runners, ff);
        process.stdout.write(`  ✓ [${index + 1}/${uniqueUrls.length}] ${url}\n`);
        return { url, results };
      } catch (err) {
        process.stderr.write(
          `    ! skipped ${url} (${err instanceof Error ? err.message : String(err)})\n`,
        );
        return undefined;
      }
    });
    // Results come back in input order, so reports stay stable run to run.
    const pages: Pa11yPage[] = scanned.filter((p): p is Pa11yPage => p !== undefined);
    if (pages.length === 0) throw new Error("No pages could be scanned.");
    if (args.saveResults) {
      writeFileSync(args.saveResults, JSON.stringify(pages, null, 2));
      process.stdout.write(`Raw Pa11y results saved to ${args.saveResults}\n`);
    }
    assessment = combinePa11yResults(pages, { targetLevel: args.level, platform });
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
