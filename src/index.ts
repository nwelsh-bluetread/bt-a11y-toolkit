/**
 * @bluetread/accessibility-toolkit
 *
 * Public API. Import rules, the audit runner, report formatters, and the Jira
 * integration from here.
 */

export * from "./types.js";
export { WCAG, wcag } from "./wcag.js";
export {
  flatten,
  isInteractive,
  isHiddenFromAT,
  hasAccessibleName,
  isTextNode,
  isImageNode,
} from "./utils.js";
export { contrastRatio, luminance, parseHex, isLargeText, requiredContrast } from "./contrast.js";
export { readSitemap, parseSitemapLocs, isSitemapIndex } from "./sitemap.js";
export type { SitemapFetch, ReadSitemapOptions } from "./sitemap.js";
export {
  FORM_FACTORS,
  resolveFormFactor,
  lighthouseEmulationSettings,
  puppeteerViewport,
} from "./formFactor.js";
export type { FormFactor, FormFactorConfig } from "./formFactor.js";
export {
  defaultRules,
  accessibleNameRule,
  buttonRoleRule,
  imageAccessibilityRule,
  touchTargetRule,
  inputLabelRule,
  requiredStateRule,
  disabledStateRule,
  selectedStateRule,
  expandedStateRule,
  statusAnnouncementRule,
  decorativeHiddenRule,
  customPropsRule,
  contrastRule,
} from "./rules.js";
export type { CategorizedRule, RuleCategory } from "./rules.js";
export {
  runAudit,
  combineAudits,
  computeOverallScore,
  computeWcagRollup,
  computeCategoryScores,
  computeTopIssues,
  countBySeverity,
} from "./audit.js";
export type { AuditOptions, AuditTarget } from "./audit.js";
export { formatConsole, formatJson, formatMarkdown, sortFindings } from "./report.js";
export {
  createJiraTickets,
  buildTicketPayload,
  filterBySeverity,
} from "./integrations/jira.js";
export type { JiraConfig, CreatedTicket, FetchLike } from "./integrations/jira.js";
export {
  lighthouseToFindings,
  lighthouseToAssessment,
  combineLighthouseResults,
  LIGHTHOUSE_AUDIT_MAP,
} from "./integrations/lighthouse.js";
export type { LighthouseResult, LighthouseAudit, LighthousePage } from "./integrations/lighthouse.js";
export {
  axeToFindings,
  axeToAssessment,
  combineAxeResults,
  wcagIdsFromTags,
  AXE_RULE_MAP,
} from "./integrations/axe.js";
export type {
  AxeResults,
  AxeRuleResult,
  AxeNode,
  AxeImpact,
  AxePage,
} from "./integrations/axe.js";
export {
  pa11yToFindings,
  pa11yToAssessment,
  combinePa11yResults,
  parseHtmlcsCode,
  resolveIssueMapping,
} from "./integrations/pa11y.js";
export type {
  Pa11yResults,
  Pa11yIssue,
  Pa11yIssueType,
  Pa11yPage,
} from "./integrations/pa11y.js";
export { mergeAssessments, isSameElement, selectorTail } from "./integrations/combined.js";
export { mapWithConcurrency, resolveConcurrency } from "./concurrency.js";
export {
  fingerprint,
  normalizeSelector,
  recordRun,
  diffRuns,
  mergeRunHistory,
  allFingerprints,
} from "./history.js";
export type {
  RunMeta,
  RunRecord,
  TrackedFinding,
  FindingStatus,
  FindingChange,
  RunDiff,
} from "./history.js";
export {
  scoreTrend,
  recurringIssues,
  mttrByCategory,
  mttrBySeverity,
  hotspots,
} from "./trends.js";
export type { ScorePoint, Recurrence, Mttr, Hotspot } from "./trends.js";
export {
  MANUAL_CHECKS,
  manualChecksForLevel,
  generateChecklistMarkdown,
  generateChecklistCsv,
  parseVerdict,
  ingestChecklist,
} from "./manual.js";
export type {
  ManualCheck,
  ChecklistOptions,
  CellVerdict,
  IngestResult,
} from "./manual.js";