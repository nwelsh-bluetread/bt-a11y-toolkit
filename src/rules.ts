import type { A11yNode, Finding, Rule, RuleContext, RuleResult } from "./types.js";
import { wcag } from "./wcag.js";
import {
  hasAccessibleName,
  isHiddenFromAT,
  isImageNode,
  isInteractive,
} from "./utils.js";
import { contrastRatio, isLargeText, requiredContrast } from "./contrast.js";

/** Categories used for the scorecard rollup. */
export type RuleCategory =
  | "Semantics"
  | "Images/Icons"
  | "Touch Targets"
  | "Forms"
  | "Screen Reader"
  | "Contrast";

/** Helper to build a rule with a per-node predicate. */
interface NodeRuleConfig {
  id: string;
  title: string;
  description: string;
  severity: Rule["severity"];
  wcagIds: string[];
  category: RuleCategory;
  platforms?: Rule["platforms"];
  /** Return true when the node is subject to this rule. */
  applies(node: A11yNode, ctx: RuleContext): boolean;
  /** Return true when the node PASSES the rule. */
  passes(node: A11yNode, ctx: RuleContext): boolean;
  /** Build finding metadata for a failing node. */
  fail(node: A11yNode, ctx: RuleContext): { remediation: string; evidence?: Record<string, unknown> };
}

export interface CategorizedRule extends Rule {
  category: RuleCategory;
}

function defineNodeRule(config: NodeRuleConfig): CategorizedRule {
  return {
    id: config.id,
    title: config.title,
    description: config.description,
    severity: config.severity,
    category: config.category,
    wcag: wcag(...config.wcagIds),
    platforms: config.platforms,
    evaluate(nodes: A11yNode[], ctx: RuleContext): RuleResult {
      const findings: Finding[] = [];
      let evaluated = 0;
      let passed = 0;
      for (const node of nodes) {
        if (!config.applies(node, ctx)) continue;
        evaluated++;
        if (config.passes(node, ctx)) {
          passed++;
          continue;
        }
        const { remediation, evidence } = config.fail(node, ctx);
        findings.push({
          ruleId: config.id,
          title: config.title,
          description: config.description,
          severity: config.severity,
          wcag: wcag(...config.wcagIds),
          nodeId: node.id,
          nodeType: node.type,
          remediation,
          evidence,
          platforms: config.platforms,
        });
      }
      return { ruleId: config.id, findings, evaluated, passed };
    },
  };
}

/** 1. Interactive elements have an accessible name. */
export const accessibleNameRule = defineNodeRule({
  id: "interactive-accessible-name",
  title: "Interactive elements must have an accessible name",
  description:
    "Buttons, links, and other interactive controls must expose an accessible name so assistive technology can announce their purpose.",
  severity: "critical",
  category: "Semantics",
  wcagIds: ["4.1.2"],
  applies: (n) => isInteractive(n) && !isHiddenFromAT(n),
  passes: (n) => hasAccessibleName(n),
  fail: (n) => ({
    remediation: `Add an accessibilityLabel (React Native) or aria-label/visible text to this ${n.type}.`,
  }),
});

/** 2. Buttons have accessibilityRole="button". */
export const buttonRoleRule = defineNodeRule({
  id: "button-role",
  title: "Buttons must expose a button role",
  description:
    "Pressable controls that behave like buttons must expose accessibilityRole=\"button\" (RN) or role=\"button\" (web) so they are announced and operable as buttons.",
  severity: "high",
  category: "Semantics",
  wcagIds: ["4.1.2"],
  applies: (n) => isInteractive(n) && (n.type.toLowerCase() === "button" || n.props?.behavesAsButton === true),
  passes: (n) => (n.role ?? "").toLowerCase() === "button",
  fail: () => ({
    remediation: 'Set accessibilityRole="button" (React Native) or role="button" (web).',
  }),
});

/** 3. Images/icons have appropriate accessibility behavior. */
export const imageAccessibilityRule = defineNodeRule({
  id: "image-accessibility",
  title: "Images and icons need alt text or must be hidden",
  description:
    "Meaningful images must expose alternative text; decorative images must be hidden from assistive technology.",
  severity: "high",
  category: "Images/Icons",
  wcagIds: ["1.1.1"],
  applies: (n) => isImageNode(n),
  passes: (n) => {
    if (n.decorative) return isHiddenFromAT(n);
    return hasAccessibleName(n) || isHiddenFromAT(n);
  },
  fail: (n) =>
    n.decorative
      ? { remediation: "Hide decorative images from assistive technology (aria-hidden / importantForAccessibility=\"no-hide-descendants\")." }
      : { remediation: "Provide descriptive alt text via accessibilityLabel / alt, or mark the image decorative if it conveys no meaning." },
});

/** 4. Touch targets meet the minimum size (level-aware: 24px AA, 44px AAA). */
export const touchTargetRule: CategorizedRule = {
  id: "touch-target-size",
  title: "Touch targets must meet minimum size",
  description:
    "Interactive elements must be large enough to activate reliably (24x24 for WCAG AA 2.5.8, 44x44 for WCAG AAA 2.5.5).",
  severity: "medium",
  category: "Touch Targets",
  wcag: wcag("2.5.8"),
  evaluate(nodes, ctx): RuleResult {
    // 24px is the AA minimum (2.5.8); 44px is the AAA target (2.5.5). Honor an
    // explicit override, otherwise derive the threshold from the target level.
    const threshold = ctx.minTouchTargetSize;
    const criterion = threshold >= 44 ? "2.5.5" : "2.5.8";
    const findings: Finding[] = [];
    let evaluated = 0;
    let passed = 0;
    for (const node of nodes) {
      if (!isInteractive(node) || isHiddenFromAT(node) || !node.size) continue;
      evaluated++;
      if (node.size.width >= threshold && node.size.height >= threshold) {
        passed++;
        continue;
      }
      findings.push({
        ruleId: "touch-target-size",
        title: this.title,
        description: this.description,
        severity: "medium",
        wcag: wcag(criterion),
        nodeId: node.id,
        nodeType: node.type,
        remediation: `Increase the target to at least ${threshold}x${threshold} using minWidth/minHeight, padding, or hitSlop.`,
        evidence: { size: node.size, minimum: threshold, wcag: criterion },
      });
    }
    return { ruleId: "touch-target-size", findings, evaluated, passed };
  },
};

/** 5. Inputs have labels. */
export const inputLabelRule = defineNodeRule({
  id: "input-label",
  title: "Inputs must have labels",
  description: "Every form input must have a programmatically associated label.",
  severity: "critical",
  category: "Forms",
  wcagIds: ["3.3.2", "1.3.1"],
  applies: (n) => ["textinput", "input", "combobox", "switch", "checkbox", "radio", "slider"].includes(n.type.toLowerCase()),
  passes: (n) => hasAccessibleName(n),
  fail: (n) => ({
    remediation: `Associate a label with this ${n.type} (accessibilityLabel, <label htmlFor>, or aria-labelledby).`,
  }),
});

/** 6. Required fields expose their state. */
export const requiredStateRule = defineNodeRule({
  id: "required-state",
  title: "Required fields must expose required state",
  description: "Required inputs must communicate the required state to assistive technology.",
  severity: "medium",
  category: "Forms",
  wcagIds: ["3.3.2"],
  applies: (n) => n.props?.required === true,
  passes: (n) => n.props?.["aria-required"] === true || n.state?.checked !== undefined || n.props?.accessibilityRequired === true || Boolean(n.props?.exposesRequired),
  fail: () => ({
    remediation: 'Expose required state via aria-required="true" or an accessible "required" indication in the label.',
  }),
});

/** 7. Disabled controls expose disabled state. */
export const disabledStateRule = defineNodeRule({
  id: "disabled-state",
  title: "Disabled controls must expose disabled state",
  description: "Visually disabled controls must communicate the disabled state to assistive technology.",
  severity: "medium",
  category: "Forms",
  wcagIds: ["4.1.2"],
  applies: (n) => n.props?.visuallyDisabled === true || n.props?.disabled === true,
  passes: (n) => n.state?.disabled === true || n.props?.["aria-disabled"] === true,
  fail: () => ({
    remediation: 'Set accessibilityState={{ disabled: true }} (RN) or aria-disabled="true" (web).',
  }),
});

/** 8. Selected controls expose selected state. */
export const selectedStateRule = defineNodeRule({
  id: "selected-state",
  title: "Selected controls must expose selected state",
  description: "Controls in a selected state (tabs, list items, chips) must communicate it to assistive technology.",
  severity: "medium",
  category: "Screen Reader",
  wcagIds: ["4.1.2"],
  applies: (n) => n.props?.visuallySelected === true,
  passes: (n) => n.state?.selected === true || n.props?.["aria-selected"] === true,
  fail: () => ({
    remediation: 'Set accessibilityState={{ selected: true }} (RN) or aria-selected="true" (web).',
  }),
});

/** 9. Expandable controls expose expanded state. */
export const expandedStateRule = defineNodeRule({
  id: "expanded-state",
  title: "Expandable controls must expose expanded state",
  description: "Controls that expand/collapse content (accordions, disclosures) must expose the expanded state.",
  severity: "medium",
  category: "Screen Reader",
  wcagIds: ["4.1.2"],
  applies: (n) => n.props?.expandable === true,
  passes: (n) => typeof n.state?.expanded === "boolean" || n.props?.["aria-expanded"] !== undefined,
  fail: () => ({
    remediation: 'Set accessibilityState={{ expanded }} (RN) or aria-expanded (web) reflecting the current state.',
  }),
});

/** 10. Important status changes are announced. */
export const statusAnnouncementRule = defineNodeRule({
  id: "status-announcement",
  title: "Status changes must be announced",
  description: "Important status messages must be exposed as live regions so they are announced without moving focus.",
  severity: "high",
  category: "Screen Reader",
  wcagIds: ["4.1.3"],
  applies: (n) => n.props?.isStatusMessage === true,
  passes: (n) =>
    n.liveRegion === "polite" ||
    n.liveRegion === "assertive" ||
    n.liveRegion === true ||
    (n.role ?? "").toLowerCase() === "alert" ||
    (n.role ?? "").toLowerCase() === "status",
  fail: () => ({
    remediation: 'Mark the container as a live region (accessibilityLiveRegion="polite" / role="status" / aria-live="polite").',
  }),
});

/** 11. Decorative elements are hidden from accessibility. */
export const decorativeHiddenRule = defineNodeRule({
  id: "decorative-hidden",
  title: "Decorative elements must be hidden from assistive technology",
  description: "Purely decorative elements must not be exposed to assistive technology.",
  severity: "low",
  category: "Images/Icons",
  wcagIds: ["1.1.1"],
  applies: (n) => n.decorative === true,
  passes: (n) => isHiddenFromAT(n),
  fail: () => ({
    remediation: 'Hide decorative elements (aria-hidden="true" / importantForAccessibility="no-hide-descendants").',
  }),
});

/** 12. Custom components correctly pass accessibility props. */
export const customPropsRule = defineNodeRule({
  id: "custom-component-props",
  title: "Custom components must forward accessibility props",
  description:
    "Custom interactive components must forward accessibility props (role, label, state) to their underlying element.",
  severity: "high",
  category: "Semantics",
  wcagIds: ["4.1.2"],
  applies: (n) => n.props?.isCustomComponent === true && isInteractive(n),
  passes: (n) => Boolean(n.role) && hasAccessibleName(n),
  fail: () => ({
    remediation: "Forward accessibilityRole/accessibilityLabel (or role/aria-label) from the custom component to its pressable root.",
  }),
});

/** Bonus: text contrast meets the target level. */
export const contrastRule: CategorizedRule = {
  id: "text-contrast",
  title: "Text must meet minimum contrast",
  description: "Text color must contrast sufficiently with its background for the target WCAG level.",
  severity: "high",
  category: "Contrast",
  wcag: wcag("1.4.3"),
  evaluate(nodes, ctx): RuleResult {
    const findings: Finding[] = [];
    let evaluated = 0;
    let passed = 0;
    for (const node of nodes) {
      const fg = node.colors?.foreground;
      const bg = node.colors?.background;
      if (!node.text || !fg || !bg) continue;
      const ratio = contrastRatio(fg, bg);
      if (ratio == null) continue;
      evaluated++;
      const large = isLargeText(node.colors?.fontSize, node.colors?.bold);
      const level = ctx.targetLevel === "AAA" ? "AAA" : "AA";
      const required = requiredContrast(level, large);
      if (ratio >= required) {
        passed++;
        continue;
      }
      findings.push({
        ruleId: "text-contrast",
        title: "Insufficient text contrast",
        description: this.description,
        severity: "high",
        wcag: wcag(level === "AAA" ? "1.4.6" : "1.4.3"),
        nodeId: node.id,
        nodeType: node.type,
        remediation: `Increase contrast to at least ${required}:1 (current ${ratio.toFixed(2)}:1).`,
        evidence: { foreground: fg, background: bg, ratio: Number(ratio.toFixed(2)), required },
      });
    }
    return { ruleId: "text-contrast", findings, evaluated, passed };
  },
};

/** The default, ordered set of baseline rules that every audit runs. */
export const defaultRules: CategorizedRule[] = [
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
];
