#!/usr/bin/env node
/**
 * Combined accessibility scan (Lighthouse + axe-core).
 *
 * Runs BOTH engines against the same page(s), then merges their results into a
 * single de-duplicated report. This gives the widest coverage in one
 * deliverable: Lighthouse's scored audits plus axe-core's broader ruleset.
 *
 * Usage:
 *   npm run scan:all -- https://example.com
 *   npm run scan:all -- --urls ./urls.txt --format markdown --out a11y-report.md
 *   npm run scan:all -- --urls ./urls.txt --concurrency 6   # scan 6 pages at a time
 *   npm run scan:all -- --lhr ./lighthouse.json --results ./axe.json   # offline, no browser
 *
 * Live scans require the optional engine deps:
 *   npm install -D lighthouse chrome-launcher puppeteer @axe-core/puppeteer
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  lighthouseToAssessment,
  combineLighthouseResults,
  type LighthouseResult,
  type LighthousePage,
} from "../src/integrations/lighthouse.js";
import {
  axeToAssessment,
  combineAxeResults,
  type AxeResults,
  type AxePage,
} from "../src/integrations/axe.js";
import { mergeAssessments } from "../src/integrations/combined.js";
import { formatConsole, formatJson, formatMarkdown } from "../src/report.js";
import { createJiraTickets } from "../src/integrations/jira.js";
import type { Assessment, Severity, WcagLevel, Platform } from "../src/types.js";
import { readSitemap } from "../src/sitemap.js";
import {
  resolveFormFactor,
  puppeteerViewport,
  type FormFactorConfig,
} from "../src/formFactor.js";
import { mapWithConcurrency, resolveConcurrency } from "../src/concurrency.js";
import { runLighthouse } from "./lighthouseRunner.js";

interface Args {
  urls: string[];
  urlsFile?: string;
  sitemap?: string;
  lhrFile?: string;
  axeFile?: string;
  level: WcagLevel;
  format: "console" | "json" | "markdown";
  out?: string;
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
      case "--results": args.axeFile = argv[++i]; break;
      case "--urls": args.urlsFile = argv[++i]; break;
      case "--sitemap": args.sitemap = argv[++i]; break;
      case "--level": args.level = argv[++i] as WcagLevel; break;
      case "--format": args.format = argv[++i] as Args["format"]; break;
      case "--out": args.out = argv[++i]; break;
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

function readUrlsFile(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}


interface PuppeteerBrowser {
  newPage(): Promise<{
    goto(url: string, opts?: Record<string, unknown>): Promise<unknown>;
    setViewport(vp: Record<string, unknown>): Promise<void>;
    setUserAgent(ua: string): Promise<void>;
  }>;
  close(): Promise<void>;
}

/** Run a live axe-core accessibility scan against a URL using Puppeteer. */
async function runAxe(url: string, ff: FormFactorConfig): Promise<AxeResults> {
  let puppeteer: { launch(opts?: Record<string, unknown>): Promise<PuppeteerBrowser> };
  let AxePuppeteer: new (page: unknown) => { analyze(): Promise<AxeResults> };
  try {
    puppeteer = ((await import("puppeteer" as string)) as { default?: unknown }).default as typeof puppeteer;
    AxePuppeteer = ((await import("@axe-core/puppeteer" as string)) as { AxePuppeteer: typeof AxePuppeteer }).AxePuppeteer;
  } catch {
    throw new Error("Live axe scans require: npm install -D puppeteer @axe-core/puppeteer");
  }
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport(puppeteerViewport(ff));
    await page.setUserAgent(ff.userAgent);
    await page.goto(url, { waitUntil: "networkidle2" });
    const results = await new AxePuppeteer(page).analyze();
    return { ...results, url };
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ff = resolveFormFactor(args.formFactor);
  const platform = (args.platform ?? "web") as Platform;

  const urls = [...args.urls];
  if (args.urlsFile) urls.push(...readUrlsFile(args.urlsFile));
  if (args.sitemap) urls.push(...(await readSitemap(args.sitemap)));
  const uniqueUrls = [...new Set(urls)];

  const offline = Boolean(args.lhrFile || args.axeFile);
  if (uniqueUrls.length === 0 && !offline) {
    process.stderr.write(
      "Usage: npm run scan:all -- <url> [<url> ...] | --urls <file> | --sitemap <url> | --lhr <lhr.json> --results <axe.json> [--concurrency <n>] [--format ...] [--out ...] [--jira]\n",
    );
    process.exitCode = 1;
    return;
  }

  const assessments: Assessment[] = [];

  if (offline) {
    // Offline mode: read pre-computed engine outputs.
    if (args.lhrFile) {
      const lhr = JSON.parse(readFileSync(args.lhrFile, "utf8")) as LighthouseResult;
      assessments.push(lighthouseToAssessment(lhr, { targetLevel: args.level, platform }));
    }
    if (args.axeFile) {
      const axe = JSON.parse(readFileSync(args.axeFile, "utf8")) as AxeResults;
      assessments.push(axeToAssessment(axe, { targetLevel: args.level, platform }));
    }
  } else {
    // Live mode: run both engines against every page.
    const concurrency = resolveConcurrency(args.concurrency);
    process.stdout.write(
      `Scanning ${uniqueUrls.length} page(s) with Lighthouse + axe-core [${ff.formFactor} ${ff.width}x${ff.height}, concurrency ${concurrency}]...\n`,
    );
    const scanned = await mapWithConcurrency(uniqueUrls, concurrency, async (url, index) => {
      const position = `[${index + 1}/${uniqueUrls.length}]`;
      let lhr: LighthouseResult | undefined;
      let axe: AxeResults | undefined;
      try {
        lhr = await runLighthouse(url, ff);
      } catch (err) {
        process.stderr.write(`    ! lighthouse skipped ${url} (${err instanceof Error ? err.message : String(err)})\n`);
      }
      try {
        axe = await runAxe(url, ff);
      } catch (err) {
        process.stderr.write(`    ! axe skipped ${url} (${err instanceof Error ? err.message : String(err)})\n`);
      }
      process.stdout.write(`  ✓ ${position} ${url}\n`);
      return { url, lhr, axe };
    });

    // Results come back in input order, so reports stay stable run to run.
    const lhPages: LighthousePage[] = scanned
      .filter((r): r is typeof r & { lhr: LighthouseResult } => Boolean(r.lhr))
      .map((r) => ({ url: r.url, lhr: r.lhr }));
    const axePages: AxePage[] = scanned
      .filter((r): r is typeof r & { axe: AxeResults } => Boolean(r.axe))
      .map((r) => ({ url: r.url, results: r.axe }));

    if (lhPages.length > 0) assessments.push(combineLighthouseResults(lhPages, { targetLevel: args.level, platform }));
    if (axePages.length > 0) assessments.push(combineAxeResults(axePages, { targetLevel: args.level, platform }));
  }

  if (assessments.length === 0) throw new Error("No results from either engine.");

  const assessment = mergeAssessments(assessments, { targetLevel: args.level });

  const output =
    args.format === "json"
      ? formatJson(assessment)
      : args.format === "markdown"
        ? formatMarkdown(assessment)
        : formatConsole(assessment);

  if (args.out) {
    writeFileSync(args.out, output, "utf8");
    process.stdout.write(`Combined report written to ${args.out}\n`);
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
