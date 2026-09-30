#!/usr/bin/env node
/**
 * Manual checklist generator & ingest.
 *
 * Two modes:
 *
 *   1. `generate` — emit a manual test checklist (pages as columns) for the
 *      auditor to fill in. Pull the page list from args, a file, or a sitemap.
 *   2. `ingest` — read a filled-in checklist back into a toolkit report,
 *      optionally merging it with an automated assessment JSON so the final
 *      deliverable contains ALL findings (automated + manual) in one place.
 *
 * Usage:
 *   # Generate a blank AA checklist for three screens
 *   npm run checklist -- generate --level AA /login /dashboard /settings --out manual.md
 *
 *   # Pull pages from a sitemap, add gestures, write CSV
 *   npm run checklist -- generate --sitemap https://example.com/sitemap.xml \
 *     --gesture "swipe to delete" --gesture "pinch to zoom" --format csv --out manual.csv
 *
 *   # Ingest the completed checklist into a report
 *   npm run checklist -- ingest ./manual.md --format markdown --out manual-report.md
 *
 *   # Ingest AND merge with the automated scan into one unified report
 *   npm run checklist -- ingest ./manual.md --merge ./auto-assessment.json \
 *     --format markdown --out final-report.md
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  generateChecklistMarkdown,
  generateChecklistCsv,
  ingestChecklist,
} from "../src/manual.js";
import {
  computeOverallScore,
  computeTopIssues,
  countBySeverity,
} from "../src/audit.js";
import { mergeAssessments } from "../src/integrations/combined.js";
import { formatConsole, formatJson, formatMarkdown } from "../src/report.js";
import { readSitemap } from "../src/sitemap.js";
import type { Assessment, Finding, Platform, Severity, WcagLevel } from "../src/types.js";

interface Args {
  mode?: "generate" | "ingest";
  pages: string[];
  input?: string;
  sitemap?: string;
  gestures: string[];
  level: WcagLevel;
  format: "console" | "json" | "markdown" | "csv";
  out?: string;
  merge?: string;
  platform: Platform;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    pages: [],
    gestures: [],
    level: "AA",
    format: "markdown",
    platform: "web",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "generate":
      case "ingest":
        if (!args.mode) args.mode = a;
        break;
      case "--sitemap": args.sitemap = argv[++i]; break;
      case "--gesture": args.gestures.push(argv[++i]!); break;
      case "--level": args.level = argv[++i] as WcagLevel; break;
      case "--format": args.format = argv[++i] as Args["format"]; break;
      case "--out": args.out = argv[++i]; break;
      case "--merge": args.merge = argv[++i]; break;
      case "--platform": args.platform = argv[++i] as Platform; break;
      default:
        if (a && !a.startsWith("--")) {
          // In ingest mode the first positional is the input file; otherwise pages.
          if (args.mode === "ingest" && !args.input) args.input = a;
          else args.pages.push(a);
        }
    }
  }
  return args;
}

/** Read a page/URL list file (one per line, `#` comments and blanks ignored). */
function readListFile(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

/** Build a full assessment from a set of manual findings. */
function assessmentFromFindings(
  findings: Finding[],
  level: WcagLevel,
  platform: Platform,
): Assessment {
  const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];
  const byCategory = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = f.category ?? "Semantics";
    const list = byCategory.get(key) ?? [];
    list.push(f);
    byCategory.set(key, list);
  }
  const categories = [...byCategory.entries()]
    .map(([category, list]) => ({
      category,
      score: Math.max(0, 100 - list.length * 15),
      severity: SEVERITY_ORDER.find((s) => list.some((f) => f.severity === s)) ?? "low",
      findingCount: list.length,
    }))
    .sort((a, b) => a.score - b.score);

  return {
    generatedAt: new Date().toISOString(),
    platform,
    targetLevel: level,
    overallScore: computeOverallScore(findings, 100),
    counts: countBySeverity(findings),
    wcag: { A: 100, AA: 100, AAA: 100 },
    categories,
    topIssues: computeTopIssues(findings),
    findings,
  };
}

function render(assessment: Assessment, format: Args["format"]): string {
  if (format === "json") return formatJson(assessment);
  if (format === "console") return formatConsole(assessment);
  return formatMarkdown(assessment); // markdown (csv not applicable to reports)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.mode === "generate") {
    const pages = [...args.pages];
    if (args.sitemap) pages.push(...(await readSitemap(args.sitemap)));
    const uniquePages = [...new Set(pages)];
    if (uniquePages.length === 0) {
      process.stderr.write(
        "Usage: npm run checklist -- generate <page> [<page> ...] | --sitemap <url> [--level AA] [--gesture <name>] [--format markdown|csv] [--out <file>]\n",
      );
      process.exitCode = 1;
      return;
    }
    const output =
      args.format === "csv"
        ? generateChecklistCsv({ pages: uniquePages, level: args.level, gestures: args.gestures })
        : generateChecklistMarkdown({
            pages: uniquePages,
            level: args.level,
            gestures: args.gestures,
          });
    if (args.out) {
      writeFileSync(args.out, output, "utf8");
      process.stdout.write(
        `Checklist for ${uniquePages.length} page(s) written to ${args.out}\n`,
      );
    } else {
      process.stdout.write(output + "\n");
    }
    return;
  }

  if (args.mode === "ingest") {
    if (!args.input) {
      process.stderr.write(
        "Usage: npm run checklist -- ingest <completed-checklist.md> [--merge <assessment.json>] [--format ...] [--out ...]\n",
      );
      process.exitCode = 1;
      return;
    }
    const markdown = readFileSync(args.input, "utf8");
    const { findings, counts, byPage } = ingestChecklist(markdown, { platform: args.platform });
    process.stdout.write(
      `Ingested manual checklist: ${counts.fail} fail, ${counts.pass} pass, ${counts["n/a"]} n/a, ${counts.untested} untested.\n`,
    );
    for (const [page, pc] of Object.entries(byPage)) {
      process.stdout.write(`  ${page}: ${pc.fail} fail / ${pc.pass} pass / ${pc.untested} untested\n`);
    }

    const manualAssessment = assessmentFromFindings(findings, args.level, args.platform);

    let assessment = manualAssessment;
    if (args.merge) {
      const auto = JSON.parse(readFileSync(args.merge, "utf8")) as Assessment;
      assessment = mergeAssessments([auto, manualAssessment], { targetLevel: args.level });
    }

    const output = render(assessment, args.format);
    if (args.out) {
      writeFileSync(args.out, output, "utf8");
      process.stdout.write(`Report written to ${args.out}\n`);
    } else {
      process.stdout.write(output + "\n");
    }
    return;
  }

  process.stderr.write(
    "Usage: npm run checklist -- <generate|ingest> ...\n" +
      "  generate <page> [<page> ...] | --sitemap <url> [--level AA] [--gesture <name>] [--format markdown|csv] [--out <file>]\n" +
      "  ingest <completed-checklist.md> [--merge <assessment.json>] [--format markdown|json|console] [--out <file>]\n",
  );
  process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
