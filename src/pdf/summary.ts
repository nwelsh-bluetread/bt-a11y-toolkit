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
import { MANUAL_CHECKLIST, type AuditTarget } from "../checklist.js";
import type { ScreenInfo } from "../code-scan/screens.js";
import { SEVERITY_MEANING, SEVERITY_NOTE, severitySourcesFor } from "../severity.js";
import type { Assessment, Finding, Severity } from "../types.js";
import type { ParsedChecklist } from "../wizard/checklist-md.js";
import { buildCoverage, conformance, conformanceText, criterionResult, levelResults, SCORE_NOT_A_PASS_MARK, type CriterionResult } from "../wizard/coverage.js";
import { buildQuickWins, effortText, impactText, quickWinTitle, topQuickWins } from "../wizard/quick-wins.js";
import { blockedScreens, type AuditSession } from "../wizard/session.js";
import { issueText, sharedComponents } from "../wizard/shared-components.js";
import { comparePlatforms, PLATFORM_LABEL } from "../wizard/platforms.js";

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
  levelPassing?: Partial<Record<string, number>>;
  levelNote?: string;
  /** What each severity means and where automated severities come from. */
  severityGuide?: { note: string; levels: Record<string, string>; sources: Array<{ source: string; how: string }> };
  keyTakeaway: string;
  principleSummaries: Record<string, string>;
  scorecard: Array<{ category: string; score: number; priority: string; findings: number }>;
  findings: SummaryFinding[];
  /** Each in-scope criterion's result across platforms, shown in the WCAG reference table. */
  criteriaResults?: Record<string, { result: CriterionResult; reason?: string; note?: string }>;
  /** Criteria at each level by result. */
  levelResults?: Array<{ level: string; total: number; counts: Record<CriterionResult, number> }>;
  /** All-or-nothing conformance at the target level: every applicable criterion must pass. */
  conformance?: { level: string; pass: number; applicable: number; conformant: boolean; text: string; scoreNote: string };
  /** The fixes worth the most for the least code, for the "Fix these first" section. */
  quickWins?: Array<{ title: string; issues: string; effort: string; impact: string; screens: number; quick: boolean }>;
  /** iOS vs Android side by side, when the audit covers both. */
  platformComparison?: {
    names: string[];
    rows: Array<{ label: string; values: Array<string | number> }>;
    summary: string;
    only: Array<{ platform: string; issues: Array<{ title: string; severity: Severity; screens: number }>; more: number }>;
    differ: Array<{ id: string; name: string; statuses: string[] }>;
    note?: string;
  };
  /** Components used on several screens that have issues, most widely used first. */
  sharedComponents?: Array<{ name: string; file: string; screens: number; worst: Severity; issues: string[] }>;
  /** How many more shared components report.md lists beyond the ones shown. */
  sharedComponentsMore?: number;
  /** Screens testers couldn't test, listed in the PDF's detailed results. */
  blockedScreens?: Array<{ screen: string; platforms: string[]; reason: string; open: number }>;
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
  const findings = mergeManualIntoScan(assessment.findings.map((f) => toSummaryFinding(f, screens, project.targets)));
  const counts = assessment.counts;

  const mobile = screens.filter((s) => s.kind === "mobile").length;
  const pages = screens.filter((s) => s.kind === "web").length;
  const platforms = project.targets.map((t) => TARGET_LABEL[t]).join(" + ");
  const scope = [mobile && `${mobile} screen${mobile === 1 ? "" : "s"}`, pages && `${pages} page${pages === 1 ? "" : "s"}`]
    .filter(Boolean)
    .join(" + ");

  const answered = checklist.rows.filter((r) => r.status !== "open").length;
  const blocked = blockedScreens(checklist);
  const coverage = buildCoverage(session, checklist);
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
    ...(Object.keys(assessment.wcag).length
      ? {
          levelPassing: assessment.wcag,
          levelNote: `Of the WCAG criteria verified so far at each level (code scan and manual checklist), the share with no failures. Criteria not yet verified aren't counted${project.targetLevel === "AAA" ? "" : `; levels above ${project.targetLevel} weren't assessed`}.`,
        }
      : {}),
    severityGuide: { note: SEVERITY_NOTE, levels: SEVERITY_MEANING, sources: severitySourcesFor(assessment.findings) },
    keyTakeaway: keyTakeaway(findings, counts, platforms),
    principleSummaries: principleSummaries(findings),
    scorecard: assessment.categories.map((c) => ({
      category: c.category,
      score: c.score,
      priority: c.severity[0]!.toUpperCase() + c.severity.slice(1),
      findings: c.findingCount,
    })),
    findings,
    quickWins: topQuickWins(buildQuickWins(session, checklist), 5).map((w) => ({
      title: quickWinTitle(w),
      issues: w.kind === "issue" ? `${w.members.length} component${w.members.length === 1 ? "" : "s"}` : w.issues.join("; "),
      effort: effortText(w),
      impact: impactText(w),
      screens: w.screens,
      quick: w.quickWin,
    })),
    ...sharedSummary(session),
    ...platformSummary(session, assessment, checklist, coverage, blocked),
    criteriaResults: Object.fromEntries(coverage.rows.map((r) => [r.id, criterionResult(r)])),
    levelResults: levelResults(coverage),
    conformance: (() => {
      const c = conformance(coverage);
      return { level: c.level, pass: c.pass, applicable: c.applicable, conformant: c.conformant, text: conformanceText(c), scoreNote: SCORE_NOT_A_PASS_MARK };
    })(),
    ...(blocked.length
      ? { blockedScreens: blocked.map((b) => ({ screen: b.screen, platforms: b.platforms.map((t) => TARGET_LABEL[t]), reason: b.reasons.join("; "), open: b.open })) }
      : {}),
    footer:
      `Automated checks (${tools.length ? tools.join(", ") : "none run"}) cover only part of WCAG. ` +
      `Findings marked "manual" come from hands-on screen reader and device testing (${answered} of ${checklist.rows.length} checklist checks completed). ` +
      "Full conformance requires manual review of every flow.",
  };
  return { ...data, ...overrides };
}

const STATUS_TEXT: Record<string, string> = { fail: "Fail", pass: "Pass", na: "N/A", "scan-clear": "Not verified", "not-tested": "Not tested yet", "not-applicable": "Web only" };

function platformSummary(
  session: AuditSession,
  assessment: Assessment,
  checklist: ParsedChecklist,
  coverage: ReturnType<typeof buildCoverage>,
  blocked: ReturnType<typeof blockedScreens>,
): Pick<SummaryData, "platformComparison"> {
  const c = comparePlatforms(assessment.findings, checklist, coverage, blocked, session.project.targets.filter((t) => t !== "web"), session.automated);
  if (!c) return {};
  const s = c.summaries;
  return {
    platformComparison: {
      names: c.targets.map((t) => PLATFORM_LABEL[t]),
      rows: [
        { label: "Issues found", values: s.map((x) => x.findings.total) },
        { label: "Critical / high", values: s.map((x) => `${x.findings.critical} / ${x.findings.high}`) },
        { label: "Checklist checks done", values: s.map((x) => `${x.checks.answered} of ${x.checks.total}`) },
        { label: "WCAG criteria failing", values: s.map((x) => x.criteria.fail) },
        { label: "WCAG criteria passing", values: s.map((x) => x.criteria.pass) },
        { label: "Not tested yet", values: s.map((x) => x.criteria["not-tested"] + x.criteria["scan-clear"]) },
        ...(s.some((x) => x.blocked) ? [{ label: "Blocked screens", values: s.map((x) => x.blocked) }] : []),
      ],
      summary: `${c.shared} problem${c.shared === 1 ? " was" : "s were"} found on both platforms; ${c.targets
        .map((t) => `${c.only[t]?.reduce((n, i) => n + i.screens.length, 0) ?? 0} only on ${PLATFORM_LABEL[t]}`)
        .join(", ")}. Problems found in the code count for both, since the app shares its code.`,
      only: c.targets.map((t) => ({
        platform: PLATFORM_LABEL[t],
        issues: (c.only[t] ?? []).slice(0, 5).map((i) => ({ title: i.title, severity: i.severity, screens: i.screens.length })),
        more: Math.max(0, (c.only[t]?.length ?? 0) - 5),
      })),
      differ: c.criteria.map((r) => ({ id: r.id, name: r.name, statuses: c.targets.map((t) => STATUS_TEXT[r.byTarget[t] ?? ""] ?? "—") })),
      ...(c.measuredOnly.length
        ? { note: c.measuredOnly.map((m) => `${m.tool} ran on ${m.targets.map((t) => PLATFORM_LABEL[t]).join(" and ")} only, so its findings aren't a difference between platforms.`).join(" ") }
        : {}),
    },
  };
}

const SHARED_SHOWN = 12;

function sharedSummary(session: AuditSession): Pick<SummaryData, "sharedComponents" | "sharedComponentsMore"> {
  const list = sharedComponents(session.screens, session.automated.flatMap((r) => r.findings));
  if (!list.length) return {};
  return {
    sharedComponents: list.slice(0, SHARED_SHOWN).map((c) => ({ name: c.name, file: c.file, screens: c.screens.length, worst: c.worst, issues: c.issues.map(issueText) })),
    ...(list.length > SHARED_SHOWN ? { sharedComponentsMore: list.length - SHARED_SHOWN } : {}),
  };
}

const TOOL_LABEL: Record<string, string> = {
  "rn-code-scan": "React Native code scan",
  axe: "axe-core",
  lighthouse: "Lighthouse",
  "device-target-size": "touch target measurement on Android",
};

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
    reportedBy: f.source === "rn-code-scan" ? "code scan" : f.source === "device" ? "measured on device" : (f.source ?? "manual"),
    wcag: f.wcag.map((c) => c.id),
    pages: where,
    ...(file ? { location: `${file}${lines.length ? `:${lines.slice(0, 10).join(", ")}${lines.length > 10 ? ", …" : ""}` : ""}` } : {}),
    ...(page && f.nodeId && f.nodeId !== page ? { element: f.nodeId } : {}),
    description: f.description || title,
    ...(f.remediation ? { remediation: f.remediation } : {}),
  };
}

const CHECKS = new Map(MANUAL_CHECKLIST.map((i) => [i.id, i]));

/**
 * A check a tester failed without describing the problem ("Inputs are missing a label")
 * is the same problem as the scan rule for that check ("Text input has no accessible
 * label"), so it joins that rule's group instead of being listed twice. A scan rule
 * belongs to a check when its main criterion is one of the check's. Findings testers
 * described stay separate, so their wording isn't lost.
 */
export function mergeManualIntoScan(findings: SummaryFinding[]): SummaryFinding[] {
  const rules = new Map<string, { primary: string; n: number; rank: number }>();
  for (const f of findings) {
    if (f.rule.startsWith("manual:") || !f.wcag[0]) continue;
    const r = rules.get(f.group) ?? { primary: f.wcag[0], n: 0, rank: SEVERITY_RANK[f.severity] };
    r.n++;
    r.rank = Math.min(r.rank, SEVERITY_RANK[f.severity]);
    rules.set(f.group, r);
  }
  // The most severe matching rule, then the most widespread, so merging never raises a minor rule's severity.
  const better = (a: { n: number; rank: number }, b?: { n: number; rank: number }) => !b || a.rank < b.rank || (a.rank === b.rank && a.n > b.n);
  const merged = findings.map((f) => {
    const check = CHECKS.get(f.rule.replace(/^manual:/, ""));
    if (!f.rule.startsWith("manual:") || !check || f.title !== check.failTitle) return f;
    let best: string | undefined;
    for (const [group, r] of rules) if (check.wcag.includes(r.primary) && better(r, best ? rules.get(best) : undefined)) best = group;
    return best ? { ...f, group: best } : f;
  });
  // The scan finding leads its group, so the group keeps the scan's title, description, and fix.
  return [...merged.filter((f) => !f.rule.startsWith("manual:")), ...merged.filter((f) => f.rule.startsWith("manual:"))];
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
