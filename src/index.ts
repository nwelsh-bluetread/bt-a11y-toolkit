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
  computeOverallScore,
  computeWcagRollup,
  computeCategoryScores,
  computeTopIssues,
  countBySeverity,
} from "./audit.js";
export type { AuditOptions } from "./audit.js";
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
