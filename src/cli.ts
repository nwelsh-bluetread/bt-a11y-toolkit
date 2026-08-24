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
import type { A11yNode, Platform, Severity, WcagLevel } from "./types.js";

interface ParsedArgs {
  command?: string;
  file?: string;
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
        if (arg && !arg.startsWith("--")) args.file = arg;
    }
  }
  return args;
}

const HELP = `bt-a11y — BlueTread Accessibility Toolkit

Usage:
  bt-a11y audit <tree.json> [options]

Options:
  --platform <web|ios|android|react-native>   Target platform (default: web)
  --level <A|AA|AAA>                           Target WCAG level (default: AA)
  --format <console|json|markdown>             Report format (default: console)
  --out <file>                                 Write report to a file
  --min-target <px>                            Minimum touch target size (default: 24 for AA, 44 for AAA)
  --jira                                       Create Jira tickets from findings
  --min-severity <critical|high|medium|low>    Only ticket findings at/above this severity
  -h, --help                                   Show this help

Environment (for --jira):
  JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(HELP);
    return;
  }

  const args = parseArgs(argv);
  if (args.command !== "audit") {
    process.stderr.write(`Unknown command: ${args.command ?? "(none)"}\n\n${HELP}`);
    process.exitCode = 1;
    return;
  }
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

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
