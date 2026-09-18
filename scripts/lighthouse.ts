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
import type { Severity, WcagLevel, Platform } from "../src/types.js";
import { readSitemap } from "../src/sitemap.js";
import { resolveFormFactor } from "../src/formFactor.js";
import { mapWithConcurrency, resolveConcurrency } from "../src/concurrency.js";
import { runLighthouse } from "./lighthouseRunner.js";

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
  platform?: string;
  formFactor?: string;
  concurrency?: string;
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


async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ff = resolveFormFactor(args.formFactor);
  const platform = (args.platform ?? "web") as Platform;

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
    assessment = lighthouseToAssessment(lhr, { targetLevel: args.level, platform });
  } else if (uniqueUrls.length === 1) {
    // Single live page.
    const lhr = await runLighthouse(uniqueUrls[0]!, ff);
    if (args.saveLhr) {
      writeFileSync(args.saveLhr, JSON.stringify(lhr, null, 2));
      process.stdout.write(`Raw Lighthouse result saved to ${args.saveLhr}\n`);
    }
    assessment = lighthouseToAssessment(lhr, { targetLevel: args.level, platform });
  } else {
    // Multiple live pages -> one combined report.
    const concurrency = resolveConcurrency(args.concurrency);
    process.stdout.write(
      `Scanning ${uniqueUrls.length} page(s) with Lighthouse [${ff.formFactor} ${ff.width}x${ff.height}, concurrency ${concurrency}]...\n`,
    );
    const scanned = await mapWithConcurrency(uniqueUrls, concurrency, async (url, index) => {
      try {
        const lhr = await runLighthouse(url, ff);
        process.stdout.write(`  ✓ [${index + 1}/${uniqueUrls.length}] ${url}\n`);
        return { url, lhr };
      } catch (err) {
        process.stderr.write(
          `    ! skipped ${url} (${err instanceof Error ? err.message : String(err)})\n`,
        );
        return undefined;
      }
    });
    // Results come back in input order, so reports stay stable run to run.
    const pages: LighthousePage[] = scanned.filter((p): p is LighthousePage => p !== undefined);
    if (pages.length === 0) throw new Error("No pages could be scanned.");
    if (args.saveLhr) {
      writeFileSync(args.saveLhr, JSON.stringify(pages, null, 2));
      process.stdout.write(`Raw Lighthouse results saved to ${args.saveLhr}\n`);
    }
    assessment = combineLighthouseResults(pages, { targetLevel: args.level, platform });
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
