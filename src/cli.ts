#!/usr/bin/env node
/**
 * bt-a11y CLI
 *
 * Runs the toolkit against a JSON file describing an {@link A11yNode} tree (as
 * exported by a platform adapter) and prints/writes a report. Optionally creates
 * Jira tickets from the findings.
 *
 * Usage:
 *   bt-a11y audit <tree.json> [--platform web|ios|android|react-native]
 *                             [--level A|AA|AAA]
 *                             [--format console|json|markdown]
 *                             [--out <file>]
 *                             [--min-target <px>]
 *                             [--jira --min-severity high]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { runAudit } from "./audit.js";
import { formatConsole, formatJson, formatMarkdown } from "./report.js";
import { createJiraTickets } from "./integrations/jira.js";
import { resolveUrls, scanUrls } from "./integrations/lighthouse-runner.js";
import type { A11yNode, Assessment, Platform, Severity, WcagLevel } from "./types.js";

interface ParsedArgs {
  command?: string;
  file?: string;
  urls: string[];
  urlsFile?: string;
  sitemap?: string;
  lhrFile?: string;
  axeFile?: string;
  platform: Platform;
  level: WcagLevel;
  format: "console" | "json" | "markdown";
  out?: string;
  minTarget?: number;
  jira: boolean;
  minSeverity?: Severity;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    urls: [],
    platform: "web",
    level: "AA",
    format: "console",
    jira: false,
  };
  args.command = argv[0];
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    switch (arg) {
      case "--platform":
        args.platform = rest[++i] as Platform;
        break;
      case "--urls":
        args.urlsFile = rest[++i];
        break;
      case "--sitemap":
        args.sitemap = rest[++i];
        break;
      case "--lhr":
        args.lhrFile = rest[++i];
        break;
      case "--axe":
        args.axeFile = rest[++i];
        break;
      case "--level":
        args.level = rest[++i] as WcagLevel;
        break;
      case "--format":
        args.format = rest[++i] as ParsedArgs["format"];
        break;
      case "--out":
        args.out = rest[++i];
        break;
      case "--min-target":
        args.minTarget = Number(rest[++i]);
        break;
      case "--jira":
        args.jira = true;
        break;
      case "--min-severity":
        args.minSeverity = rest[++i] as Severity;
        break;
      default:
        if (arg && arg.startsWith("http")) args.urls.push(arg);
        else if (arg && !arg.startsWith("--")) args.file = arg;
    }
  }
  return args;
}

const HELP = `bt-a11y — BlueTread Accessibility Toolkit

Usage:
  bt-a11y audit <tree.json> [options]
  bt-a11y lighthouse <url> [<url> ...] [options]
  bt-a11y lighthouse --urls <file> [options]
  bt-a11y lighthouse --sitemap <url> [options]
  bt-a11y lighthouse --lhr <result.json> [options]
  bt-a11y axe <url> [<url> ...] [options]
  bt-a11y axe --urls <file> [options]
  bt-a11y axe --sitemap <url> [options]
  bt-a11y axe --axe <result.json> [options]

Commands:
  audit         Audit an A11yNode tree exported by a platform adapter.
  lighthouse    Run Lighthouse against one or many live pages (or a saved LHR)
                and produce one combined accessibility report.
  axe           Run axe-core (via Playwright) against one or many live pages
                (or a saved axe result) and produce one combined report.

Options:
  --platform <web|ios|android|react-native>   Target platform (audit; default: web)
  --urls <file>                                URL list file (one per line, lighthouse/axe)
  --sitemap <url>                              Scan every page in a sitemap or sitemap index
  --lhr <file>                                 Read a saved Lighthouse result JSON (lighthouse)
  --axe <file>                                 Read a saved axe result JSON (axe)
  --level <A|AA|AAA>                           Target WCAG level (default: AA)
  --format <console|json|markdown>             Report format (default: console)
  --out <file>                                 Write report to a file
  --min-target <px>                            Minimum touch target size (audit; default: 24 AA / 44 AAA)
  --jira                                       Create Jira tickets from findings
  --min-severity <critical|high|medium|low>    Only ticket findings at/above this severity
  -h, --help                                   Show this help

Live Lighthouse scans require optional deps:
  npm install -D lighthouse chrome-launcher
Live axe scans require optional deps:
  npm install -D playwright @axe-core/playwright && npx playwright install chromium

Environment (for --jira):
  JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY
`;

/** Format an assessment, write/print it, and optionally file Jira tickets. */
async function report(assessment: Assessment, args: ParsedArgs): Promise<void> {
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
    process.stdout.write(`\nCreated ${created.length} Jira ticket(s):\n`);
    for (const t of created) process.stdout.write(`  ${t.key} — ${t.finding.title}\n`);
  }
}

async function runAuditCommand(args: ParsedArgs): Promise<void> {
  if (!args.file) {
    process.stderr.write("Error: missing <tree.json>\n\n" + HELP);
    process.exitCode = 1;
    return;
  }
  const tree = JSON.parse(readFileSync(args.file, "utf8")) as A11yNode | A11yNode[];
  const assessment = runAudit(tree, {
    platform: args.platform,
    targetLevel: args.level,
    minTouchTargetSize: args.minTarget,
  });
  await report(assessment, args);
}

async function runLighthouseCommand(args: ParsedArgs): Promise<void> {
  // Saved LHR file — no browser needed.
  if (args.lhrFile) {
    const { lighthouseToAssessment } = await import("./integrations/lighthouse.js");
    const lhr = JSON.parse(readFileSync(args.lhrFile, "utf8"));
    await report(lighthouseToAssessment(lhr, { targetLevel: args.level }), args);
    return;
  }

  const urls = await resolveUrls({
    urls: args.urls,
    urlsFile: args.urlsFile,
    sitemap: args.sitemap,
  });

  if (urls.length === 0) {
    process.stderr.write(
      "Error: no URLs to scan. Pass <url> args, --urls <file>, --sitemap <url>, or --lhr <file>.\n\n" +
        HELP,
    );
    process.exitCode = 1;
    return;
  }

  const { assessment } = await scanUrls(urls, {
    targetLevel: args.level,
    onProgress: (e) => {
      if (e.type === "start") process.stderr.write(`Scanning ${e.total} page(s)...\n`);
      else if (e.type === "page")
        process.stderr.write(`  [${e.index + 1}/${e.total}] → ${e.url}\n`);
      else if (e.type === "skip") process.stderr.write(`    ! skipped ${e.url} (${e.error})\n`);
    },
  });

  await report(assessment, args);
}

async function runAxeCommand(args: ParsedArgs): Promise<void> {
  // Saved axe result JSON — no browser needed.
  if (args.axeFile) {
    const { axeToAssessment } = await import("./integrations/axe.js");
    const results = JSON.parse(readFileSync(args.axeFile, "utf8"));
    await report(axeToAssessment(results, { targetLevel: args.level }), args);
    return;
  }

  const { resolveUrls: resolve, scanUrlsWithAxe } = await import(
    "./integrations/axe-runner.js"
  );
  const urls = await resolve({
    urls: args.urls,
    urlsFile: args.urlsFile,
    sitemap: args.sitemap,
  });

  if (urls.length === 0) {
    process.stderr.write(
      "Error: no URLs to scan. Pass <url> args, --urls <file>, --sitemap <url>, or --axe <file>.\n\n" +
        HELP,
    );
    process.exitCode = 1;
    return;
  }

  const { assessment } = await scanUrlsWithAxe(urls, {
    targetLevel: args.level,
    onProgress: (e) => {
      if (e.type === "start") process.stderr.write(`Scanning ${e.total} page(s) with axe...\n`);
      else if (e.type === "page")
        process.stderr.write(`  [${e.index + 1}/${e.total}] → ${e.url}\n`);
      else if (e.type === "skip") process.stderr.write(`    ! skipped ${e.url} (${e.error})\n`);
    },
  });

  await report(assessment, args);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(HELP);
    return;
  }

  const args = parseArgs(argv);
  switch (args.command) {
    case "audit":
      await runAuditCommand(args);
      break;
    case "lighthouse":
      await runLighthouseCommand(args);
      break;
    case "axe":
      await runAxeCommand(args);
      break;
    default:
      process.stderr.write(`Unknown command: ${args.command ?? "(none)"}\n\n${HELP}`);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
