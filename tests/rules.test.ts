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
import type { RuleContext } from "../src/types.js";
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
