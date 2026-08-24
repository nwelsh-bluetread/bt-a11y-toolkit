/**
 * Core type definitions for the BlueTread Accessibility Toolkit.
 *
 * The toolkit operates on a platform-agnostic {@link A11yNode} abstraction so the
 * same rules can evaluate React Native element trees and (serialized) web DOM
 * trees. Adapters are responsible for converting a platform-specific tree into
 * `A11yNode`s.
 */

/** Priority / severity classification used throughout the assessment. */
export type Severity = "critical" | "high" | "medium" | "low";

/** Target WCAG conformance levels. */
export type WcagLevel = "A" | "AA" | "AAA";

/** Platforms an audit can target. */
export type Platform = "web" | "ios" | "android" | "react-native";

/**
 * A platform-agnostic representation of a single UI node.
 *
 * Both React Native accessibility props and ARIA/HTML attributes are normalized
 * onto this shape by the relevant adapter.
 */
export interface A11yNode {
  /** Stable identifier used in findings (testID, DOM id, or generated path). */
  id?: string;
  /**
   * The conceptual element type, normalized across platforms.
   * e.g. "button", "image", "text", "textinput", "view", "link", "header".
   */
  type: string;
  /**
   * Accessibility role. Maps to RN `accessibilityRole` or ARIA `role`.
   */
  role?: string;
  /** Accessible name (RN `accessibilityLabel`, ARIA label, or visible text). */
  accessibleName?: string;
  /** Accessibility hint (RN `accessibilityHint` / `aria-describedby` text). */
  accessibilityHint?: string;
  /** RN `accessible` flag. */
  accessible?: boolean;
  /**
   * Whether the element is exposed to assistive technology.
   * Maps to RN `importantForAccessibility` / `aria-hidden`.
   */
  hiddenFromAT?: boolean;
  /** Whether the element is interactive (pressable, focusable, input, link). */
  interactive?: boolean;
  /** Whether the element is purely decorative. */
  decorative?: boolean;
  /** Whether the element is a live region announcing changes. */
  liveRegion?: "off" | "polite" | "assertive" | boolean;
  /** Accessibility state flags (RN `accessibilityState` / ARIA states). */
  state?: {
    disabled?: boolean;
    selected?: boolean;
    checked?: boolean | "mixed";
    busy?: boolean;
    expanded?: boolean;
  };
  /** Accessibility value (RN `accessibilityValue`). */
  value?: {
    min?: number;
    max?: number;
    now?: number;
    text?: string;
  };
  /** Text content, when the node renders text. */
  text?: string;
  /** Rendered size in density-independent pixels, when known. */
  size?: { width: number; height: number };
  /** Foreground / background colors for contrast checks (hex strings). */
  colors?: { foreground?: string; background?: string; fontSize?: number; bold?: boolean };
  /** Child nodes. */
  children?: A11yNode[];
  /** Escape hatch for platform-specific props a rule may need. */
  props?: Record<string, unknown>;
}

/** A WCAG success criterion reference. */
export interface WcagCriterion {
  /** e.g. "1.1.1" */
  id: string;
  /** e.g. "Non-text Content" */
  name: string;
  level: WcagLevel;
}

/** A single accessibility issue produced by a rule. */
export interface Finding {
  /** The rule that produced this finding. */
  ruleId: string;
  /** Short human-readable summary. */
  title: string;
  /** Detailed description of the problem. */
  description: string;
  severity: Severity;
  /** WCAG success criteria this finding maps to. */
  wcag: WcagCriterion[];
  /** Identifier of the offending node, if applicable. */
  nodeId?: string;
  /** The element type of the offending node. */
  nodeType?: string;
  /** Suggested remediation guidance. */
  remediation?: string;
  /** Optional evidence (serialized props, screenshot path, etc.). */
  evidence?: Record<string, unknown>;
  /** Platforms this finding applies to. */
  platforms?: Platform[];
  /** Scorecard category this finding rolls up into. */
  category?: string;
  /** Origin of the finding, e.g. "toolkit", "lighthouse", "axe", "wave". */
  source?: string;
}

/** The outcome of evaluating a single rule against a node tree. */
export interface RuleResult {
  ruleId: string;
  findings: Finding[];
  /** Number of nodes the rule inspected (for pass-rate metrics). */
  evaluated: number;
  /** Number of nodes that passed the rule. */
  passed: number;
}

/**
 * A reusable, automated accessibility rule.
 *
 * Rules are pure functions over the node tree so they are trivially testable and
 * can run in CI without a device or browser.
 */
export interface Rule {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  wcag: WcagCriterion[];
  /** Platforms this rule is relevant to. Defaults to all. */
  platforms?: Platform[];
  /** Evaluate the rule against a flattened list of nodes. */
  evaluate(nodes: A11yNode[], context: RuleContext): RuleResult;
}

/** Shared options/configuration passed to rules at evaluation time. */
export interface RuleContext {
  platform: Platform;
  /** Minimum touch-target size in dp/px. 24 for AA (2.5.8), 44 for AAA (2.5.5). */
  minTouchTargetSize: number;
  /** Target WCAG conformance level. Defaults to "AA". */
  targetLevel: WcagLevel;
}

/** A per-category rollup used in the scorecard. */
export interface CategoryScore {
  category: string;
  score: number; // 0-100
  severity: Severity;
  findingCount: number;
}

/** The complete assessment produced by the report generator. */
export interface Assessment {
  /** ISO timestamp of when the assessment ran. */
  generatedAt: string;
  platform: Platform;
  targetLevel: WcagLevel;
  overallScore: number; // 0-100
  counts: Record<Severity, number>;
  wcag: Record<WcagLevel, number>; // percentage passing per level
  categories: CategoryScore[];
  topIssues: string[];
  findings: Finding[];
}
