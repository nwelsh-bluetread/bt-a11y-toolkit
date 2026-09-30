import type { Assessment, Finding, Severity } from "./types.js";
import { SEVERITY_WEIGHT } from "./audit.js";

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const SEVERITY_ICON: Record<Severity, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🟢",
};

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

/**
 * The file, page, or URL a finding came from, however the engine recorded it.
 * Multi-page scans stamp `evidence.page`; single-tree audits may carry a
 * `nodeId` path instead. Returns `undefined` when nothing locates the finding.
 */
function locationOf(f: Finding): string | undefined {
  const page = f.evidence?.page;
  if (typeof page === "string" && page.length > 0) return page;
  return undefined;
}

/** A single element selector for a finding, if one was recorded. */
function selectorOf(f: Finding): string | undefined {
  const ev = f.evidence ?? {};
  const selectors = Array.isArray(ev.selectors) ? (ev.selectors as string[]) : [];
  return selectors[0] ?? f.nodeId ?? undefined;
}

/** Round to at most 2 decimals. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A WCAG criterion that has at least one failing finding. */
interface CriterionFailure {
  id: string;
  name: string;
  level: string;
  count: number;
  severity: Severity;
  /** Distinct files/pages the criterion fails in, if recorded. */
  locations: string[];
}

/**
 * Aggregate findings by the WCAG success criteria they violate, so a reader can
 * see exactly which criteria fail, how many times, and in which files/pages.
 * Sorted by severity (worst first) then by criterion id.
 */
function criterionFailures(findings: Finding[]): CriterionFailure[] {
  const byCriterion = new Map<
    string,
    { name: string; level: string; count: number; findings: Finding[]; locations: Set<string> }
  >();

  for (const f of findings) {
    const loc = locationOf(f);
    for (const c of f.wcag) {
      const entry =
        byCriterion.get(c.id) ??
        { name: c.name, level: c.level, count: 0, findings: [], locations: new Set<string>() };
      entry.count++;
      entry.findings.push(f);
      if (loc) entry.locations.add(loc);
      byCriterion.set(c.id, entry);
    }
  }

  const rank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...byCriterion.entries()]
    .map(([id, e]) => ({
      id,
      name: e.name,
      level: e.level,
      count: e.count,
      severity: worstSeverity(e.findings),
      locations: [...e.locations].sort(),
    }))
    .sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id));
}

/** The worst severity among a set of findings. */
function worstSeverity(findings: Finding[]): Severity {
  for (const sev of SEVERITY_ORDER) {
    if (findings.some((f) => f.severity === sev)) return sev;
  }
  return "low";
}

/**
 * Render the compact console-style report shown in the toolkit spec:
 *
 * ```
 * Accessibility Assessment
 * ────────────────────────────
 * Overall Score: 62%
 * ...
 * ```
 */
export function formatConsole(assessment: Assessment): string {
  const { overallScore, counts, wcag, topIssues, findings } = assessment;
  const lines: string[] = [];
  lines.push("Accessibility Assessment");
  lines.push("────────────────────────────");
  lines.push(`Overall Score: ${overallScore}%`);
  lines.push(`Critical: ${counts.critical}`);
  lines.push(`High: ${counts.high}`);
  lines.push(`Medium: ${counts.medium}`);
  lines.push(`Low: ${counts.low}`);

  // Show where the score comes from: each severity deducts weighted points.
  lines.push("Score Breakdown");
  lines.push("────────────");
  let rawDeduction = 0;
  for (const sev of SEVERITY_ORDER) {
    const count = counts[sev];
    if (count === 0) continue;
    const weight = SEVERITY_WEIGHT[sev];
    const subtotal = count * weight;
    rawDeduction += subtotal;
    lines.push(`${SEVERITY_LABEL[sev]}: ${count} × ${weight} = -${subtotal} pts`);
  }
  if (rawDeduction === 0) {
    lines.push("No deductions 🎉");
  } else {
    lines.push(`Raw deduction: -${round(rawDeduction)} pts (scaled to tree size, clamped 0-100)`);
  }

  lines.push(`WCAG A:     ${wcag.A}%`);
  lines.push(`WCAG AA:    ${wcag.AA}%`);
  lines.push(`WCAG AAA:   ${wcag.AAA}%`);

  // List which WCAG criteria are failing and how often.
  const criteria = criterionFailures(findings);
  if (criteria.length > 0) {
    lines.push("Failing WCAG Criteria");
    lines.push("────────────");
    for (const c of criteria) {
      const where = c.locations.length > 0 ? ` — ${c.locations.join(", ")}` : "";
      lines.push(`${c.id} ${c.name} (${c.level}): ${c.count} finding(s)${where}`);
    }
  }

  lines.push("Top Issues");
  lines.push("────────────");
  if (topIssues.length === 0) {
    lines.push("None 🎉");
  } else {
    topIssues.forEach((issue, i) => lines.push(`${i + 1}. ${issue}`));
  }
  return lines.join("\n");
}

/** Machine-readable JSON report (pretty-printed). */
export function formatJson(assessment: Assessment): string {
  return JSON.stringify(assessment, null, 2);
}

/** A full Markdown report suitable for the executive/verification deliverables. */
export function formatMarkdown(assessment: Assessment): string {
  const { overallScore, counts, wcag, categories, findings, platform, targetLevel, generatedAt } =
    assessment;
  const lines: string[] = [];
  lines.push(`# Accessibility Assessment`);
  lines.push("");
  lines.push(`- **Generated:** ${generatedAt}`);
  lines.push(`- **Platform:** ${platform}`);
  lines.push(`- **Target WCAG level:** ${targetLevel}`);
  lines.push(`- **Overall score:** ${overallScore}%`);
  lines.push("");

  lines.push(`## Summary`);
  lines.push("");
  lines.push(`| Severity | Count |`);
  lines.push(`| --- | --- |`);
  (Object.keys(counts) as Severity[]).forEach((s) =>
    lines.push(`| ${SEVERITY_ICON[s]} ${SEVERITY_LABEL[s]} | ${counts[s]} |`),
  );
  lines.push("");
  lines.push(`| WCAG Level | Passing |`);
  lines.push(`| --- | --- |`);
  lines.push(`| A | ${wcag.A}% |`);
  lines.push(`| AA | ${wcag.AA}% |`);
  lines.push(`| AAA | ${wcag.AAA}% |`);
  lines.push("");

  // Show exactly how the overall score is derived: each severity deducts
  // weighted points (critical 10, high 5, medium 2, low 0.5), the sum is scaled
  // to tree size, then subtracted from 100 and clamped to 0-100.
  lines.push(`## Score Breakdown`);
  lines.push("");
  lines.push(`Overall score starts at **100** and deducts weighted points per finding:`);
  lines.push("");
  lines.push(`| Severity | Findings | Weight | Deduction |`);
  lines.push(`| --- | --- | --- | --- |`);
  let rawDeduction = 0;
  for (const s of SEVERITY_ORDER) {
    const weight = SEVERITY_WEIGHT[s];
    const subtotal = counts[s] * weight;
    rawDeduction += subtotal;
    lines.push(
      `| ${SEVERITY_ICON[s]} ${SEVERITY_LABEL[s]} | ${counts[s]} | ${weight} | -${round(subtotal)} |`,
    );
  }
  lines.push(`| **Raw total** | ${findings.length} | | **-${round(rawDeduction)}** |`);
  lines.push("");
  lines.push(
    `The raw deduction is normalized against the number of nodes/elements evaluated ` +
      `(so small pages aren't over-penalized), then subtracted from 100 and clamped to 0-100, ` +
      `giving the **${overallScore}%** overall score.`,
  );
  lines.push("");

  // Enumerate each failing WCAG criterion, how many findings hit it, its worst
  // severity, and which files/pages it fails in.
  const criteria = criterionFailures(findings);
  if (criteria.length > 0) {
    lines.push(`## Failing WCAG Criteria`);
    lines.push("");
    lines.push(`| Criterion | Level | Severity | Findings | Fails in |`);
    lines.push(`| --- | --- | --- | --- | --- |`);
    for (const c of criteria) {
      const where = c.locations.length > 0 ? c.locations.join("<br>") : "—";
      lines.push(
        `| ${c.id} ${c.name} | ${c.level} | ${SEVERITY_ICON[c.severity]} ${SEVERITY_LABEL[c.severity]} | ${c.count} | ${where} |`,
      );
    }
    lines.push("");
  }

  lines.push(`## Accessibility Scorecard`);
  lines.push("");
  lines.push(`| Category | Score | Priority | Findings |`);
  lines.push(`| --- | --- | --- | --- |`);
  for (const c of categories) {
    lines.push(
      `| ${c.category} | ${c.score}% | ${SEVERITY_ICON[c.severity]} ${SEVERITY_LABEL[c.severity]} | ${c.findingCount} |`,
    );
  }
  lines.push("");

  lines.push(`## Findings`);
  lines.push("");
  if (findings.length === 0) {
    lines.push("No findings. 🎉");
  } else {
    for (const f of sortFindings(findings)) {
      lines.push(`### ${SEVERITY_ICON[f.severity]} ${f.title}`);
      lines.push("");
      lines.push(`- **Rule:** \`${f.ruleId}\``);
      lines.push(`- **Severity:** ${SEVERITY_LABEL[f.severity]}`);
      // Surfaces cross-engine de-duplication: an issue both engines found reads
      // "axe + lighthouse", so a reader can tell corroborated issues from ones
      // only one ruleset catches.
      if (f.source) lines.push(`- **Reported by:** ${f.source.split("+").join(" + ")}`);
      lines.push(`- **WCAG:** ${f.wcag.map((c) => `${c.id} ${c.name} (${c.level})`).join(", ")}`);
      const location = locationOf(f);
      if (location) lines.push(`- **File/Page:** ${location}`);
      const selector = selectorOf(f);
      if (f.nodeId || f.nodeType || selector) {
        const el = f.nodeType ?? "element";
        const sel = selector ? ` (\`${selector}\`)` : "";
        lines.push(`- **Element:** ${el}${sel}`);
      }
      lines.push(`- **Description:** ${f.description}`);
      if (f.remediation) lines.push(`- **Remediation:** ${f.remediation}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Sort findings by severity (critical first), then by rule id. */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.ruleId.localeCompare(b.ruleId),
  );
}
