import type { Assessment, Finding, Severity } from "./types.js";
import { estimateFindingHours, estimateTotalHours, formatHours } from "./effort.js";

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
  const { overallScore, counts, wcag, topIssues } = assessment;
  const lines: string[] = [];
  lines.push("Accessibility Assessment");
  lines.push("────────────────────────────");
  lines.push(`Overall Score: ${overallScore}%`);
  lines.push(`Critical: ${counts.critical}`);
  lines.push(`High: ${counts.high}`);
  lines.push(`Medium: ${counts.medium}`);
  lines.push(`Low: ${counts.low}`);
  lines.push(`WCAG A:     ${wcag.A}%`);
  lines.push(`WCAG AA:    ${wcag.AA}%`);
  lines.push(`WCAG AAA:   ${wcag.AAA}%`);
  lines.push(`Est. remediation: ${formatHours(estimateTotalHours(assessment.findings))}`);
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
  lines.push(`- **Estimated remediation effort:** ${formatHours(estimateTotalHours(findings))}`);
  lines.push("");

  const pages = collectPages(assessment);
  if (pages.length > 0) {
    lines.push(`## Pages Scanned`);
    lines.push("");
    lines.push(`${pages.length} ${pages.length === 1 ? "page" : "pages"} audited:`);
    lines.push("");
    for (const page of pages) lines.push(`- ${page}`);
    lines.push("");
  }

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

  lines.push(`## Accessibility Scorecard`);
  lines.push("");
  lines.push(`| Category | Score | Priority | Findings | Est. effort |`);
  lines.push(`| --- | --- | --- | --- | --- |`);
  for (const c of categories) {
    const catHours = estimateTotalHours(findings.filter((f) => (f.category ?? "Semantics") === c.category));
    lines.push(
      `| ${c.category} | ${c.score}% | ${SEVERITY_ICON[c.severity]} ${SEVERITY_LABEL[c.severity]} | ${c.findingCount} | ${formatHours(catHours)} |`,
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
      lines.push(`- **Est. remediation:** ${formatHours(f.estimatedHours ?? estimateFindingHours(f))}`);
      appendLocation(lines, f);
      lines.push(`- **Description:** ${f.description}`);
      if (f.remediation) lines.push(`- **Remediation:** ${f.remediation}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Truncate a single-line HTML snippet so the report stays readable. */
function truncate(value: string, max = 160): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/**
 * Collect the distinct pages an assessment covered. Prefers the assessment's own
 * `pages` list and falls back to any `evidence.page` tags on the findings (set
 * by the multi-page scan combiners), so older assessments still surface pages.
 */
function collectPages(assessment: Assessment): string[] {
  const pages = new Set<string>(assessment.pages ?? []);
  for (const f of assessment.findings) {
    const page = f.evidence?.page;
    if (typeof page === "string" && page) pages.add(page);
  }
  return [...pages];
}

/**
 * Append location detail for a finding. Prefers the rich evidence captured by
 * the scanner integrations (DOM selector path, HTML snippet, failure summary,
 * and how many elements are affected) and falls back to the node type/id for
 * tree-based findings.
 */
function appendLocation(lines: string[], f: Finding): void {
  const ev = f.evidence ?? {};
  const page = typeof ev.page === "string" ? ev.page : undefined;
  if (page) lines.push(`- **Page:** ${page}`);
  const elements = Array.isArray(ev.elements)
    ? (ev.elements as Array<{ selector?: string; html?: string; failureSummary?: string }>)
    : [];
  const selectors = Array.isArray(ev.selectors) ? (ev.selectors as string[]) : [];
  const affected = typeof ev.affectedElements === "number" ? ev.affectedElements : undefined;
  const primary = elements[0];
  const selector = primary?.selector ?? selectors[0] ?? f.nodeId;

  // Tree-based finding (no scanner evidence): keep the simple element line.
  if (!selector && !f.nodeType) return;
  if (!selector) {
    lines.push(`- **Element:** ${f.nodeType ?? "unknown"}`);
    return;
  }

  const suffix = affected && affected > 1 ? ` _(and ${affected - 1} more element${affected - 1 === 1 ? "" : "s"})_` : "";
  lines.push(`- **Location:** \`${selector}\`${suffix}`);

  const html = primary?.html ?? (typeof ev.html === "string" ? ev.html : undefined);
  if (html) lines.push(`- **HTML:** \`${truncate(html)}\``);

  const summary = primary?.failureSummary ?? (typeof ev.failureSummary === "string" ? ev.failureSummary : undefined);
  if (summary) lines.push(`- **Why it fails:** ${truncate(summary, 300)}`);

  // List the remaining affected selectors so every location is traceable.
  const others = (elements.length ? elements.map((e) => e.selector) : selectors)
    .filter((s): s is string => Boolean(s))
    .slice(1, 20);
  if (others.length > 0) {
    lines.push(`- **Other elements:**`);
    for (const s of others) lines.push(`  - \`${s}\``);
  }
}

/** Sort findings by severity (critical first), then by rule id. */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.ruleId.localeCompare(b.ruleId),
  );
}
