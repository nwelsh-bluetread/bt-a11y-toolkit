import type {
  A11yNode,
  Assessment,
  CategoryScore,
  Finding,
  Platform,
  RuleContext,
  RuleResult,
  Severity,
  WcagLevel,
} from "./types.js";
import { flatten } from "./utils.js";
import { defaultRules, type CategorizedRule } from "./rules.js";

export interface AuditOptions {
  platform?: Platform;
  targetLevel?: WcagLevel;
  minTouchTargetSize?: number;
  /** Override the rule set. Defaults to {@link defaultRules}. */
  rules?: CategorizedRule[];
}

/** Weight applied to each severity when computing the deduction from 100. */
const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 10,
  high: 5,
  medium: 2,
  low: 0.5,
};

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

/**
 * Run the toolkit's rules against a node tree and produce a full assessment,
 * including score, WCAG rollups, and a per-category scorecard.
 */
export function runAudit(tree: A11yNode | A11yNode[], options: AuditOptions = {}): Assessment {
  const platform = options.platform ?? "web";
  const targetLevel = options.targetLevel ?? "AA";
  const ctx: RuleContext = {
    platform,
    targetLevel,
    minTouchTargetSize: options.minTouchTargetSize ?? 44,
  };
  const rules = options.rules ?? defaultRules;
  const nodes = flatten(tree);

  const results: Array<{ rule: CategorizedRule; result: RuleResult }> = rules.map((rule) => ({
    rule,
    result: rule.evaluate(nodes, ctx),
  }));

  const findings: Finding[] = results.flatMap((r) => r.result.findings);

  return {
    generatedAt: new Date().toISOString(),
    platform,
    targetLevel,
    overallScore: computeOverallScore(findings, nodes.length),
    counts: countBySeverity(findings),
    wcag: computeWcagRollup(results),
    categories: computeCategoryScores(results),
    topIssues: computeTopIssues(findings),
    findings,
  };
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

/**
 * Overall score out of 100. Starts at 100 and deducts weighted points per
 * finding, scaled by how many nodes were evaluated so small trees are not
 * punished disproportionately. Clamped to 0-100.
 */
export function computeOverallScore(findings: Finding[], nodeCount: number): number {
  if (findings.length === 0) return 100;
  const rawDeduction = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
  // Normalize against tree size so a 3-node demo and a 3000-node app are comparable.
  const scale = Math.max(1, Math.min(nodeCount, 200)) / 20;
  const deduction = rawDeduction / scale;
  return Math.max(0, Math.round(100 - deduction));
}

/** Percentage of level-relevant checks passing, per WCAG level. */
export function computeWcagRollup(
  results: Array<{ rule: CategorizedRule; result: RuleResult }>,
): Record<WcagLevel, number> {
  const levels: WcagLevel[] = ["A", "AA", "AAA"];
  const rollup = { A: 100, AA: 100, AAA: 100 } as Record<WcagLevel, number>;

  for (const level of levels) {
    let evaluated = 0;
    let passed = 0;
    for (const { rule, result } of results) {
      // A rule contributes to a level if it maps to a criterion at or below it.
      const relevant = rule.wcag.some((c) => levelIncludes(level, c.level));
      if (!relevant) continue;
      evaluated += result.evaluated;
      passed += result.passed;
    }
    rollup[level] = evaluated === 0 ? 100 : Math.round((passed / evaluated) * 100);
  }
  return rollup;
}

/** Whether target level includes findings mapped to criterionLevel. */
function levelIncludes(target: WcagLevel, criterionLevel: WcagLevel): boolean {
  const rank: Record<WcagLevel, number> = { A: 1, AA: 2, AAA: 3 };
  return rank[criterionLevel] <= rank[target];
}

/** Build the per-category scorecard. */
export function computeCategoryScores(
  results: Array<{ rule: CategorizedRule; result: RuleResult }>,
): CategoryScore[] {
  const byCategory = new Map<
    string,
    { evaluated: number; passed: number; findings: Finding[] }
  >();

  for (const { rule, result } of results) {
    const entry = byCategory.get(rule.category) ?? { evaluated: 0, passed: 0, findings: [] };
    entry.evaluated += result.evaluated;
    entry.passed += result.passed;
    entry.findings.push(...result.findings);
    byCategory.set(rule.category, entry);
  }

  const scores: CategoryScore[] = [];
  for (const [category, entry] of byCategory) {
    const score = entry.evaluated === 0 ? 100 : Math.round((entry.passed / entry.evaluated) * 100);
    scores.push({
      category,
      score,
      severity: worstSeverity(entry.findings),
      findingCount: entry.findings.length,
    });
  }
  return scores.sort((a, b) => a.score - b.score);
}

function worstSeverity(findings: Finding[]): Severity {
  for (const sev of SEVERITY_ORDER) {
    if (findings.some((f) => f.severity === sev)) return sev;
  }
  return "low";
}

/** Rank the most common/impactful issues by rule frequency and severity. */
export function computeTopIssues(findings: Finding[], limit = 5): string[] {
  const byRule = new Map<string, { title: string; count: number; weight: number }>();
  for (const f of findings) {
    const entry = byRule.get(f.ruleId) ?? { title: f.title, count: 0, weight: 0 };
    entry.count++;
    entry.weight += SEVERITY_WEIGHT[f.severity];
    byRule.set(f.ruleId, entry);
  }
  return [...byRule.values()]
    .sort((a, b) => b.weight - a.weight || b.count - a.count)
    .slice(0, limit)
    .map((e) => `${e.title} (${e.count})`);
}
