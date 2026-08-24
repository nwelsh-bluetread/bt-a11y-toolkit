/**
 * Lighthouse integration.
 *
 * This module is intentionally *pure*: it converts a Lighthouse Result (LHR)
 * object into the toolkit's {@link Finding} / {@link Assessment} model. It does
 * NOT run Lighthouse itself (that lives in `scripts/lighthouse.ts`), which keeps
 * it fast to unit test and free of heavy browser dependencies.
 */
import type { Assessment, Finding, Severity, WcagLevel } from "../types.js";
import type { WcagCriterion } from "../types.js";
import { WCAG } from "../wcag.js";
import {
  computeOverallScore,
  computeTopIssues,
  countBySeverity,
} from "../audit.js";

/** The minimal shape of a Lighthouse audit we rely on. */
export interface LighthouseAudit {
  id: string;
  title: string;
  description?: string;
  /** 0 (fail) .. 1 (pass), or null when not applicable / manual. */
  score: number | null;
  scoreDisplayMode?: string;
  details?: {
    items?: Array<{
      node?: { selector?: string; snippet?: string; nodeLabel?: string };
      [key: string]: unknown;
    }>;
  };
}

/** The minimal shape of a Lighthouse Result (LHR). */
export interface LighthouseResult {
  requestedUrl?: string;
  finalUrl?: string;
  categories?: {
    accessibility?: {
      score?: number | null;
      auditRefs?: Array<{ id: string; weight?: number; group?: string }>;
    };
  };
  audits: Record<string, LighthouseAudit>;
}

/** How a single Lighthouse audit maps into the toolkit model. */
interface AuditMapping {
  severity: Severity;
  category: string;
  wcag: string[];
}

/**
 * Mapping of common Lighthouse accessibility audit ids to severity, scorecard
 * category, and WCAG success criteria. Unmapped audits fall back to
 * {@link DEFAULT_MAPPING}.
 */
export const LIGHTHOUSE_AUDIT_MAP: Record<string, AuditMapping> = {
  "color-contrast": { severity: "high", category: "Contrast", wcag: ["1.4.3"] },
  "image-alt": { severity: "high", category: "Images/Icons", wcag: ["1.1.1"] },
  "input-image-alt": { severity: "high", category: "Images/Icons", wcag: ["1.1.1"] },
  "object-alt": { severity: "high", category: "Images/Icons", wcag: ["1.1.1"] },
  "button-name": { severity: "critical", category: "Semantics", wcag: ["4.1.2"] },
  "link-name": { severity: "critical", category: "Semantics", wcag: ["4.1.2"] },
  label: { severity: "critical", category: "Forms", wcag: ["3.3.2", "1.3.1"] },
  "form-field-multiple-labels": { severity: "medium", category: "Forms", wcag: ["3.3.2"] },
  "aria-required-attr": { severity: "high", category: "Semantics", wcag: ["4.1.2"] },
  "aria-required-children": { severity: "high", category: "Semantics", wcag: ["1.3.1"] },
  "aria-required-parent": { severity: "high", category: "Semantics", wcag: ["1.3.1"] },
  "aria-roles": { severity: "high", category: "Semantics", wcag: ["4.1.2"] },
  "aria-valid-attr": { severity: "high", category: "Semantics", wcag: ["4.1.2"] },
  "aria-valid-attr-value": { severity: "high", category: "Semantics", wcag: ["4.1.2"] },
  "aria-allowed-attr": { severity: "medium", category: "Semantics", wcag: ["4.1.2"] },
  "aria-hidden-body": { severity: "critical", category: "Screen Reader", wcag: ["4.1.2"] },
  "aria-hidden-focus": { severity: "high", category: "Screen Reader", wcag: ["4.1.2"] },
  "heading-order": { severity: "medium", category: "Typography", wcag: ["1.3.1"] },
  "document-title": { severity: "medium", category: "Semantics", wcag: ["2.4.6"] },
  "html-has-lang": { severity: "medium", category: "Semantics", wcag: ["1.3.1"] },
  "html-lang-valid": { severity: "medium", category: "Semantics", wcag: ["1.3.1"] },
  "valid-lang": { severity: "low", category: "Semantics", wcag: ["1.3.1"] },
  bypass: { severity: "high", category: "Navigation", wcag: ["2.4.3"] },
  tabindex: { severity: "medium", category: "Keyboard", wcag: ["2.1.1"] },
  "focus-traps": { severity: "high", category: "Keyboard", wcag: ["2.1.1"] },
  "focusable-controls": { severity: "high", category: "Keyboard", wcag: ["2.1.1"] },
  "interactive-element-affordance": { severity: "medium", category: "Semantics", wcag: ["4.1.2"] },
  "logical-tab-order": { severity: "medium", category: "Keyboard", wcag: ["2.4.3"] },
  list: { severity: "low", category: "Semantics", wcag: ["1.3.1"] },
  listitem: { severity: "low", category: "Semantics", wcag: ["1.3.1"] },
  "meta-viewport": { severity: "medium", category: "Responsive", wcag: ["1.4.4"] },
  "target-size": { severity: "medium", category: "Touch Targets", wcag: ["2.5.8"] },
  "video-caption": { severity: "high", category: "Images/Icons", wcag: ["1.1.1"] },
  "frame-title": { severity: "medium", category: "Semantics", wcag: ["4.1.2"] },
};

const DEFAULT_MAPPING: AuditMapping = {
  severity: "medium",
  category: "Semantics",
  wcag: ["4.1.2"],
};

function toCriteria(ids: string[]): WcagCriterion[] {
  return ids.map((id) => WCAG[id]).filter((c): c is WcagCriterion => Boolean(c));
}

/** A Lighthouse audit is a scored, applicable (binary) accessibility audit. */
function isScorable(audit: LighthouseAudit): boolean {
  return audit.score !== null && audit.scoreDisplayMode !== "manual" && audit.scoreDisplayMode !== "notApplicable" && audit.scoreDisplayMode !== "informative";
}

/**
 * Convert a Lighthouse result into toolkit findings. One finding is produced per
 * failing audit; the offending element selectors are captured as evidence.
 */
export function lighthouseToFindings(lhr: LighthouseResult): Finding[] {
  const refs = lhr.categories?.accessibility?.auditRefs ?? [];
  const auditIds = refs.length > 0 ? refs.map((r) => r.id) : Object.keys(lhr.audits);
  const findings: Finding[] = [];

  for (const id of auditIds) {
    const audit = lhr.audits[id];
    if (!audit || !isScorable(audit)) continue;
    if (audit.score === 1) continue; // passed

    const mapping = LIGHTHOUSE_AUDIT_MAP[id] ?? DEFAULT_MAPPING;
    const items = audit.details?.items ?? [];
    const selectors = items
      .map((i) => i.node?.selector)
      .filter((s): s is string => Boolean(s));

    findings.push({
      ruleId: `lighthouse:${id}`,
      title: audit.title,
      description: audit.description ?? audit.title,
      severity: mapping.severity,
      wcag: toCriteria(mapping.wcag),
      category: mapping.category,
      source: "lighthouse",
      platforms: ["web"],
      nodeId: selectors[0],
      evidence: {
        auditId: id,
        affectedElements: selectors.length,
        selectors: selectors.slice(0, 20),
      },
    });
  }

  return findings;
}

/**
 * Convert a Lighthouse result into a full toolkit {@link Assessment}, computing
 * the WCAG rollups from Lighthouse's own pass/fail audit outcomes.
 */
export function lighthouseToAssessment(
  lhr: LighthouseResult,
  options: { targetLevel?: WcagLevel } = {},
): Assessment {
  const targetLevel = options.targetLevel ?? "AA";
  const findings = lighthouseToFindings(lhr);

  // Per-level pass/eval accounting from every scorable audit.
  const levelStats: Record<WcagLevel, { passed: number; evaluated: number }> = {
    A: { passed: 0, evaluated: 0 },
    AA: { passed: 0, evaluated: 0 },
    AAA: { passed: 0, evaluated: 0 },
  };
  const rank: Record<WcagLevel, number> = { A: 1, AA: 2, AAA: 3 };

  const refs = lhr.categories?.accessibility?.auditRefs ?? [];
  const auditIds = refs.length > 0 ? refs.map((r) => r.id) : Object.keys(lhr.audits);
  for (const id of auditIds) {
    const audit = lhr.audits[id];
    if (!audit || !isScorable(audit)) continue;
    const mapping = LIGHTHOUSE_AUDIT_MAP[id] ?? DEFAULT_MAPPING;
    const criteria = toCriteria(mapping.wcag);
    const passed = audit.score === 1;
    for (const level of ["A", "AA", "AAA"] as WcagLevel[]) {
      const relevant = criteria.some((c) => rank[c.level] <= rank[level]);
      if (!relevant) continue;
      levelStats[level].evaluated++;
      if (passed) levelStats[level].passed++;
    }
  }

  const wcag = {
    A: pct(levelStats.A),
    AA: pct(levelStats.AA),
    AAA: pct(levelStats.AAA),
  } as Record<WcagLevel, number>;

  // Category rollup from findings (external tools don't report per-category passes).
  const categoriesMap = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = f.category ?? "Semantics";
    const list = categoriesMap.get(key) ?? [];
    list.push(f);
    categoriesMap.set(key, list);
  }
  const categories = [...categoriesMap.entries()]
    .map(([category, list]) => ({
      category,
      score: Math.max(0, 100 - list.length * 15),
      severity: worstSeverity(list),
      findingCount: list.length,
    }))
    .sort((a, b) => a.score - b.score);

  return {
    generatedAt: new Date().toISOString(),
    platform: "web",
    targetLevel,
    overallScore:
      typeof lhr.categories?.accessibility?.score === "number"
        ? Math.round(lhr.categories.accessibility.score * 100)
        : computeOverallScore(findings, 100),
    counts: countBySeverity(findings),
    wcag,
    categories,
    topIssues: computeTopIssues(findings),
    findings,
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
