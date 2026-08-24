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
 *   npm run scan:lighthouse -- https://example.com --format markdown --out lh.md
 *   npm run scan:lighthouse -- --lhr ./lighthouse-result.json          # no Chrome needed
 *   npm run scan:lighthouse -- https://example.com --jira --min-severity high
 *
 * `lighthouse` and `chrome-launcher` are optional peer deps; install them to run
 * live scans:
 *   npm install -D lighthouse chrome-launcher
 */
import { readFileSync, writeFileSync } from "node:fs";
import { lighthouseToAssessment, type LighthouseResult } from "../src/integrations/lighthouse.js";
import { formatConsole, formatJson, formatMarkdown } from "../src/report.js";
import { createJiraTickets } from "../src/integrations/jira.js";
import type { Severity, WcagLevel } from "../src/types.js";

interface Args {
  url?: string;
  lhrFile?: string;
  level: WcagLevel;
  format: "console" | "json" | "markdown";
  out?: string;
  saveLhr?: string;
  jira: boolean;
  minSeverity?: Severity;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { level: "AA", format: "console", jira: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--lhr": args.lhrFile = argv[++i]; break;
      case "--level": args.level = argv[++i] as WcagLevel; break;
      case "--format": args.format = argv[++i] as Args["format"]; break;
      case "--out": args.out = argv[++i]; break;
      case "--save-lhr": args.saveLhr = argv[++i]; break;
      case "--jira": args.jira = true; break;
      case "--min-severity": args.minSeverity = argv[++i] as Severity; break;
      default:
        if (a && !a.startsWith("--")) args.url = a;
    }
  }
  return args;
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

  if (!args.url && !args.lhrFile) {
    process.stderr.write(
      "Usage: npm run scan:lighthouse -- <url> | --lhr <file.json> [--format ...] [--out ...] [--jira]\n",
    );
    process.exitCode = 1;
    return;
  }

  const lhr: LighthouseResult = args.lhrFile
    ? (JSON.parse(readFileSync(args.lhrFile, "utf8")) as LighthouseResult)
    : await runLighthouse(args.url!);

  if (args.saveLhr) {
    writeFileSync(args.saveLhr, JSON.stringify(lhr, null, 2));
    process.stdout.write(`Raw Lighthouse result saved to ${args.saveLhr}\n`);
  }

  const assessment = lighthouseToAssessment(lhr, { targetLevel: args.level });

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
