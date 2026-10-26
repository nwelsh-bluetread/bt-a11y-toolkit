#!/usr/bin/env node
/**
 * bt-a11y CLI
 *
 * Runs the toolkit against a JSON file describing an {@link A11yNode} tree (as
 * exported by a platform adapter) and prints/writes a report. Optionally creates
 * Jira tickets from the findings.
 *
 * Usage:
 *   bt-a11y start                    (guided audit: a few questions, then scans + per-screen checklist)
 *   bt-a11y checklist                (open the checklist GUI in the browser)
 *   bt-a11y target-size              (measure touch targets on an Android device)
 *   bt-a11y report                   (build the audit from scans + the filled-in checklist)
 *   bt-a11y code [dir]               (scan React Native source code)
 *   bt-a11y audit <tree.json> [--platform web|ios|android|react-native]
 *                             [--level A|AA|AAA]
 *                             [--format console|json|markdown]
 *                             [--out <file>]
 *                             [--min-target <px>]
 *                             [--jira --min-severity high]
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  pdf: boolean;
  waitMs?: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    urls: [],
    platform: "web",
    level: "AA",
    format: "console",
    jira: false,
    pdf: true,
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
      case "--wait":
        args.waitMs = Number(rest[++i]);
        break;
      case "--no-pdf":
        args.pdf = false;
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
  bt-a11y                       Same as 'bt-a11y start'
  bt-a11y start                 Guided audit: a few questions → scans → per-screen checklist
  bt-a11y checklist             Open the checklist GUI (a11y-audit/checklist.html) in the browser
  bt-a11y target-size [--wait <ms>]  Measure touch targets (WCAG 2.5.8) on an Android device
  bt-a11y report [options]      Build the audit from the scans + filled-in a11y-audit/checklist.md
  bt-a11y code [dir] [options]  Scan React Native source code (default: current folder)
  bt-a11y pdf-setup             Check/install what the summary PDF needs (Chrome, pikepdf, veraPDF)
  bt-a11y update                Update the toolkit to the latest version from GitHub
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
  start         Asks for the project name, website vs. mobile app, WCAG level, and
                the screens (found in the code) or pages to audit. Then runs the
                automated checks on its own and writes a per-screen manual
                checklist to a11y-audit/checklist.md for testers to fill in.
  checklist     Refreshes a11y-audit/checklist.html and opens it. It edits
                a11y-audit/checklist.md in place: pass / fail / N/A buttons,
                issue fields with severity, progress per screen. Chrome or Edge
                save straight to the file; other browsers download it.
  target-size   Measures every tappable control on a connected Android phone or
                emulator (adb), screen by screen: deep-linked screens open on
                their own, you open the rest. Controls under 24×24 dp fail
                unless they're spaced apart (the WCAG exception). Fills in the
                target-size line on checklist.md for each measured screen.
                --wait sets the pause after each deep link (default 2500).
  report        Reads the scans + a11y-audit/checklist.md and writes
                a11y-audit/report.md + report.json (with the WCAG 2.2 coverage
                matrix) and the executive-summary PDF
                (a11y-audit/a11y-audit-summary-<date>.pdf, needs Chrome).
                Honors --jira, --min-severity, and --no-pdf.
  code          Statically scan a React Native project's source (and app.json,
                Info.plist, AndroidManifest.xml) for accessibility problems.
                Honors --level, --format, --out, --jira, --min-severity.
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
  --no-pdf                                     Skip the summary PDF (report)
  --jira                                       Create Jira tickets from findings
  --min-severity <critical|high|medium|low>    Only ticket findings at/above this severity
  -h, --help                                   Show this help

Live Lighthouse scans require optional deps:
  npm install -D lighthouse chrome-launcher
Live axe scans require optional deps:
  npm install -D playwright @axe-core/playwright && npx playwright install chromium

Environment (for --jira and the guided audit's Jira step; read from ./.env too):
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

  if (args.jira) await fileJiraTickets(assessment, args);
}

/** Create Jira tickets for an assessment's findings (needs JIRA_* env vars). */
async function fileJiraTickets(assessment: Assessment, args: ParsedArgs): Promise<void> {
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

/** Print a one-line notice when a newer toolkit version is on GitHub (silent otherwise). */
async function notifyIfOutdated(): Promise<void> {
  const { checkForUpdate } = await import("./update.js");
  const update = await checkForUpdate();
  if (update) {
    process.stdout.write(
      `\n  A newer version of bt-a11y is available (${update.installed.slice(0, 7)} → ${update.latest.slice(0, 7)}). Update with: npx bt-a11y update\n`,
    );
  }
}

/** Reinstall the toolkit from GitHub in the current project. */
async function runUpdateCommand(): Promise<void> {
  const { checkForUpdate, dependencySpec, INSTALL_SPEC, installedCommit, latestCommit } = await import("./update.js");
  const cwd = process.cwd();
  const spec = dependencySpec(cwd);
  if (!spec) {
    process.stderr.write(`This folder's package.json doesn't list the toolkit. Run this from the project you installed it in, or install it with:\n  npm install -D ${INSTALL_SPEC}\n`);
    process.exitCode = 1;
    return;
  }
  if (spec.includes("#")) {
    process.stdout.write(`This project is pinned to ${spec}, so it stays on that version.\nTo move to the latest instead: npm install -D ${INSTALL_SPEC}\n`);
    return;
  }
  const before = installedCommit();
  if (before && !(await checkForUpdate()) && (await latestCommit())) {
    process.stdout.write(`Already up to date (${before.slice(0, 7)}).\n`);
    return;
  }
  process.stdout.write(`Updating from ${INSTALL_SPEC}…\n`);
  const code = await new Promise<number>((resolve) => {
    const child = spawn("npm", ["install", "-D", INSTALL_SPEC], { cwd, stdio: "inherit", shell: process.platform === "win32" });
    child.on("close", (c) => resolve(c ?? 1));
    child.on("error", () => resolve(1));
  });
  if (code !== 0) {
    process.stderr.write(`Update failed. Try: npm install -D ${INSTALL_SPEC}\n`);
    process.exitCode = 1;
    return;
  }
  const after = await latestCommit();
  process.stdout.write(`\n✓ Updated${before && after ? ` (${before.slice(0, 7)} → ${after.slice(0, 7)})` : ""}. Run npx bt-a11y as usual.\n`);
}

async function runStartCommand(): Promise<void> {
  await notifyIfOutdated();
  const [{ runWizard }, { inquirerPrompter, isPromptExit }, lighthouseRunner] = await Promise.all([
    import("./wizard/index.js"),
    import("./wizard/prompts.js"),
    import("./integrations/lighthouse-runner.js"),
  ]);
  const cwd = process.cwd();
  try {
    await runWizard({
      prompter: await inquirerPrompter(),
      cwd,
      out: (text) => process.stdout.write(text + "\n"),
      resolveUrls: lighthouseRunner.resolveUrls,
      scanAxe: async (urls, level, onProgress) => {
        const { scanUrlsWithAxe } = await import("./integrations/axe-runner.js");
        return (await scanUrlsWithAxe(urls, { targetLevel: level, onProgress })).assessment;
      },
      scanLighthouse: async (urls, level, onProgress) =>
        (await lighthouseRunner.scanUrls(urls, { targetLevel: level, onProgress })).assessment,
      scanCode: async (root, level, platforms) => {
        const { scanReactNative } = await import("./code-scan/react-native.js");
        return scanReactNative(root, { targetLevel: level, platforms });
      },
      discoverScreens: async (root) => {
        const { discoverScreens } = await import("./code-scan/screens.js");
        return discoverScreens(root);
      },
      hasModule: async (name) => {
        try {
          await import(name);
          return true;
        } catch {
          return false;
        }
      },
      runCommand: (cmd, cmdArgs) =>
        new Promise((resolve) => {
          const child = spawn(cmd, cmdArgs, { cwd, stdio: "inherit", shell: process.platform === "win32" });
          child.on("close", (code) => resolve(code ?? 1));
          child.on("error", () => resolve(1));
        }),
    });
  } catch (err) {
    if (!isPromptExit(err)) throw err;
    process.stdout.write("\n\nStopped. Run 'bt-a11y start' again to pick up.\n");
  }
}

async function runChecklistCommand(): Promise<void> {
  const { checklistPath, installChecklistUi } = await import("./wizard/session.js");
  const { existsSync } = await import("node:fs");
  const cwd = process.cwd();
  if (!existsSync(checklistPath(cwd))) {
    process.stderr.write("No a11y-audit/checklist.md here yet. Run 'bt-a11y start' first.\n");
    process.exitCode = 1;
    return;
  }
  const ui = installChecklistUi(cwd);
  process.stdout.write(`Checklist app: ${ui}\nOpen ${checklistPath(cwd)} from it. Use Chrome or Edge so marks save straight to the file.\n`);
  const [cmd, cmdArgs] =
    process.platform === "darwin" ? ["open", [ui]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", ui]] : ["xdg-open", [ui]];
  spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

async function runTargetSizeCommand(args: ParsedArgs): Promise<void> {
  const [{ runTargetSize, systemAdb }, { inquirerPrompter, isPromptExit }, { writeChecklistFiles }] = await Promise.all([
    import("./device/android.js"),
    import("./wizard/prompts.js"),
    import("./wizard/index.js"),
  ]);
  try {
    await runTargetSize({
      cwd: process.cwd(),
      prompter: await inquirerPrompter(),
      out: (text) => process.stdout.write(text + "\n"),
      adb: systemAdb(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      waitMs: args.waitMs,
      writeChecklist: (cwd, session) => void writeChecklistFiles(cwd, session),
    });
  } catch (err) {
    if (isPromptExit(err)) return;
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}

async function runCodeCommand(args: ParsedArgs): Promise<void> {
  const { scanReactNative } = await import("./code-scan/react-native.js");
  const { findingsToAssessment } = await import("./audit.js");
  const root = args.file ?? ".";
  const result = await scanReactNative(root, { targetLevel: args.level });
  process.stderr.write(
    `Scanned ${result.filesScanned} files in ${root} · checked ${result.checked.length} WCAG criteria: ${result.checked.join(", ")}\n`,
  );
  for (const s of result.signals) process.stderr.write(`  verify: ${s.message}\n`);
  await report(
    findingsToAssessment(result.findings, { platforms: ["ios", "android"], targetLevel: args.level }),
    args,
  );
}

/** Install PDF/UA support up front and report what the PDF step needs. */
async function runPdfSetupCommand(): Promise<void> {
  const { ensurePdfUaPython, hasCommand, PDF_VENV } = await import("./pdf/pdfua.js");
  const { existsSync } = await import("node:fs");
  const chromeCandidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  const chrome = chromeCandidates.find((c) => c && existsSync(c));
  const line = (ok: boolean, text: string) => process.stdout.write(`${ok ? "✓" : "✗"} ${text}\n`);

  line(Boolean(chrome), chrome ? `Chrome: ${chrome}` : "Chrome: not found — install Google Chrome (or set CHROME_PATH). Required to build the PDF.");
  let ok = Boolean(chrome);
  try {
    const python = await ensurePdfUaPython((l) => process.stdout.write(`  ${l}\n`));
    line(true, `PDF/UA fix-up (pikepdf): ${python}`);
  } catch (err) {
    ok = false;
    line(false, `PDF/UA fix-up (pikepdf): ${err instanceof Error ? err.message : String(err)}`);
  }
  const verapdf = await hasCommand("verapdf", ["--version"]);
  line(verapdf, verapdf ? "veraPDF: installed — every PDF is checked automatically" : "veraPDF: not installed (optional) — to check PDFs automatically: brew install verapdf");
  process.stdout.write(ok ? "\nReady: `bt-a11y report` will build PDF/UA-1 PDFs.\n" : `\nFix the ✗ items above, then run \`bt-a11y pdf-setup\` again. (Python environment: ${PDF_VENV})\n`);
  if (!ok) process.exitCode = 1;
}

async function runReportCommand(args: ParsedArgs): Promise<void> {
  const { loadSession, writeReports } = await import("./wizard/session.js");
  const { coverageSummaryLines } = await import("./wizard/coverage.js");
  const session = loadSession(process.cwd());
  if (!session) {
    process.stderr.write("No guided audit found in ./a11y-audit. Run 'bt-a11y start' first.\n");
    process.exitCode = 1;
    return;
  }
  const { assessment, coverage, checklist, blocked, quickWins, markdown, json } = writeReports(process.cwd(), session);
  for (const w of checklist.warnings) process.stderr.write(`Checklist warning — ${w}\n`);
  const rows = checklist.rows;
  const prefilled = rows.filter((r) => r.reviewed === false).length;
  const done = rows.filter((r) => r.status !== "open" && r.reviewed !== false).length;
  process.stdout.write(`${formatConsole(assessment)}\n\n`);
  process.stdout.write(
    `Checklist: ${done}/${rows.length} checks answered by testers · ${rows.filter((r) => r.status === "fail" && r.reviewed !== false).length} failed` +
      (prefilled ? ` · ${prefilled} failed by the scan but not reviewed yet (delete "not reviewed yet" once tested)` : "") +
      "\n",
  );
  const { topQuickWins, quickWinTitle, effortText, impactText } = await import("./wizard/quick-wins.js");
  const top = topQuickWins(quickWins, 3);
  if (top.length) {
    process.stdout.write("Fix these first (details in report.md):\n");
    for (const w of top) process.stdout.write(`  ${w.quickWin ? "⚡" : "•"} ${quickWinTitle(w)}: ${effortText(w)} → ${impactText(w)}\n`);
  }
  if (blocked.length) {
    const label: Record<string, string> = { ios: "iOS", android: "Android", web: "Web" };
    process.stdout.write(`Blocked screens (${blocked.length}), listed in the report:\n`);
    for (const b of blocked) process.stdout.write(`  ⊘ ${b.screen} (${b.platforms.map((p) => label[p]).join(", ")})${b.reasons.length ? ` — ${b.reasons.join("; ")}` : ""}\n`);
  }
  process.stdout.write(`WCAG 2.2 criteria coverage:\n${coverageSummaryLines(coverage).map((l) => `  ${l}`).join("\n")}\n`);
  process.stdout.write(`\nReport written:\n  ${markdown}\n  ${json}\n`);

  if (args.pdf) {
    const { buildSummaryData, loadSummaryOverrides, renderSummaryPdf, summaryPdfName } = await import("./pdf/summary.js");
    const dir = join(process.cwd(), "a11y-audit");
    const dataPath = join(dir, "a11y-audit-summary.json");
    const pdfPath = join(dir, summaryPdfName());
    writeFileSync(dataPath, JSON.stringify(buildSummaryData(session, assessment, checklist, loadSummaryOverrides(dir)), null, 2) + "\n");
    process.stdout.write("\nBuilding the summary PDF…\n");
    const { ensurePdfUaPython, verifyPdfUa } = await import("./pdf/pdfua.js");
    let python: string | undefined;
    try {
      python = await ensurePdfUaPython((line) => process.stdout.write(`  ${line}\n`));
    } catch (err) {
      process.stderr.write(`  ⚠ ${err instanceof Error ? err.message : String(err)}\n  The PDF will be tagged but won't pass PDF/UA-1.\n`);
    }
    try {
      await renderSummaryPdf(dataPath, pdfPath, python);
      process.stdout.write(`  ${pdfPath}\n`);
      const check = await verifyPdfUa(pdfPath);
      if (check.status === "pass") process.stdout.write("  ✓ PDF/UA-1: PASS (veraPDF)\n");
      else if (check.status === "fail") {
        process.stderr.write(`  ✗ PDF/UA-1: FAIL — ${check.failedRules} rule(s) failed (${check.details}). Run: verapdf --flavour ua1 "${pdfPath}"\n`);
        process.exitCode = 1;
      } else if (python) process.stdout.write("  PDF/UA-1 fix-up applied. Install veraPDF to verify it automatically: brew install verapdf\n");
    } catch (err) {
      process.stderr.write(`  Couldn't build the PDF: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  if (args.jira) await fileJiraTickets(assessment, args);
}

/** Load ./.env (e.g. JIRA_* credentials) when present. Needs Node 20.12+; existing env vars win. */
function loadDotEnv(): void {
  try {
    process.loadEnvFile?.(".env");
  } catch {
    // No .env file — nothing to load.
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(HELP);
    return;
  }
  if (argv.length === 0) {
    if (process.stdin.isTTY) await runStartCommand();
    else process.stdout.write(HELP);
    return;
  }

  const args = parseArgs(argv);
  switch (args.command) {
    case "start":
      await runStartCommand();
      break;
    case "checklist":
      await runChecklistCommand();
      break;
    case "target-size":
      await runTargetSizeCommand(args);
      break;
    case "report":
      await runReportCommand(args);
      break;
    case "code":
      await runCodeCommand(args);
      break;
    case "pdf-setup":
      await runPdfSetupCommand();
      break;
    case "update":
      await runUpdateCommand();
      break;
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
