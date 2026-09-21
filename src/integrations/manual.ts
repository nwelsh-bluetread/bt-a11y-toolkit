/**
 * Manual testing integration.
 *
 * Turns manually-entered accessibility findings (screen reader, keyboard,
 * gesture, cognitive, and reflow issues a scanner can't catch) into a toolkit
 * {@link Assessment}. That assessment can then be merged with the automated
 * scanner assessments via {@link mergeAssessments} so a single deliverable
 * covers both automated and human testing.
 *
 * Analysts fill out `examples/manual-findings.template.json` (an array of
 * {@link ManualFinding}s) and pass the parsed array here.
 */
import type {
  Assessment,
  Finding,
  Platform,
  Severity,
  WcagCriterion,
  WcagLevel,
} from "../types.js";
import { WCAG } from "../wcag.js";
import { computeOverallScore, computeTopIssues, countBySeverity } from "../audit.js";
import { estimateFindingHours } from "../effort.js";

/**
 * The shape an analyst fills in per manual finding. Deliberately looser than
 * {@link Finding}: WCAG criteria are given as ids (e.g. "1.3.2") and expanded
 * here, and effort is optional (estimated if omitted).
 */
export interface ManualFinding {
  /** Short human-readable summary of the problem. */
  title: string;
  /** What was observed and why it fails. */
  description: string;
  severity: Severity;
  /** WCAG success criterion ids this maps to, e.g. ["1.3.2", "2.4.3"]. */
  wcag: string[];
  /** Scorecard category, e.g. "Screen Reader", "Keyboard", "Forms". */
  category?: string;
  /** The page/screen/flow where it was found. */
  page?: string;
  /** How the issue was found, e.g. "VoiceOver", "TalkBack", "Keyboard". */
  method?: string;
  /** Steps to reproduce / where exactly it occurs. */
  location?: string;
  /** Suggested fix. */
  remediation?: string;
  /** Optional explicit remediation estimate in hours. */
  estimatedHours?: number;
  /** Platforms this applies to. */
  platforms?: Platform[];
}

/** Expand WCAG ids into full criteria, dropping unknown ids. */
function toCriteria(ids: string[]): WcagCriterion[] {
  return (ids ?? []).map((id) => WCAG[id]).filter((c): c is WcagCriterion => Boolean(c));
}

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];
function worstSeverity(findings: Finding[]): Severity {
  for (const sev of SEVERITY_ORDER) {
    if (findings.some((f) => f.severity === sev)) return sev;
  }
  return "low";
}

/** Convert the analyst-friendly manual entries into toolkit {@link Finding}s. */
export function manualToFindings(
  entries: ManualFinding[],
  options: { platform?: Platform } = {},
): Finding[] {
  const platform = options.platform ?? "web";
  return entries.map((m, i) => {
    const evidence: Record<string, unknown> = {};
    if (m.page) evidence.page = m.page;
    if (m.method) evidence.method = m.method;
    if (m.location) evidence.location = m.location;

    const finding: Finding = {
      ruleId: `manual:${slug(m.category ?? m.title)}-${i + 1}`,
      title: m.title,
      description: m.description,
      severity: m.severity,
      wcag: toCriteria(m.wcag),
      category: m.category ?? "Screen Reader",
      source: "manual",
      platforms: m.platforms ?? [platform],
      remediation: m.remediation,
      evidence,
    };
    finding.estimatedHours = m.estimatedHours ?? estimateFindingHours(finding);
    return finding;
  });
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "finding";
}

function buildCategories(findings: Finding[]): Assessment["categories"] {
  const map = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = f.category ?? "Screen Reader";
    const list = map.get(key) ?? [];
    list.push(f);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([category, list]) => ({
      category,
      score: Math.max(0, 100 - list.length * 15),
      severity: worstSeverity(list),
      findingCount: list.length,
    }))
    .sort((a, b) => a.score - b.score);
}

/**
 * Coarse WCAG rollup for manual findings. Unlike the scanners, manual testing
 * has no "passed check" denominator, so a level is 100% when nothing failed at
 * or below it and otherwise deducts a flat amount per failing criterion. This is
 * a signal, not a pass-rate; the merged report averages it with the scanners'
 * measured rollups.
 */
function manualWcagRollup(findings: Finding[]): Record<WcagLevel, number> {
  const rank: Record<WcagLevel, number> = { A: 1, AA: 2, AAA: 3 };
  const rollup = { A: 100, AA: 100, AAA: 100 } as Record<WcagLevel, number>;
  for (const level of ["A", "AA", "AAA"] as WcagLevel[]) {
    const failing = findings.filter((f) =>
      f.wcag.some((c) => rank[c.level] <= rank[level]),
    ).length;
    rollup[level] = Math.max(0, 100 - failing * 10);
  }
  return rollup;
}

/**
 * Build a full {@link Assessment} from manually-entered findings so manual
 * testing rolls up into the same scorecard, WCAG summary, effort total, and Jira
 * tickets as the automated results — and can be merged with them.
 */
export function manualFindingsToAssessment(
  entries: ManualFinding[],
  options: { targetLevel?: WcagLevel; platform?: Platform } = {},
): Assessment {
  const targetLevel = options.targetLevel ?? "AA";
  const platform = options.platform ?? "web";
  const findings = manualToFindings(entries, { platform });
  const pages = [...new Set(findings.map((f) => f.evidence?.page).filter((p): p is string => Boolean(p)))];

  return {
    generatedAt: new Date().toISOString(),
    platform,
    targetLevel,
    overallScore: computeOverallScore(findings, 100),
    counts: countBySeverity(findings),
    wcag: manualWcagRollup(findings),
    categories: buildCategories(findings),
    topIssues: computeTopIssues(findings),
    findings,
    pages,
  };
}
