/**
 * axe-core integration.
 *
 * Like the Lighthouse integration, this module is intentionally *pure*: it
 * converts an axe-core results object into the toolkit's {@link Finding} /
 * {@link Assessment} model. It does NOT run axe itself (that lives in
 * `scripts/axe.ts`), which keeps it fast to unit test and free of heavy browser
 * dependencies.
 */
import type { Assessment, Finding, Severity, WcagLevel } from "../types.js";
import type { WcagCriterion } from "../types.js";
import { WCAG } from "../wcag.js";
import {
  computeOverallScore,
  computeTopIssues,
  countBySeverity,
} from "../audit.js";

/** axe-core impact levels. */
export type AxeImpact = "minor" | "moderate" | "serious" | "critical" | null;

/** A single offending DOM node reported by an axe rule. */
export interface AxeNode {
  /** CSS selectors identifying the element (may be nested for iframes). */
  target?: Array<string | string[]>;
  /** The outer HTML snippet of the element. */
  html?: string;
  /** Human-readable summary of why the node failed. */
  failureSummary?: string;
  impact?: AxeImpact;
}

/** A single axe-core rule result (used for violations, passes, incomplete). */
export interface AxeRuleResult {
  id: string;
  impact?: AxeImpact;
  /** Rule tags, e.g. "wcag2a", "wcag143", "cat.color", "best-practice". */
  tags: string[];
  description: string;
  help: string;
  helpUrl?: string;
  nodes: AxeNode[];
}

/** The minimal shape of an axe-core results object (`axe.run` output). */
export interface AxeResults {
  /** The URL that was tested, when available. */
  url?: string;
  testEngine?: { name?: string; version?: string };
  violations: AxeRuleResult[];
  passes?: AxeRuleResult[];
  incomplete?: AxeRuleResult[];
  inapplicable?: AxeRuleResult[];
}

/** How a single axe rule maps into the toolkit model. */
interface RuleMapping {
  severity: Severity;
  category: string;
  wcag: string[];
}

/**
 * Mapping of common axe-core rule ids to severity, scorecard category, and WCAG
 * success criteria. Unmapped rules fall back to a derived mapping that reads the
 * WCAG criteria from the rule's own `tags` and the severity from its `impact`.
 */
export const AXE_RULE_MAP: Record<string, RuleMapping> = {
  "color-contrast": { severity: "high", category: "Contrast", wcag: ["1.4.3"] },
  "color-contrast-enhanced": { severity: "medium", category: "Contrast", wcag: ["1.4.6"] },
  "image-alt": { severity: "high", category: "Images/Icons", wcag: ["1.1.1"] },
  "input-image-alt": { severity: "high", category: "Images/Icons", wcag: ["1.1.1"] },
  "object-alt": { severity: "high", category: "Images/Icons", wcag: ["1.1.1"] },
  "role-img-alt": { severity: "high", category: "Images/Icons", wcag: ["1.1.1"] },
  "svg-img-alt": { severity: "high", category: "Images/Icons", wcag: ["1.1.1"] },
  "button-name": { severity: "critical", category: "Semantics", wcag: ["4.1.2"] },
  "link-name": { severity: "critical", category: "Semantics", wcag: ["4.1.2"] },
  label: { severity: "critical", category: "Forms", wcag: ["3.3.2", "1.3.1"] },
  "label-title-only": { severity: "medium", category: "Forms", wcag: ["3.3.2"] },
  "form-field-multiple-labels": { severity: "medium", category: "Forms", wcag: ["3.3.2"] },
  "select-name": { severity: "critical", category: "Forms", wcag: ["4.1.2"] },
  "aria-required-attr": { severity: "high", category: "Semantics", wcag: ["4.1.2"] },
  "aria-required-children": { severity: "high", category: "Semantics", wcag: ["1.3.1"] },
  "aria-required-parent": { severity: "high", category: "Semantics", wcag: ["1.3.1"] },
  "aria-roles": { severity: "high", category: "Semantics", wcag: ["4.1.2"] },
  "aria-valid-attr": { severity: "high", category: "Semantics", wcag: ["4.1.2"] },
  "aria-valid-attr-value": { severity: "high", category: "Semantics", wcag: ["4.1.2"] },
  "aria-allowed-attr": { severity: "medium", category: "Semantics", wcag: ["4.1.2"] },
  "aria-allowed-role": { severity: "low", category: "Semantics", wcag: ["4.1.2"] },
  "aria-command-name": { severity: "critical", category: "Semantics", wcag: ["4.1.2"] },
  "aria-hidden-body": { severity: "critical", category: "Screen Reader", wcag: ["4.1.2"] },
  "aria-hidden-focus": { severity: "high", category: "Screen Reader", wcag: ["4.1.2"] },
  "aria-input-field-name": { severity: "critical", category: "Forms", wcag: ["4.1.2"] },
  "aria-toggle-field-name": { severity: "critical", category: "Forms", wcag: ["4.1.2"] },
  "heading-order": { severity: "medium", category: "Typography", wcag: ["1.3.1"] },
  "empty-heading": { severity: "low", category: "Typography", wcag: ["1.3.1"] },
  "document-title": { severity: "medium", category: "Semantics", wcag: ["2.4.2"] },
  "html-has-lang": { severity: "medium", category: "Semantics", wcag: ["3.1.1"] },
  "html-lang-valid": { severity: "medium", category: "Semantics", wcag: ["3.1.1"] },
  "valid-lang": { severity: "low", category: "Semantics", wcag: ["3.1.2"] },
  bypass: { severity: "high", category: "Navigation", wcag: ["2.4.1"] },
  "skip-link": { severity: "medium", category: "Navigation", wcag: ["2.4.1"] },
  tabindex: { severity: "medium", category: "Keyboard", wcag: ["2.1.1"] },
  list: { severity: "low", category: "Semantics", wcag: ["1.3.1"] },
  listitem: { severity: "low", category: "Semantics", wcag: ["1.3.1"] },
  "definition-list": { severity: "low", category: "Semantics", wcag: ["1.3.1"] },
  "meta-viewport": { severity: "medium", category: "Responsive", wcag: ["1.4.4"] },
  "target-size": { severity: "medium", category: "Touch Targets", wcag: ["2.5.8"] },
  "video-caption": { severity: "high", category: "Images/Icons", wcag: ["1.2.2"] },
  "frame-title": { severity: "medium", category: "Semantics", wcag: ["4.1.2"] },
  "duplicate-id-aria": { severity: "medium", category: "Semantics", wcag: ["4.1.2"] },
  "nested-interactive": { severity: "medium", category: "Semantics", wcag: ["4.1.2"] },
  "scrollable-region-focusable": { severity: "medium", category: "Keyboard", wcag: ["2.1.1"] },
  region: { severity: "low", category: "Navigation", wcag: ["1.3.1"] },
  "landmark-one-main": { severity: "low", category: "Navigation", wcag: ["1.3.1"] },
  "page-has-heading-one": { severity: "low", category: "Typography", wcag: ["1.3.1"] },
};

/** Impact -> severity fallback for rules not in {@link AXE_RULE_MAP}. */
const IMPACT_SEVERITY: Record<Exclude<AxeImpact, null>, Severity> = {
  critical: "critical",
  serious: "high",
  moderate: "medium",
  minor: "low",
};

const DEFAULT_MAPPING: RuleMapping = {
  severity: "medium",
  category: "Semantics",
  wcag: ["4.1.2"],
};

/** Convert WCAG ids to full criteria, dropping anything not in the catalogue. */
function toCriteria(ids: string[]): WcagCriterion[] {
  return ids.map((id) => WCAG[id]).filter((c): c is WcagCriterion => Boolean(c));
}

/**
 * Derive WCAG criterion ids from axe rule tags. axe encodes criteria as
 * `wcag143` -> `1.4.3` (last digit is the sub-criterion). Handles two- and
 * three-part criteria.
 */
export function wcagIdsFromTags(tags: string[]): string[] {
  const ids: string[] = [];
  for (const tag of tags) {
    const m = /^wcag(\d{3,4})$/.exec(tag);
    if (!m) continue;
    const digits = m[1]!;
    // e.g. "143" -> ["1", "4", "3"], "1412" -> ["1", "4", "12"]
    const principle = digits[0];
    const guideline = digits[1];
    const criterion = digits.slice(2);
    ids.push(`${principle}.${guideline}.${Number(criterion)}`);
  }
  return ids;
}

/** Build the effective mapping for a rule, using explicit map then tags. */
function resolveMapping(rule: AxeRuleResult): RuleMapping {
  const explicit = AXE_RULE_MAP[rule.id];
  if (explicit) return explicit;

  const wcag = wcagIdsFromTags(rule.tags);
  const severity = rule.impact ? IMPACT_SEVERITY[rule.impact] : DEFAULT_MAPPING.severity;
  return {
    severity,
    category: DEFAULT_MAPPING.category,
    wcag: wcag.length > 0 ? wcag : DEFAULT_MAPPING.wcag,
  };
}

/** Flatten an axe node target (which may contain nested selectors) to a string. */
function targetToSelector(target?: Array<string | string[]>): string | undefined {
  if (!target || target.length === 0) return undefined;
  const first = target[0];
  return Array.isArray(first) ? first.join(" ") : first;
}

/**
 * Convert axe results into toolkit findings. One finding is produced per
 * violation; the offending element selectors are captured as evidence.
 */
export function axeToFindings(results: AxeResults): Finding[] {
  const findings: Finding[] = [];

  for (const rule of results.violations) {
    const mapping = resolveMapping(rule);
    const selectors = rule.nodes
      .map((n) => targetToSelector(n.target))
      .filter((s): s is string => Boolean(s));

    findings.push({
      ruleId: `axe:${rule.id}`,
      title: rule.help,
      description: rule.description,
      severity: mapping.severity,
      wcag: toCriteria(mapping.wcag),
      category: mapping.category,
      source: "axe",
      platforms: ["web"],
      nodeId: selectors[0],
      remediation: rule.helpUrl,
      evidence: {
        ruleId: rule.id,
        impact: rule.impact ?? undefined,
        affectedElements: rule.nodes.length,
        selectors: selectors.slice(0, 20),
        failureSummary: rule.nodes[0]?.failureSummary,
      },
    });
  }

  return findings;
}

const rank: Record<WcagLevel, number> = { A: 1, AA: 2, AAA: 3 };

/** Read the target conformance level a rule applies to from its tags. */
function levelFromTags(tags: string[]): WcagLevel | undefined {
  if (tags.includes("wcag2aaa") || tags.includes("wcag21aaa") || tags.includes("wcag22aaa")) return "AAA";
  if (tags.includes("wcag2aa") || tags.includes("wcag21aa") || tags.includes("wcag22aa")) return "AA";
  if (tags.includes("wcag2a") || tags.includes("wcag21a") || tags.includes("wcag22a")) return "A";
  return undefined;
}

/**
 * Accumulate per-level pass/eval accounting from a set of axe rule results.
 * `passed` marks whether these results represent passing rules.
 */
function tallyLevels(
  levelStats: Record<WcagLevel, { passed: number; evaluated: number }>,
  rules: AxeRuleResult[],
  passed: boolean,
): void {
  for (const rule of rules) {
    const ruleLevel = levelFromTags(rule.tags);
    if (!ruleLevel) continue;
    for (const level of ["A", "AA", "AAA"] as WcagLevel[]) {
      // A rule counts toward a target level if the rule's own level is at or
      // below it (e.g. an A rule is relevant to A, AA and AAA scoring).
      if (rank[ruleLevel] > rank[level]) continue;
      levelStats[level].evaluated++;
      if (passed) levelStats[level].passed++;
    }
  }
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

function buildCategories(findings: Finding[]): Assessment["categories"] {
  const categoriesMap = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = f.category ?? "Semantics";
    const list = categoriesMap.get(key) ?? [];
    list.push(f);
    categoriesMap.set(key, list);
  }
  return [...categoriesMap.entries()]
    .map(([category, list]) => ({
      category,
      score: Math.max(0, 100 - list.length * 15),
      severity: worstSeverity(list),
      findingCount: list.length,
    }))
    .sort((a, b) => a.score - b.score);
}

/**
 * Convert an axe results object into a full toolkit {@link Assessment},
 * computing the WCAG rollups from axe's own violations vs. passes.
 */
export function axeToAssessment(
  results: AxeResults,
  options: { targetLevel?: WcagLevel } = {},
): Assessment {
  const targetLevel = options.targetLevel ?? "AA";
  const findings = axeToFindings(results);

  const levelStats: Record<WcagLevel, { passed: number; evaluated: number }> = {
    A: { passed: 0, evaluated: 0 },
    AA: { passed: 0, evaluated: 0 },
    AAA: { passed: 0, evaluated: 0 },
  };
  tallyLevels(levelStats, results.passes ?? [], true);
  tallyLevels(levelStats, results.violations, false);

  const wcag = {
    A: pct(levelStats.A),
    AA: pct(levelStats.AA),
    AAA: pct(levelStats.AAA),
  } as Record<WcagLevel, number>;

  return {
    generatedAt: new Date().toISOString(),
    platform: "web",
    targetLevel,
    overallScore: computeOverallScore(findings, 100),
    counts: countBySeverity(findings),
    wcag,
    categories: buildCategories(findings),
    topIssues: computeTopIssues(findings),
    findings,
  };
}

/** A single scanned page: its URL and the axe results for it. */
export interface AxePage {
  url: string;
  results: AxeResults;
}

/**
 * Combine axe results from **multiple pages** into one consolidated
 * {@link Assessment}. Each finding is tagged with the page it came from (in
 * `evidence.page`), the overall score is derived from all findings, and WCAG
 * rollups aggregate every rule outcome across all pages.
 */
export function combineAxeResults(
  pages: AxePage[],
  options: { targetLevel?: WcagLevel } = {},
): Assessment {
  const targetLevel = options.targetLevel ?? "AA";

  const allFindings: Finding[] = [];
  const levelStats: Record<WcagLevel, { passed: number; evaluated: number }> = {
    A: { passed: 0, evaluated: 0 },
    AA: { passed: 0, evaluated: 0 },
    AAA: { passed: 0, evaluated: 0 },
  };

  for (const page of pages) {
    for (const finding of axeToFindings(page.results)) {
      allFindings.push({
        ...finding,
        evidence: { ...finding.evidence, page: page.url },
      });
    }
    tallyLevels(levelStats, page.results.passes ?? [], true);
    tallyLevels(levelStats, page.results.violations, false);
  }

  const wcag = {
    A: pct(levelStats.A),
    AA: pct(levelStats.AA),
    AAA: pct(levelStats.AAA),
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
