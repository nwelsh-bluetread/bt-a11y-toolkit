/**
 * axe-core integration.
 *
 * Like the Lighthouse integration, this module is intentionally *pure*: it
 * converts an axe-core results object into the toolkit's {@link Finding} /
 * {@link Assessment} model. It does NOT run axe (that lives in
 * `axe-runner.ts`), which keeps it fast to unit test and free of browser deps.
 *
 * axe already does most of the WCAG mapping for us: each rule carries `tags`
 * like `wcag143` (→ 1.4.3) and `wcag2aa`, and an `impact` we map to severity.
 */
import type { Assessment, Finding, Severity, WcagCriterion, WcagLevel } from "../types.js";
import { WCAG } from "../wcag.js";
import { computeOverallScore, computeTopIssues, countBySeverity } from "../audit.js";

/** A single failing element within an axe violation. */
export interface AxeNode {
  target?: string[];
  html?: string;
  failureSummary?: string;
}

/** A single axe rule result (violation / pass / incomplete / inapplicable). */
export interface AxeRuleResult {
  id: string;
  impact?: "critical" | "serious" | "moderate" | "minor" | null;
  tags: string[];
  description?: string;
  help?: string;
  helpUrl?: string;
  nodes: AxeNode[];
}

/** The minimal shape of an axe-core results object. */
export interface AxeResults {
  url?: string;
  violations: AxeRuleResult[];
  passes?: AxeRuleResult[];
  incomplete?: AxeRuleResult[];
  inapplicable?: AxeRuleResult[];
}

/** A single scanned page: its URL and the axe results for it. */
export interface AxePage {
  url: string;
  results: AxeResults;
}

/** Map axe impact → toolkit severity. */
const IMPACT_SEVERITY: Record<string, Severity> = {
  critical: "critical",
  serious: "high",
  moderate: "medium",
  minor: "low",
};

/**
 * Rough scorecard category by axe rule id / keyword, so findings roll up into
 * the same categories the rest of the toolkit uses. Falls back to "Semantics".
 */
function categoryForRule(id: string): string {
  if (id.includes("contrast")) return "Contrast";
  if (id.includes("image") || id.includes("alt") || id.includes("object")) return "Images/Icons";
  if (id.includes("label") || id.includes("form") || id.includes("input")) return "Forms";
  if (id.includes("heading")) return "Typography";
  if (id.includes("link") || id.includes("bypass") || id.includes("region")) return "Navigation";
  if (id.includes("tabindex") || id.includes("focus") || id.includes("keyboard")) return "Keyboard";
  if (id.includes("target-size")) return "Touch Targets";
  if (id.includes("viewport") || id.includes("meta")) return "Responsive";
  if (id.includes("aria-hidden")) return "Screen Reader";
  return "Semantics";
}

/**
 * Convert axe `wcagNNN` tags into WCAG criteria. e.g. `wcag143` → 1.4.3,
 * `wcag1410` → 1.4.10. Only tags that resolve against the toolkit's WCAG map are
 * kept (so we get the official name + level).
 */
export function tagsToCriteria(tags: string[]): WcagCriterion[] {
  const out: WcagCriterion[] = [];
  for (const tag of tags) {
    const m = /^wcag(\d)(\d)(\d+)$/.exec(tag);
    if (!m) continue;
    const id = `${m[1]}.${m[2]}.${Number(m[3])}`;
    const criterion = WCAG[id];
    if (criterion && !out.some((c) => c.id === id)) out.push(criterion);
  }
  return out;
}

/** Derive the target WCAG level implied by an axe rule's level tags. */
function levelFromTags(tags: string[]): WcagLevel | undefined {
  if (tags.some((t) => /aaa$/.test(t))) return "AAA";
  if (tags.some((t) => /aa$/.test(t))) return "AA";
  if (tags.some((t) => /a$/.test(t))) return "A";
  return undefined;
}

/**
 * Convert axe results into toolkit findings. One finding is produced per
 * violation; the offending element selectors are captured as evidence.
 */
export function axeToFindings(results: AxeResults): Finding[] {
  const findings: Finding[] = [];

  for (const v of results.violations) {
    const selectors = v.nodes
      .map((n) => n.target?.join(" "))
      .filter((s): s is string => Boolean(s));

    findings.push({
      ruleId: `axe:${v.id}`,
      title: v.help ?? v.id,
      description: v.description ?? v.help ?? v.id,
      severity: IMPACT_SEVERITY[v.impact ?? "moderate"] ?? "medium",
      wcag: tagsToCriteria(v.tags),
      category: categoryForRule(v.id),
      source: "axe",
      platforms: ["web"],
      nodeId: selectors[0],
      remediation: v.helpUrl,
      evidence: {
        ruleId: v.id,
        impact: v.impact ?? undefined,
        affectedElements: selectors.length,
        selectors: selectors.slice(0, 20),
        page: results.url,
      },
    });
  }

  return findings;
}

const rank: Record<WcagLevel, number> = { A: 1, AA: 2, AAA: 3 };

/**
 * Compute per-level WCAG pass rates from axe's own pass/violation outcomes.
 * A rule counts toward every level at or above its own WCAG level.
 */
function computeWcagRollup(results: AxeResults): Record<WcagLevel, number> {
  const stats: Record<WcagLevel, { passed: number; evaluated: number }> = {
    A: { passed: 0, evaluated: 0 },
    AA: { passed: 0, evaluated: 0 },
    AAA: { passed: 0, evaluated: 0 },
  };

  const account = (rule: AxeRuleResult, passed: boolean) => {
    const ruleLevel = levelFromTags(rule.tags);
    if (!ruleLevel) return;
    for (const level of ["A", "AA", "AAA"] as WcagLevel[]) {
      if (rank[ruleLevel] > rank[level]) continue;
      stats[level].evaluated++;
      if (passed) stats[level].passed++;
    }
  };

  for (const p of results.passes ?? []) account(p, true);
  for (const v of results.violations) account(v, false);

  return {
    A: pct(stats.A),
    AA: pct(stats.AA),
    AAA: pct(stats.AAA),
  } as Record<WcagLevel, number>;
}

function buildCategories(findings: Finding[]) {
  const map = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = f.category ?? "Semantics";
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

/** Convert a single axe result into a full toolkit {@link Assessment}. */
export function axeToAssessment(
  results: AxeResults,
  options: { targetLevel?: WcagLevel } = {},
): Assessment {
  const targetLevel = options.targetLevel ?? "AA";
  const findings = axeToFindings(results);

  return {
    generatedAt: new Date().toISOString(),
    platform: "web",
    targetLevel,
    overallScore: computeOverallScore(findings, 100),
    counts: countBySeverity(findings),
    wcag: computeWcagRollup(results),
    categories: buildCategories(findings),
    topIssues: computeTopIssues(findings),
    findings,
  };
}

/**
 * Combine axe results from **multiple pages** into one consolidated
 * {@link Assessment}. Each finding is tagged with the page it came from
 * (`evidence.page`), and WCAG rollups aggregate every rule across all pages.
 */
export function combineAxeResults(
  pages: AxePage[],
  options: { targetLevel?: WcagLevel } = {},
): Assessment {
  const targetLevel = options.targetLevel ?? "AA";

  const allFindings: Finding[] = [];
  const stats: Record<WcagLevel, { passed: number; evaluated: number }> = {
    A: { passed: 0, evaluated: 0 },
    AA: { passed: 0, evaluated: 0 },
    AAA: { passed: 0, evaluated: 0 },
  };

  const account = (rule: AxeRuleResult, passed: boolean) => {
    const ruleLevel = levelFromTags(rule.tags);
    if (!ruleLevel) return;
    for (const level of ["A", "AA", "AAA"] as WcagLevel[]) {
      if (rank[ruleLevel] > rank[level]) continue;
      stats[level].evaluated++;
      if (passed) stats[level].passed++;
    }
  };

  for (const page of pages) {
    for (const finding of axeToFindings(page.results)) {
      allFindings.push({
        ...finding,
        evidence: { ...finding.evidence, page: page.url },
      });
    }
    for (const p of page.results.passes ?? []) account(p, true);
    for (const v of page.results.violations) account(v, false);
  }

  const wcag = {
    A: pct(stats.A),
    AA: pct(stats.AA),
    AAA: pct(stats.AAA),
  } as Record<WcagLevel, number>;

  return {
    generatedAt: new Date().toISOString(),
    platform: "web",
    targetLevel,
    overallScore: computeOverallScore(allFindings, 100),
    counts: countBySeverity(allFindings),
    wcag,
    categories: buildCategories(allFindings),
    topIssues: computeTopIssues(allFindings),
    findings: allFindings,
  };
}

function pct(stat: { passed: number; evaluated: number }): number {
  return stat.evaluated === 0 ? 100 : Math.round((stat.passed / stat.evaluated) * 100);
}

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];
function worstSeverity(findings: Finding[]): Severity {
  for (const sev of SEVERITY_ORDER) {
    if (findings.some((f) => f.severity === sev)) return sev;
  }
  return "low";
}
