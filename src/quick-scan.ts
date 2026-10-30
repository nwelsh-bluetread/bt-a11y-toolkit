/**
 * `bt-a11y quick <url>` — a small, automated-only audit of one web page.
 *
 * Runs axe-core and Lighthouse on the page, then writes a markdown report, the
 * summary data, and an executive-summary PDF to ./a11y-quick-scan/. No manual
 * checklist: every criterion the scanners didn't fail is "not yet verified".
 *
 * It never reads or writes a11y-audit/, so a full audit in the same folder is
 * left alone.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { screensFromUrls } from "./code-scan/screens.js";
import { buildSummaryData, type SummaryData } from "./pdf/summary.js";
import { formatMarkdown } from "./report.js";
import type { Assessment, WcagLevel } from "./types.js";
import { emptyChecklist } from "./wizard/checklist-md.js";
import { buildCoverage, conformance, formatConformanceMarkdown } from "./wizard/coverage.js";
import { buildSessionAssessment, newSession, upsertRun, type AuditSession } from "./wizard/session.js";
import { SCANNERS, WEB_CHECKED, webScannersToRun, type ScannerId, type ScannerSetupDeps } from "./wizard/web-scanners.js";

export const QUICK_SCAN_DIR = "a11y-quick-scan";

type ScanProgress = (event:
  | { type: "start"; total: number }
  | { type: "page"; url: string; index: number; total: number }
  | { type: "skip"; url: string; error: string }) => void;

export interface QuickScanDeps extends ScannerSetupDeps {
  cwd: string;
  scanAxe: (urls: string[], level: WcagLevel, onProgress: ScanProgress) => Promise<Assessment>;
  scanLighthouse: (urls: string[], level: WcagLevel, onProgress: ScanProgress) => Promise<Assessment>;
  /** Render the summary JSON to a PDF. Resolves to whether a PDF was written. Omit to skip the PDF. */
  buildPdf?: (dataPath: string, pdfPath: string) => Promise<boolean>;
}

export interface QuickScanOptions {
  /** The page to scan. Asked for when missing. */
  url?: string;
  /** Target WCAG level. Asked for when missing (interactive) — pass it to skip the question. */
  level?: WcagLevel;
  /** Title on the report (default: the site's host name). */
  name?: string;
}

export interface QuickScanResult {
  assessment: Assessment;
  markdown: string;
  json: string;
  pdf?: string;
}

/** Ask for anything missing, scan the page, and write the report files. Returns undefined when no scanner could run. */
export async function runQuickScan(deps: QuickScanDeps, opts: QuickScanOptions = {}): Promise<QuickScanResult | undefined> {
  const { prompter: p, out, cwd } = deps;
  const url =
    opts.url ??
    (await p.input("Page URL to scan:", {
      required: true,
      validate: (v) => (isHttpUrl(v.trim()) ? true : "Enter a full URL starting with http:// or https://"),
    })).trim();
  if (!isHttpUrl(url)) throw new Error(`Not a URL: ${url}. It must start with http:// or https://`);
  const level =
    opts.level ??
    (await p.select<WcagLevel>(
      "Target WCAG level?",
      [
        { name: "A", value: "A" },
        { name: "AA (recommended)", value: "AA" },
        { name: "AAA", value: "AAA" },
      ],
      { default: "AA" },
    ));

  const scanners = await webScannersToRun(deps);
  if (scanners.length === 0) {
    out("No scanners available, so nothing was scanned. Install them with:");
    out(`  npm install -D ${Object.values(SCANNERS).flatMap((s) => s.packages).join(" ")} && npx playwright install chromium`);
    return undefined;
  }

  const session = newSession({ name: opts.name ?? hostOf(url), type: "web", targets: ["web"], targetLevel: level, urls: [url] }, screensFromUrls([url]));
  out(`\nQuick scan of ${url} · WCAG ${level}`);
  for (const tool of scanners) {
    out(`  ${SCANNERS[tool].label}…`);
    const scan = tool === "axe" ? deps.scanAxe : deps.scanLighthouse;
    // A page that fails to load is reported as a skip; its reason is more useful than the runner's "No pages could be scanned".
    let skipped: string | undefined;
    try {
      const assessment = await scan([url], level, (e) => {
        if (e.type === "skip") skipped = e.error;
      });
      if (skipped) throw new Error(skipped);
      upsertRun(session, { tool, targets: ["web"], ranAt: new Date().toISOString(), pages: 1, wcag: assessment.wcag, checked: WEB_CHECKED[tool], findings: assessment.findings });
      out(`  ✓ ${SCANNERS[tool].label}: ${assessment.findings.length} finding${assessment.findings.length === 1 ? "" : "s"}`);
    } catch (err) {
      out(`  ✗ ${SCANNERS[tool].label} failed: ${skipped ?? (err instanceof Error ? err.message : String(err))}`);
    }
  }
  if (session.automated.length === 0) {
    out("\nNo scanner could load the page, so there's no report. Check the URL is reachable from this computer.");
    return undefined;
  }

  const assessment = buildSessionAssessment(session);
  const dir = join(cwd, QUICK_SCAN_DIR);
  mkdirSync(dir, { recursive: true });
  const base = quickScanBaseName(url);
  const markdown = join(dir, `${base}.md`);
  const json = join(dir, `${base}.json`);
  writeFileSync(markdown, quickScanMarkdown(session, assessment) + "\n", "utf8");
  writeFileSync(json, JSON.stringify(quickSummaryData(session, assessment), null, 2) + "\n", "utf8");

  let pdf: string | undefined;
  if (deps.buildPdf) {
    const path = join(dir, `${base}.pdf`);
    if (await deps.buildPdf(json, path)) pdf = path;
  }
  return { assessment, markdown, json, ...(pdf ? { pdf } : {}) };
}

/** The PDF's input: the guided audit's summary, reworded for an automated-only scan of one page. */
export function quickSummaryData(session: AuditSession, assessment: Assessment, now = new Date()): SummaryData {
  const { project } = session;
  const url = project.urls![0]!;
  const tools = session.automated.map((r) => SCANNERS[r.tool as ScannerId]?.label ?? r.tool);
  const coverage = buildCoverage(session, emptyChecklist());
  const data = buildSummaryData(session, assessment, emptyChecklist(), {}, now);
  // Nothing passes without manual testing, so per-level pass rates would read 0%. Leave them out.
  delete data.levelPassing;
  delete data.levelNote;
  for (const row of coverage.rows) {
    if (row.byTarget.web?.status === "scan-clear") data.criteriaResults![row.id] = { result: "not-verified", note: "Scanners found no issues; needs a manual check" };
  }
  const n = assessment.findings.length;
  return {
    ...data,
    scope: `1 page · ${url}`,
    subtitle: `Quick automated scan of one page against WCAG 2.2 Level ${project.targetLevel}, using ${tools.join(" and ")}. No manual testing was done, so this is a starting point, not a conformance assessment. Results are organized by the four POUR principles:`,
    keyTakeaway:
      n === 0
        ? "The automated scanners found no issues on this page. They cover only part of WCAG, so keyboard, screen reader, and zoom testing is still needed before treating it as conformant."
        : data.keyTakeaway.replace(/ on Web\b/, " on this page"),
    footer:
      `Automated checks only (${tools.join(", ")}) on ${url}. Automated scanners cover roughly 30–40% of WCAG success criteria; ` +
      "keyboard, screen reader, zoom, and content review weren't part of this quick scan. A full audit is needed to confirm conformance.",
  };
}

function quickScanMarkdown(session: AuditSession, assessment: Assessment): string {
  const url = session.project.urls![0]!;
  const coverage = buildCoverage(session, emptyChecklist());
  const c = conformance(coverage);
  const intro = [
    `**Quick scan:** automated checks only (${session.automated.map((r) => SCANNERS[r.tool as ScannerId]?.label ?? r.tool).join(", ")}) of ${url}.`,
    `No manual testing was done. Scanners cover only part of WCAG: ${c.fail} criteria fail, and ${c.notVerified} still need a manual check.`,
  ].join(" ");
  return formatMarkdown(assessment)
    .replace("# Accessibility Assessment", `# Accessibility Quick Scan — ${session.project.name}\n\n${intro}`)
    .replace(/^- \*\*Overall score:\*\* (\d+)%$/m, (line) => `${line} (issue load, not a pass mark)`)
    .replace(/\n## Findings\n/, `\n${formatConformanceMarkdown(coverage)}\n\n## Findings\n`);
}

/** `a11y-quick-scan-example.com-pricing-2026-10-30` */
export function quickScanBaseName(url: string, date = new Date()): string {
  let slug = url;
  try {
    const u = new URL(url);
    slug = `${u.host}${u.pathname}`;
  } catch {
    // Not a URL — slugify as-is.
  }
  slug = slug.replace(/[^a-z0-9.]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80).toLowerCase();
  return `a11y-quick-scan-${slug}-${date.toISOString().slice(0, 10)}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value);
}
