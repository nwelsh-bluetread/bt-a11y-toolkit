import type { Assessment, Finding, Severity } from "./types.js";

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
      lines.push(`- **WCAG:** ${f.wcag.map((c) => `${c.id} ${c.name} (${c.level})`).join(", ")}`);
      if (f.nodeId || f.nodeType) {
        lines.push(`- **Element:** ${f.nodeType ?? "unknown"}${f.nodeId ? ` (\`${f.nodeId}\`)` : ""}`);
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
