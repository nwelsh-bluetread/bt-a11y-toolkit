/**
 * Remediation-effort estimation.
 *
 * Turns a set of findings into a rough engineering-hours estimate so a report
 * can prioritise quick wins vs. high-effort work. Estimates are per finding and
 * deterministic, so a de-duplicated set of findings is costed exactly once —
 * merging two engines that report the same issue does not double the hours.
 */
import type { Finding, Severity } from "./types.js";

/** Baseline engineering hours to remediate a single finding, by severity. */
export const SEVERITY_HOURS: Record<Severity, number> = {
  critical: 4,
  high: 2,
  medium: 1,
  low: 0.5,
};

/** Estimated engineering hours to remediate one finding. */
export function estimateHours(finding: Finding): number {
  return SEVERITY_HOURS[finding.severity];
}

/**
 * Sum the estimated remediation hours across a set of findings.
 *
 * Because the estimate is per finding, feeding it a de-duplicated set (e.g. the
 * output of {@link import("./integrations/combined.js").mergeAssessments}) costs
 * each real defect once rather than once per engine that reported it.
 */
export function estimateTotalHours(findings: Finding[]): number {
  return findings.reduce((sum, finding) => sum + estimateHours(finding), 0);
}
