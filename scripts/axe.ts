#!/usr/bin/env node
/**
 * Standalone axe-core scan script.
 *
 * Drives Playwright + axe-core against one or many live pages (or reads a saved
 * axe result JSON), converts the result through the toolkit, and prints/writes
 * an accessibility report. Optionally files Jira tickets.
 *
 * Usage:
 *   npm run scan:axe -- https://example.com
 *   npm run scan:axe -- https://example.com https://example.com/about   # many pages
 *   npm run scan:axe -- --urls ./urls.txt                               # one URL per line
 *   npm run scan:axe -- --sitemap https://example.com/sitemap.xml       # crawl a sitemap
 *   npm run scan:axe -- --axe ./axe-result.json                         # no browser needed
 *   npm run scan:axe -- https://example.com --format markdown --out axe.md
 *   npm run scan:axe -- https://example.com --jira --min-severity high
 *
 * Live scans require optional deps:
 *   npm install -D playwright @axe-core/playwright && npx playwright install chromium
 */
import { readFileSync, writeFileSync } from "node:fs";
import { axeToAssessment, type AxeResults } from "../src/integrations/axe.js";
import { resolveUrls, scanUrlsWithAxe } from "../src/integrations/axe-runner.js";
import { formatConsole, formatJson, formatMarkdown } from "../src/report.js";
import { createJiraTickets } from "../src/integrations/jira.js";
import type { Severity, WcagLevel } from "../src/types.js";

interface Args {
  urls: string[];
  urlsFile?: string;
  sitemap?: string;
  axeFile?: string;
  level: WcagLevel;
  format: "console" | "json" | "markdown";
  out?: string;
  saveAxe?: string;
  jira: boolean;
  minSeverity?: Severity;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { urls: [], level: "AA", format: "console", jira: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--axe": args.axeFile = argv[++i]; break;
      case "--urls": args.urlsFile = argv[++i]; break;
      case "--sitemap": args.sitemap = argv[++i]; break;
      case "--level": args.level = argv[++i] as WcagLevel; break;
      case "--format": args.format = argv[++i] as Args["format"]; break;
      case "--out": args.out = argv[++i]; break;
      case "--save-axe": args.saveAxe = argv[++i]; break;
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

  if (args.axeFile) {
    // Saved axe result JSON — no browser needed.
    const results = JSON.parse(readFileSync(args.axeFile, "utf8")) as AxeResults;
    assessment = axeToAssessment(results, { targetLevel: args.level });
  } else {
    const urls = await resolveUrls({
      urls: args.urls,
      urlsFile: args.urlsFile,
      sitemap: args.sitemap,
    });

    if (urls.length === 0) {
      process.stderr.write(
        "Usage: npm run scan:axe -- <url> [<url> ...] | --urls <file> | --sitemap <url> | --axe <file.json> [--format ...] [--out ...] [--jira]\n",
      );
      process.exitCode = 1;
      return;
    }

    const { assessment: result, pages } = await scanUrlsWithAxe(urls, {
      targetLevel: args.level,
      onProgress: (e) => {
        if (e.type === "start") process.stdout.write(`Scanning ${e.total} page(s) with axe...\n`);
        else if (e.type === "page")
          process.stdout.write(`  [${e.index + 1}/${e.total}] → ${e.url}\n`);
        else if (e.type === "skip")
          process.stderr.write(`    ! skipped ${e.url} (${e.error})\n`);
      },
    });
    assessment = result;

    if (args.saveAxe) {
      const payload = pages.length === 1 ? pages[0]!.results : pages;
      writeFileSync(args.saveAxe, JSON.stringify(payload, null, 2));
      process.stdout.write(`Raw axe result(s) saved to ${args.saveAxe}\n`);
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
