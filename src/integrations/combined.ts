/**
 * Multi-source assessment merging.
 *
 * Combines {@link Assessment}s produced by different engines (e.g. Lighthouse
 * and axe-core) into a single consolidated report. Findings that describe the
 * same problem on the same element from different tools are de-duplicated, while
 * keeping a record of which sources reported each issue.
 */
import type {
  Assessment,
  CategoryScore,
  Finding,
  Severity,
  WcagLevel,
} from "../types.js";
import {
  computeOverallScore,
  computeTopIssues,
  countBySeverity,
} from "../audit.js";

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

function worstSeverity(findings: Finding[]): Severity {
  for (const sev of SEVERITY_ORDER) {
    if (findings.some((f) => f.severity === sev)) return sev;
  }
  return "low";
}

/**
 * A key that identifies "the same problem on the same element" across tools.
 * Two findings from Lighthouse and axe about a missing image alt on `img.hero`
 * share the same WCAG criteria + selector, so they collapse into one.
 */
function dedupeKey(f: Finding): string {
  const wcag = f.wcag.map((c) => c.id).sort().join(",");
  const selector = f.nodeId ?? (f.evidence?.selectors as string[] | undefined)?.[0] ?? "";
  const page = (f.evidence?.page as string | undefined) ?? "";
  return `${page}|${f.category ?? ""}|${wcag}|${selector}`;
}

/** Pick the higher-severity finding as the primary of a duplicate pair. */
function moreSevere(a: Finding, b: Finding): Finding {
  return SEVERITY_ORDER.indexOf(a.severity) <= SEVERITY_ORDER.indexOf(b.severity) ? a : b;
}

/** Extract the tool name a finding came from (`lighthouse`, `axe`, ...). */
function sourceOf(f: Finding): string {
  return f.source ?? "toolkit";
}

/**
 * Merge multiple assessments into one. Findings are de-duplicated across
 * sources; each surviving finding records every tool that reported it in
 * `evidence.sources`. Category and WCAG rollups are recomputed from the merged
 * finding set, and the overall score is the average of the input scores.
 */
export function mergeAssessments(
  assessments: Assessment[],
  options: { targetLevel?: WcagLevel } = {},
): Assessment {
  if (assessments.length === 0) {
    throw new Error("mergeAssessments requires at least one assessment.");
  }
  const targetLevel = options.targetLevel ?? assessments[0]!.targetLevel;

  // De-duplicate findings, tracking which sources reported each.
  const merged = new Map<string, { finding: Finding; sources: Set<string> }>();
  for (const assessment of assessments) {
    for (const finding of assessment.findings) {
      const key = dedupeKey(finding);
      const existing = merged.get(key);
      if (existing) {
        existing.sources.add(sourceOf(finding));
        existing.finding = {
          ...moreSevere(existing.finding, finding),
          evidence: { ...existing.finding.evidence, ...finding.evidence },
        };
      } else {
        merged.set(key, { finding, sources: new Set([sourceOf(finding)]) });
      }
    }
  }

  const findings: Finding[] = [...merged.values()].map(({ finding, sources }) => ({
    ...finding,
    source: [...sources].sort().join("+"),
    evidence: { ...finding.evidence, sources: [...sources].sort() },
  }));

  // WCAG rollup: average each level across the input assessments.
  const wcag = { A: 0, AA: 0, AAA: 0 } as Record<WcagLevel, number>;
  for (const level of ["A", "AA", "AAA"] as WcagLevel[]) {
    const sum = assessments.reduce((acc, a) => acc + a.wcag[level], 0);
    wcag[level] = Math.round(sum / assessments.length);
  }

  // Category rollup recomputed from the merged findings.
  const byCategory = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = f.category ?? "Semantics";
    const list = byCategory.get(key) ?? [];
    list.push(f);
    byCategory.set(key, list);
  }
  const categories: CategoryScore[] = [...byCategory.entries()]
    .map(([category, list]) => ({
      category,
      score: Math.max(0, 100 - list.length * 15),
      severity: worstSeverity(list),
      findingCount: list.length,
    }))
    .sort((a, b) => a.score - b.score);

  // Overall score: average the source scores (each already 0-100).
  const overallScore =
    assessments.length > 0
      ? Math.round(
          assessments.reduce((acc, a) => acc + a.overallScore, 0) / assessments.length,
        )
      : computeOverallScore(findings, 100);

  return {
    generatedAt: new Date().toISOString(),
    platform: assessments[0]!.platform,
    targetLevel,
    overallScore,
    counts: countBySeverity(findings),
    wcag,
    categories,
    topIssues: computeTopIssues(findings),
    findings,
  };
}
