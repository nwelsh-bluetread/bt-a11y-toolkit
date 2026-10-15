/**
 * Executive-summary PDF for a guided audit.
 *
 * `buildSummaryData` turns the audit (scans + checklist) into the JSON the PDF
 * renderer expects; `renderSummaryPdf` runs the vendored renderer
 * (assets/pdf/render.mjs), which prints HTML with headless Chrome and, when
 * pikepdf is available, post-processes the file to PDF/UA-1.
 *
 * Wording on the cover (key takeaway, principle summaries) is generated from
 * the findings. Anything in `a11y-audit/summary-overrides.json` replaces the
 * generated value — e.g. a hand-written `keyTakeaway`, `title`, or `phases`.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuditTarget } from "../checklist.js";
import type { ScreenInfo } from "../code-scan/screens.js";
import type { Assessment, Finding, Severity } from "../types.js";
import type { ParsedChecklist } from "../wizard/checklist-md.js";
import type { AuditSession } from "../wizard/session.js";

/** One finding in the renderer's input schema. */
export interface SummaryFinding {
  title: string;
  /** Findings with the same group are merged in the PDF (pages unioned, ×N shown). */
  group: string;
  rule: string;
  severity: Severity;
  reportedBy: string;
  wcag: string[];
  pages: string[];
  location?: string;
  element?: string;
  description: string;
  remediation?: string;
}

/** The renderer's input schema (see the a11y-report-pdf skill). */
export interface SummaryData {
  title: string;
  auditDate: string;
  generated: string;
  targetLevel: string;
  scope: string;
  /** "screen" for mobile-only audits, so the PDF says "3 screens" rather than "3 pages". */
  pageNoun: string;
  preparedBy: string;
  overallScore: number;
  scoreNote?: string;
  levelPassing?: Record<string, number>;
  keyTakeaway: string;
  principleSummaries: Record<string, string>;
  scorecard: Array<{ category: string; score: number; priority: string; findings: number }>;
  findings: SummaryFinding[];
  footer: string;
  [override: string]: unknown;
}

const TARGET_LABEL: Record<AuditTarget, string> = { web: "Web", ios: "iOS", android: "Android" };
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const PRINCIPLE_OF = (wcag: string[]) => "POUR"[Number(wcag[0]?.[0] ?? 4) - 1] ?? "R";

export function summaryPdfName(date = new Date()): string {
  return `a11y-audit-summary-${date.toISOString().slice(0, 10)}.pdf`;
}

export function buildSummaryData(
  session: AuditSession,
  assessment: Assessment,
  checklist: ParsedChecklist,
  overrides: Record<string, unknown> = {},
  now = new Date(),
): SummaryData {
  const { project, screens } = session;
  const findings = assessment.findings.map((f) => toSummaryFinding(f, screens, project.targets));
  const counts = assessment.counts;

  const mobile = screens.filter((s) => s.kind === "mobile").length;
  const pages = screens.filter((s) => s.kind === "web").length;
  const platforms = project.targets.map((t) => TARGET_LABEL[t]).join(" + ");
  const scope = [mobile && `${mobile} screen${mobile === 1 ? "" : "s"}`, pages && `${pages} page${pages === 1 ? "" : "s"}`]
    .filter(Boolean)
    .join(" + ");

  const answered = checklist.rows.filter((r) => r.status !== "open").length;
  const tools = [...new Set(session.automated.map((r) => TOOL_LABEL[r.tool] ?? r.tool))];

  const data: SummaryData = {
    title: project.name,
    auditDate: now.toISOString().slice(0, 10),
    generated: now.toISOString(),
    targetLevel: project.targetLevel,
    scope: `${scope || "App"} · ${platforms}`,
    pageNoun: pages && !mobile ? "page" : mobile && !pages ? "screen" : "screen/page",
    preparedBy: "BlueTread",
    overallScore: assessment.overallScore,
    ...(answered > 0 || session.automated.length > 0 ? { levelPassing: assessment.wcag } : {}),
    keyTakeaway: keyTakeaway(findings, counts, platforms),
    principleSummaries: principleSummaries(findings),
    scorecard: assessment.categories.map((c) => ({
      category: c.category,
      score: c.score,
      priority: c.severity[0]!.toUpperCase() + c.severity.slice(1),
      findings: c.findingCount,
    })),
    findings,
    footer:
      `Automated checks (${tools.length ? tools.join(", ") : "none run"}) cover only part of WCAG. ` +
      `Findings marked "manual" come from hands-on screen reader and device testing (${answered} of ${checklist.rows.length} checklist checks completed). ` +
      "Full conformance requires manual review of every flow.",
  };
  return { ...data, ...overrides };
}

const TOOL_LABEL: Record<string, string> = { "rn-code-scan": "React Native code scan", axe: "axe-core", lighthouse: "Lighthouse" };

function toSummaryFinding(f: Finding, screens: ScreenInfo[], targets: AuditTarget[]): SummaryFinding {
  const file = typeof f.evidence?.file === "string" ? f.evidence.file : undefined;
  const lines = Array.isArray(f.evidence?.lines) ? (f.evidence.lines as number[]) : [];
  const page = typeof f.evidence?.page === "string" && !file ? f.evidence.page : undefined;
  const screen = typeof f.evidence?.screen === "string" ? f.evidence.screen : undefined;
  // Show the platform only when the audit covers more than one and the finding doesn't apply to all of them.
  const platforms = (f.platforms ?? []).filter((p): p is AuditTarget => targets.includes(p as AuditTarget));
  const tag = platforms.length && platforms.length < targets.length ? ` (${platforms.map((p) => TARGET_LABEL[p]).join(", ")})` : "";

  let where: string[];
  if (file) {
    const onScreens = screens.filter((s) => s.files?.includes(file)).map((s) => s.name);
    where = onScreens.length ? onScreens.map((n) => `${n}${tag}`) : [`App-wide${tag}`];
  } else if (page) {
    where = [page];
  } else {
    where = [`${screen ?? f.nodeId ?? "App-wide"}${tag}`];
  }

  // Code-scan titles end in " — path"; the path goes in Location instead.
  const title = f.title.replace(/ \(\d+×\)/, "").split(" — ")[0]!;
  return {
    title,
    group: f.source === "manual" ? `${f.ruleId}|${title}` : f.ruleId,
    rule: f.ruleId,
    severity: f.severity,
    reportedBy: f.source === "rn-code-scan" ? "code scan" : (f.source ?? "manual"),
    wcag: f.wcag.map((c) => c.id),
    pages: where,
    ...(file ? { location: `${file}${lines.length ? `:${lines.slice(0, 10).join(", ")}${lines.length > 10 ? ", …" : ""}` : ""}` } : {}),
    ...(page && f.nodeId && f.nodeId !== page ? { element: f.nodeId } : {}),
    description: f.description || title,
    ...(f.remediation ? { remediation: f.remediation } : {}),
  };
}

function keyTakeaway(findings: SummaryFinding[], counts: Record<Severity, number>, platforms: string): string {
  if (findings.length === 0) return `No accessibility issues found so far on ${platforms}. Finish the manual checklist before treating this as conformant.`;
  const worst = [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0]!;
  const serious = counts.critical + counts.high;
  const lead = serious
    ? `${[counts.critical && `${counts.critical} critical`, counts.high && `${counts.high} high-severity`].filter(Boolean).join(" and ")} issue${serious === 1 ? " creates" : "s create"} barriers on ${platforms}.`
    : `${findings.length} lower-severity issue${findings.length === 1 ? "" : "s"} found on ${platforms}.`;
  return `${lead} Fix first: ${worst.title.replace(/[.\s]+$/, "")}.`;
}

function principleSummaries(findings: SummaryFinding[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["P", "O", "U", "R"]) {
    const list = findings.filter((f) => PRINCIPLE_OF(f.wcag) === key).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    if (list.length === 0) continue;
    const top = [...new Set(list.map((f) => f.title))].slice(0, 2);
    out[key] = `Most serious: ${top.join("; ")}.`;
  }
  return out;
}

/** Overrides from a11y-audit/summary-overrides.json, if present. */
export function loadSummaryOverrides(dir: string): Record<string, unknown> {
  const path = join(dir, "summary-overrides.json");
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/** Path to the vendored renderer (works from src/ under tsx and from dist/). */
export function rendererPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "pdf", "render.mjs");
}

/**
 * Render the PDF. Pass `pdfuaPython` (a Python with pikepdf) to apply the
 * PDF/UA-1 fix-up. Resolves with the renderer's output; rejects with a
 * readable message when Chrome isn't available or rendering fails.
 */
export function renderSummaryPdf(jsonPath: string, pdfPath: string, pdfuaPython?: string): Promise<string> {
  const env = pdfuaPython ? { ...process.env, PDFUA_PYTHON: pdfuaPython } : process.env;
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [rendererPath(), jsonPath, pdfPath], { timeout: 120_000, env }, (err, stdout, stderr) => {
      if (err) {
        // The renderer exits with code 2 when it can't find Chrome.
        const missingChrome = (err as { code?: unknown }).code === 2 || /No Chrome/.test(stderr);
        reject(new Error(missingChrome ? "Chrome/Chromium not found — install Google Chrome or set CHROME_PATH." : stderr.trim() || err.message));
        return;
      }
      resolve(`${stdout}${stderr}`.trim());
    });
  });
}
