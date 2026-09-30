import { describe, it, expect } from "vitest";
import {
  accessibleNameRule,
  buttonRoleRule,
  imageAccessibilityRule,
  touchTargetRule,
  inputLabelRule,
  contrastRule,
} from "../src/rules.js";
import { flatten } from "../src/utils.js";
import type { A11yNode, RuleContext } from "../src/types.js";
import { sampleTree } from "./fixtures.js";

const ctx: RuleContext = { platform: "web", targetLevel: "AA", minTouchTargetSize: 44 };
const nodes = flatten(sampleTree);

describe("accessibleNameRule", () => {
  it("flags interactive elements without an accessible name", () => {
    const result = accessibleNameRule.evaluate(nodes, ctx);
    expect(result.findings.map((f) => f.nodeId)).toContain("btn-bad");
    expect(result.findings.map((f) => f.nodeId)).not.toContain("btn-good");
  });
});

describe("buttonRoleRule", () => {
  it("flags buttons missing a button role", () => {
    const result = buttonRoleRule.evaluate(nodes, ctx);
    expect(result.findings.map((f) => f.nodeId)).toEqual(["btn-bad"]);
  });

  /**
   * The case the rule previously could not see: on React Native a
   * `TouchableOpacity` with an `onPress` and no `accessibilityRole` serializes
   * as an interactive node of type "view", never type "button".
   */
  it("flags a pressable view with no role", () => {
    const tree: A11yNode = {
      type: "view",
      id: "row",
      interactive: true,
      accessibleName: "Privacy policy",
    };
    const result = buttonRoleRule.evaluate(flatten(tree), ctx);
    expect(result.findings.map((f) => f.nodeId)).toEqual(["row"]);
  });

  it("accepts any control role, not just button", () => {
    const tree: A11yNode = {
      type: "view",
      children: [
        { type: "view", id: "as-link", interactive: true, role: "link", accessibleName: "Terms" },
        { type: "view", id: "as-tab", interactive: true, role: "tab", accessibleName: "Orders" },
      ],
    };
    expect(buttonRoleRule.evaluate(flatten(tree), ctx).findings).toEqual([]);
  });

  it("does not tell self-describing controls to be buttons", () => {
    const tree: A11yNode = {
      type: "view",
      children: [
        { type: "textinput", id: "field", interactive: true, accessibleName: "Email" },
        { type: "slider", id: "volume", interactive: true, accessibleName: "Volume" },
      ],
    };
    expect(buttonRoleRule.evaluate(flatten(tree), ctx).findings).toEqual([]);
  });

  it("skips pressables hidden from assistive technology", () => {
    const tree: A11yNode = { type: "view", id: "ghost", interactive: true, hiddenFromAT: true };
    expect(buttonRoleRule.evaluate(flatten(tree), ctx).findings).toEqual([]);
  });
});

describe("imageAccessibilityRule", () => {
  it("flags meaningful images without alt and decorative images not hidden", () => {
    const result = imageAccessibilityRule.evaluate(nodes, ctx);
    const ids = result.findings.map((f) => f.nodeId);
    expect(ids).toContain("img-bad");
    expect(ids).toContain("img-decorative");
  });
});

describe("touchTargetRule", () => {
  it("flags targets smaller than the minimum", () => {
    const result = touchTargetRule.evaluate(nodes, ctx);
    expect(result.findings.map((f) => f.nodeId)).toEqual(["btn-bad"]);
  });

  it("respects a custom minimum size", () => {
    const strict = touchTargetRule.evaluate(nodes, { ...ctx, minTouchTargetSize: 60 });
    expect(strict.findings.map((f) => f.nodeId)).toContain("btn-good");
  });

  it("maps to WCAG 2.5.8 (AA) at the 24px threshold", () => {
    const aa = touchTargetRule.evaluate(nodes, { ...ctx, minTouchTargetSize: 24 });
    const finding = aa.findings.find((f) => f.nodeId === "btn-bad");
    expect(finding?.wcag.map((c) => c.id)).toEqual(["2.5.8"]);
  });

  it("maps to WCAG 2.5.5 (AAA) at the 44px threshold", () => {
    const aaa = touchTargetRule.evaluate(nodes, { ...ctx, minTouchTargetSize: 44 });
    const finding = aaa.findings.find((f) => f.nodeId === "btn-bad");
    expect(finding?.wcag.map((c) => c.id)).toEqual(["2.5.5"]);
  });

  // "Targets are reliably tappable" — verify the rule measures the *actual*
  // rendered size and reports it, so a reviewer can see exactly how far short a
  // control falls rather than just that it failed.
  it("records the actual measured size and the minimum it was checked against", () => {
    const result = touchTargetRule.evaluate(nodes, { ...ctx, minTouchTargetSize: 44 });
    const finding = result.findings.find((f) => f.nodeId === "btn-bad");
    // btn-bad is 20x20 in the fixture; the AAA threshold is 44.
    expect(finding?.evidence?.size).toEqual({ width: 20, height: 20 });
    expect(finding?.evidence?.minimum).toBe(44);
    expect(finding?.remediation).toContain("44x44");
  });

  it("passes a target exactly at the threshold (inclusive boundary)", () => {
    const tree: A11yNode = {
      type: "view",
      children: [
        { type: "button", id: "exact", interactive: true, accessibleName: "OK", size: { width: 24, height: 24 } },
      ],
    };
    const result = touchTargetRule.evaluate(flatten(tree), { ...ctx, minTouchTargetSize: 24 });
    expect(result.findings).toEqual([]);
    expect(result.passed).toBe(1);
  });

  it("fails a target one pixel under the threshold", () => {
    const tree: A11yNode = {
      type: "view",
      children: [
        { type: "button", id: "under", interactive: true, accessibleName: "OK", size: { width: 23, height: 24 } },
      ],
    };
    const result = touchTargetRule.evaluate(flatten(tree), { ...ctx, minTouchTargetSize: 24 });
    expect(result.findings.map((f) => f.nodeId)).toEqual(["under"]);
  });

  // A wide-but-short (or tall-but-narrow) control is a common real-world miss:
  // both dimensions must meet the minimum, not just one.
  it("fails when only one dimension is large enough", () => {
    const tree: A11yNode = {
      type: "view",
      children: [
        { type: "button", id: "wide", interactive: true, accessibleName: "A", size: { width: 200, height: 18 } },
        { type: "button", id: "tall", interactive: true, accessibleName: "B", size: { width: 18, height: 200 } },
      ],
    };
    const result = touchTargetRule.evaluate(flatten(tree), { ...ctx, minTouchTargetSize: 24 });
    expect(result.findings.map((f) => f.nodeId).sort()).toEqual(["tall", "wide"]);
  });

  // "Adjacent controls don't misfire" — closely-spaced small controls are the
  // classic mis-tap hazard. Each undersized control is flagged independently so
  // a cluster of tiny adjacent buttons doesn't collapse into a single finding.
  it("flags every undersized control in a closely-spaced cluster", () => {
    const tree: A11yNode = {
      type: "view",
      id: "toolbar",
      children: [
        { type: "button", id: "bold", interactive: true, accessibleName: "Bold", size: { width: 18, height: 18 } },
        { type: "button", id: "italic", interactive: true, accessibleName: "Italic", size: { width: 18, height: 18 } },
        { type: "button", id: "underline", interactive: true, accessibleName: "Underline", size: { width: 18, height: 18 } },
      ],
    };
    const result = touchTargetRule.evaluate(flatten(tree), { ...ctx, minTouchTargetSize: 24 });
    expect(result.findings.map((f) => f.nodeId).sort()).toEqual(["bold", "italic", "underline"]);
    expect(result.evaluated).toBe(3);
    expect(result.passed).toBe(0);
  });

  it("does not measure non-interactive or hidden elements", () => {
    const tree: A11yNode = {
      type: "view",
      children: [
        { type: "text", id: "label", size: { width: 10, height: 10 } },
        { type: "button", id: "hidden", interactive: true, hiddenFromAT: true, size: { width: 10, height: 10 } },
      ],
    };
    const result = touchTargetRule.evaluate(flatten(tree), { ...ctx, minTouchTargetSize: 24 });
    expect(result.findings).toEqual([]);
    expect(result.evaluated).toBe(0);
  });
});

describe("inputLabelRule", () => {
  it("flags inputs without labels", () => {
    const result = inputLabelRule.evaluate(nodes, ctx);
    expect(result.findings.map((f) => f.nodeId)).toEqual(["input-bad"]);
  });
});

describe("contrastRule", () => {
  it("flags low-contrast text only", () => {
    const result = contrastRule.evaluate(nodes, ctx);
    expect(result.findings.map((f) => f.nodeId)).toEqual(["text-low"]);
  });
});
