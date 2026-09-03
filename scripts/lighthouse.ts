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
  type LighthouseResult,
} from "../src/integrations/lighthouse.js";
import { resolveUrls, scanUrls } from "../src/integrations/lighthouse-runner.js";
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let assessment;

  if (args.lhrFile) {
    // Single pre-computed LHR file — no browser needed.
    const lhr = JSON.parse(readFileSync(args.lhrFile, "utf8")) as LighthouseResult;
    if (args.saveLhr) writeFileSync(args.saveLhr, JSON.stringify(lhr, null, 2));
    assessment = lighthouseToAssessment(lhr, { targetLevel: args.level });
  } else {
    // Resolve URLs from positional args, --urls file, and --sitemap (or index).
    const urls = await resolveUrls({
      urls: args.urls,
      urlsFile: args.urlsFile,
      sitemap: args.sitemap,
    });

    if (urls.length === 0) {
      process.stderr.write(
        "Usage: npm run scan:lighthouse -- <url> [<url> ...] | --urls <file> | --sitemap <url> | --lhr <file.json> [--format ...] [--out ...] [--jira]\n",
      );
      process.exitCode = 1;
      return;
    }

    const { assessment: result, pages } = await scanUrls(urls, {
      targetLevel: args.level,
      onProgress: (e) => {
        if (e.type === "start") process.stdout.write(`Scanning ${e.total} page(s)...\n`);
        else if (e.type === "page")
          process.stdout.write(`  [${e.index + 1}/${e.total}] → ${e.url}\n`);
        else if (e.type === "skip")
          process.stderr.write(`    ! skipped ${e.url} (${e.error})\n`);
      },
    });
    assessment = result;

    if (args.saveLhr) {
      const payload = pages.length === 1 ? pages[0]!.lhr : pages;
      writeFileSync(args.saveLhr, JSON.stringify(payload, null, 2));
      process.stdout.write(`Raw Lighthouse result(s) saved to ${args.saveLhr}\n`);
    }
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
