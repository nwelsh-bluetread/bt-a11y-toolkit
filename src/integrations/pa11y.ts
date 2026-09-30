/**
 * Pa11y integration.
 *
 * Like the axe-core and Lighthouse integrations, this module is intentionally
 * *pure*: it converts a Pa11y results object into the toolkit's {@link Finding}
 * / {@link Assessment} model. It does NOT run Pa11y itself (that lives in
 * `scripts/pa11y.ts`), which keeps it fast to unit test and free of heavy
 * browser dependencies.
 *
 * Pa11y supports two test runners — HTML_CodeSniffer (`htmlcs`, the default) and
 * axe. Both emit issues with the same shape; the difference is the `code`:
 *
 *   - HTML_CodeSniffer encodes the WCAG criterion in the code, e.g.
 *     `WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail` -> criterion `1.4.3`,
 *     level `AA`.
 *   - The axe runner uses the plain axe rule id as the code, e.g.
 *     `color-contrast`, which we resolve through the shared {@link AXE_RULE_MAP}.
 */
import type { Assessment, Finding, Platform, Severity, WcagLevel } from "../types.js";
import type { WcagCriterion } from "../types.js";
import { WCAG } from "../wcag.js";
import {
  computeOverallScore,
  computeTopIssues,
  countBySeverity,
} from "../audit.js";
import { AXE_RULE_MAP, wcagIdsFromTags } from "./axe.js";

/** Pa11y issue severity, mirroring HTML_CodeSniffer / axe reporting. */
export type Pa11yIssueType = "error" | "warning" | "notice";

/** A single issue reported by a Pa11y runner. */
export interface Pa11yIssue {
  /**
   * The issue code. For the HTML_CodeSniffer runner this is a dotted WCAG
   * technique path (e.g. `WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail`); for
   * the axe runner it is the axe rule id (e.g. `color-contrast`).
   */
  code: string;
  type: Pa11yIssueType;
  /** 1 = error, 2 = warning, 3 = notice. */
  typeCode?: number;
  message: string;
  /** The outer HTML snippet of the offending element. */
  context?: string;
  /** CSS selector identifying the offending element. */
  selector?: string;
  /** Which runner produced the issue (`htmlcs` or `axe`). */
  runner?: string;
  runnerExtras?: Record<string, unknown>;
}

/**
 * The shape of a Pa11y results object. Pa11y's Node API resolves to an object
 * (`{ documentTitle, pageUrl, issues }`); some pipelines persist just the issue
 * array. Both are accepted here.
 */
export interface Pa11yResults {
  documentTitle?: string;
  pageUrl?: string;
  /** The URL that was tested, when available. */
  url?: string;
  issues: Pa11yIssue[];
}

/** How a single Pa11y issue maps into the toolkit model. */
interface IssueMapping {
  severity: Severity;
  category: string;
  wcag: string[];
  level?: WcagLevel;
}

/** Issue type -> baseline severity when nothing more specific is known. */
const TYPE_SEVERITY: Record<Pa11yIssueType, Severity> = {
  error: "high",
  warning: "medium",
  notice: "low",
};

/**
 * Map a WCAG criterion id to the scorecard category the toolkit uses. Mirrors
 * the categorisation baked into {@link AXE_RULE_MAP} so Pa11y and axe findings
 * roll up into the same buckets.
 */
const CRITERION_CATEGORY: Record<string, string> = {
  "1.1.1": "Images/Icons",
  "1.2.2": "Images/Icons",
  "1.3.1": "Semantics",
  "1.4.1": "Contrast",
  "1.4.3": "Contrast",
  "1.4.4": "Responsive",
  "1.4.6": "Contrast",
  "1.4.11": "Contrast",
  "2.1.1": "Keyboard",
  "2.4.1": "Navigation",
  "2.4.2": "Semantics",
  "2.4.3": "Keyboard",
  "2.4.6": "Typography",
  "2.4.7": "Keyboard",
  "2.5.8": "Touch Targets",
  "3.1.1": "Semantics",
  "3.1.2": "Semantics",
  "3.3.1": "Forms",
  "3.3.2": "Forms",
  "4.1.2": "Semantics",
  "4.1.3": "Screen Reader",
};

const DEFAULT_MAPPING: IssueMapping = {
  severity: "medium",
  category: "Semantics",
  wcag: ["4.1.2"],
};

/** Convert WCAG ids to full criteria, dropping anything not in the catalogue. */
function toCriteria(ids: string[]): WcagCriterion[] {
  return ids.map((id) => WCAG[id]).filter((c): c is WcagCriterion => Boolean(c));
}

const LEVEL_RANK: Record<WcagLevel, number> = { A: 1, AA: 2, AAA: 3 };

/**
 * Parse an HTML_CodeSniffer issue code.
 *
 * Codes look like `WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail`. The leading
 * `WCAG2AA` gives the conformance level; the fourth dotted segment (`1_4_3`) is
 * the success criterion. Returns `undefined` for codes that don't follow the
 * HTML_CodeSniffer WCAG convention (e.g. axe rule ids).
 */
export function parseHtmlcsCode(code: string): { wcag?: string; level?: WcagLevel } {
  const level = /^WCAG2(AAA|AA|A)\b/.exec(code)?.[1] as WcagLevel | undefined;
  const criterion = /\.(\d+)_(\d+)_(\d+)\./.exec(code);
  const wcag = criterion ? `${criterion[1]}.${criterion[2]}.${criterion[3]}` : undefined;
  return { wcag, level };
}

/**
 * Build the effective mapping for an issue.
 *
 * Order of preference:
 *   1. axe-runner codes resolve through the shared {@link AXE_RULE_MAP}.
 *   2. HTML_CodeSniffer codes are parsed for their WCAG criterion; category and
 *      level derive from that.
 *   3. Anything else falls back to a type-derived severity and a default bucket.
 *
 * Severity always defers to the issue `type` for warnings/notices so a
 * high-severity mapped criterion reported only as a "notice" is not overstated.
 */
export function resolveIssueMapping(issue: Pa11yIssue): IssueMapping {
  const typeSeverity = TYPE_SEVERITY[issue.type];

  // axe runner: the code is an axe rule id.
  const axeMapping = AXE_RULE_MAP[issue.code];
  if (axeMapping) {
    return {
      // Errors keep the rule's mapped severity; softer types are capped by type.
      severity: issue.type === "error" ? axeMapping.severity : typeSeverity,
      category: axeMapping.category,
      wcag: axeMapping.wcag,
    };
  }

  // HTML_CodeSniffer runner: parse the WCAG criterion out of the code.
  const { wcag, level } = parseHtmlcsCode(issue.code);
  if (wcag) {
    return {
      severity: typeSeverity,
      category: CRITERION_CATEGORY[wcag] ?? DEFAULT_MAPPING.category,
      wcag: [wcag],
      level,
    };
  }

  // Last resort: try axe-style wcag tags embedded in the code, else default.
  const tagged = wcagIdsFromTags(issue.code.toLowerCase().split(/[.\s]+/));
  return {
    severity: typeSeverity,
    category: DEFAULT_MAPPING.category,
    wcag: tagged.length > 0 ? tagged : DEFAULT_MAPPING.wcag,
  };
}

/** Normalise the various Pa11y result shapes to a plain issue array. */
function issuesOf(results: Pa11yResults): Pa11yIssue[] {
  return Array.isArray(results.issues) ? results.issues : [];
}

/** The URL a results object describes, however it was recorded. */
function urlOf(results: Pa11yResults): string | undefined {
  return results.url ?? results.pageUrl;
}

/**
 * Convert Pa11y results into toolkit findings. One finding is produced per
 * issue; the offending element selector and HTML snippet are captured as
 * evidence.
 */
export function pa11yToFindings(
  results: Pa11yResults,
  options: { platform?: Platform } = {},
): Finding[] {
  const platform = options.platform ?? "web";
  const findings: Finding[] = [];

  for (const issue of issuesOf(results)) {
    const mapping = resolveIssueMapping(issue);
    const selector = issue.selector || undefined;

    findings.push({
      ruleId: `pa11y:${issue.code}`,
      title: issue.message,
      description: issue.message,
      severity: mapping.severity,
      wcag: toCriteria(mapping.wcag),
      category: mapping.category,
      source: "pa11y",
      platforms: [platform],
      nodeId: selector,
      evidence: {
        code: issue.code,
        type: issue.type,
        runner: issue.runner,
        selectors: selector ? [selector] : [],
        html: issue.context,
      },
    });
  }

  return findings;
}

/**
 * Per-level pass/eval accounting derived from Pa11y issues.
 *
 * Pa11y does not report the checks that *passed*, so unlike axe we cannot
 * compute a true pass-rate. Instead each conformance level starts at a perfect
 * score and is penalised per error/warning of that level and below, giving a
 * comparable 0-100 rollup.
 */
function wcagRollup(issues: Pa11yIssue[]): Record<WcagLevel, number> {
  const penalties: Record<WcagLevel, number> = { A: 0, AA: 0, AAA: 0 };

  for (const issue of issues) {
    if (issue.type === "notice") continue;
    const mapping = resolveIssueMapping(issue);
    const level =
      mapping.level ??
      (mapping.wcag.map((id) => WCAG[id]?.level).find(Boolean) as WcagLevel | undefined);
    if (!level) continue;
    const weight = issue.type === "error" ? 8 : 3;
    // An A-level failure also drags down the stricter AA and AAA scores.
    for (const target of ["A", "AA", "AAA"] as WcagLevel[]) {
      if (LEVEL_RANK[level] <= LEVEL_RANK[target]) penalties[target] += weight;
    }
  }

  return {
    A: Math.max(0, 100 - penalties.A),
    AA: Math.max(0, 100 - penalties.AA),
    AAA: Math.max(0, 100 - penalties.AAA),
  } as Record<WcagLevel, number>;
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
 * Convert a Pa11y results object into a full toolkit {@link Assessment}.
 */
export function pa11yToAssessment(
  results: Pa11yResults,
  options: { targetLevel?: WcagLevel; platform?: Platform } = {},
): Assessment {
  const targetLevel = options.targetLevel ?? "AA";
  const platform = options.platform ?? "web";
  const findings = pa11yToFindings(results, { platform });

  return {
    generatedAt: new Date().toISOString(),
    platform,
    targetLevel,
    overallScore: computeOverallScore(findings, 100),
    counts: countBySeverity(findings),
    wcag: wcagRollup(issuesOf(results)),
    categories: buildCategories(findings),
    topIssues: computeTopIssues(findings),
    findings,
  };
}

/** A single scanned page: its URL and the Pa11y results for it. */
export interface Pa11yPage {
  url: string;
  results: Pa11yResults;
}

/**
 * Combine Pa11y results from **multiple pages** into one consolidated
 * {@link Assessment}. Each finding is tagged with the page it came from (in
 * `evidence.page`), the overall score is derived from all findings, and WCAG
 * rollups aggregate every issue across all pages.
 */
export function combinePa11yResults(
  pages: Pa11yPage[],
  options: { targetLevel?: WcagLevel; platform?: Platform } = {},
): Assessment {
  const targetLevel = options.targetLevel ?? "AA";
  const platform = options.platform ?? "web";

  const allFindings: Finding[] = [];
  const allIssues: Pa11yIssue[] = [];

  for (const page of pages) {
    for (const finding of pa11yToFindings(page.results, { platform })) {
      allFindings.push({
        ...finding,
        evidence: { ...finding.evidence, page: page.url },
      });
    }
    allIssues.push(...issuesOf(page.results));
  }

  return {
    generatedAt: new Date().toISOString(),
    platform,
    targetLevel,
    overallScore: computeOverallScore(allFindings, 100),
    counts: countBySeverity(allFindings),
    wcag: wcagRollup(allIssues),
    categories: buildCategories(allFindings),
    topIssues: computeTopIssues(allFindings),
    findings: allFindings,
  };
}
