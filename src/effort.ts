/**
 * Remediation effort estimation.
 *
 * Turns a {@link Finding} into a rough engineering-hours estimate so reports can
 * show per-issue and total remediation effort. Estimates are intentionally
 * conservative, per-issue "developer time only" figures (design, QA, and
 * re-testing are tracked separately in the engagement plan).
 *
 * The model is: a base cost derived from the finding's category/rule (some fixes
 * are structurally harder than others), nudged by severity, then scaled by how
 * many elements are affected — the first element costs the base, additional
 * instances of the same issue are cheaper because the fix is usually shared.
 */
import type { Finding, Severity } from "./types.js";

/**
 * Base hours to fix a single instance, by scorecard category. These reflect the
 * typical developer effort for one occurrence once the cause is understood.
 */
const CATEGORY_BASE_HOURS: Record<string, number> = {
  Contrast: 0.5, // usually a token/theme colour change
  "Images/Icons": 0.25, // add alt text / mark decorative
  Semantics: 0.5, // roles / names / ARIA wiring
  Forms: 1, // label association can touch markup + state
  "Touch Targets": 0.5, // sizing / hitSlop / padding
  "Screen Reader": 1.5, // live regions, state, announcements are fiddly
  Keyboard: 2, // focus management / tab order
  Navigation: 1.5, // landmarks, skip links, regions
  Typography: 0.5, // heading order / structure
  Responsive: 1, // viewport / reflow
};

/** Fallback when a finding has no recognised category. */
const DEFAULT_BASE_HOURS = 0.75;

/** Multiplier applied to the base cost by severity. */
const SEVERITY_MULTIPLIER: Record<Severity, number> = {
  critical: 1.5,
  high: 1.25,
  medium: 1,
  low: 0.75,
};

/**
 * Rule-specific overrides for the single-instance base cost, keyed by the
 * finding's `ruleId`. Matches both toolkit rule ids and scanner-prefixed ids
 * (e.g. `axe:label`, `lighthouse:color-contrast`) via a suffix match.
 */
const RULE_BASE_HOURS: Record<string, number> = {
  "custom-component-props": 1.5, // requires editing a shared component + props
  "status-announcement": 1.5,
  "expanded-state": 1,
  "text-contrast": 0.5,
  "color-contrast": 0.5,
  "touch-target-size": 0.5,
  "image-accessibility": 0.25,
  "image-alt": 0.25,
  label: 1,
  "input-label": 1,
};

/** How much each additional affected element adds, as a fraction of base. */
const ADDITIONAL_ELEMENT_FACTOR = 0.35;
/** Cap on how many additional elements accrue cost (shared fixes plateau). */
const MAX_BILLED_ELEMENTS = 12;

/** Round to the nearest quarter hour for tidy reporting. */
function roundQuarter(hours: number): number {
  return Math.round(hours * 4) / 4;
}

/** Read the number of affected elements from a finding's evidence. */
export function affectedElementCount(finding: Finding): number {
  const ev = finding.evidence ?? {};
  if (typeof ev.affectedElements === "number" && ev.affectedElements > 0) {
    return ev.affectedElements;
  }
  if (Array.isArray(ev.elements) && ev.elements.length > 0) return ev.elements.length;
  if (Array.isArray(ev.selectors) && ev.selectors.length > 0) return ev.selectors.length;
  return 1;
}

/** Resolve the single-instance base cost for a finding. */
function baseHoursFor(finding: Finding): number {
  // ruleId may be prefixed (e.g. "axe:label"); match on the bare rule name too.
  const bareId = finding.ruleId.includes(":")
    ? finding.ruleId.slice(finding.ruleId.indexOf(":") + 1)
    : finding.ruleId;
  if (RULE_BASE_HOURS[finding.ruleId] !== undefined) return RULE_BASE_HOURS[finding.ruleId]!;
  if (RULE_BASE_HOURS[bareId] !== undefined) return RULE_BASE_HOURS[bareId]!;
  if (finding.category && CATEGORY_BASE_HOURS[finding.category] !== undefined) {
    return CATEGORY_BASE_HOURS[finding.category]!;
  }
  return DEFAULT_BASE_HOURS;
}

/**
 * Estimate remediation hours for a single finding. The first affected element
 * costs the (severity-adjusted) base; each additional element adds a fraction of
 * it, up to {@link MAX_BILLED_ELEMENTS}.
 */
export function estimateFindingHours(finding: Finding): number {
  const base = baseHoursFor(finding) * SEVERITY_MULTIPLIER[finding.severity];
  const affected = affectedElementCount(finding);
  const billableExtra = Math.min(affected - 1, MAX_BILLED_ELEMENTS - 1);
  const total = base * (1 + Math.max(0, billableExtra) * ADDITIONAL_ELEMENT_FACTOR);
  return Math.max(0.25, roundQuarter(total));
}

/** Total estimated remediation hours across a set of findings. */
export function estimateTotalHours(findings: Finding[]): number {
  const total = findings.reduce(
    (sum, f) => sum + (f.estimatedHours ?? estimateFindingHours(f)),
    0,
  );
  return roundQuarter(total);
}

/** Return a copy of each finding with `estimatedHours` populated. */
export function withEffortEstimates(findings: Finding[]): Finding[] {
  return findings.map((f) => ({
    ...f,
    estimatedHours: f.estimatedHours ?? estimateFindingHours(f),
  }));
}

/** Format hours for display, e.g. `0.5h`, `2h`, `~1 day (8h)`. */
export function formatHours(hours: number): string {
  if (hours >= 8) {
    const days = roundQuarter(hours / 8);
    return `~${days} day${days === 1 ? "" : "s"} (${hours}h)`;
  }
  return `${hours}h`;
}
