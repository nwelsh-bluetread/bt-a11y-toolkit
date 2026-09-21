import { describe, it, expect } from "vitest";
import {
  manualToFindings,
  manualFindingsToAssessment,
  type ManualFinding,
} from "../src/integrations/manual.js";
import { mergeAssessments } from "../src/integrations/combined.js";
import { axeToAssessment } from "../src/integrations/axe.js";
import { formatMarkdown } from "../src/report.js";

const entries: ManualFinding[] = [
  {
    title: "Focus order skips the form",
    description: "VoiceOver jumps past the address fields.",
    severity: "critical",
    wcag: ["1.3.2", "2.4.3"],
    category: "Screen Reader",
    page: "https://app.test/checkout",
    method: "VoiceOver",
    location: "Checkout > Shipping",
    remediation: "Fix the accessibility order.",
    estimatedHours: 3,
    platforms: ["ios"],
  },
  {
    title: "Dropdown not keyboard operable",
    description: "Cannot open the country selector with the keyboard.",
    severity: "high",
    wcag: ["2.1.1"],
    category: "Keyboard",
    page: "https://app.test/signup",
    method: "Keyboard",
  },
];

describe("manualToFindings", () => {
  it("expands wcag ids, tags source=manual, and carries evidence", () => {
    const findings = manualToFindings(entries, { platform: "web" });
    expect(findings).toHaveLength(2);
    const [first] = findings;
    expect(first?.source).toBe("manual");
    expect(first?.wcag.map((c) => c.id)).toEqual(["1.3.2", "2.4.3"]);
    expect(first?.evidence?.page).toBe("https://app.test/checkout");
    expect(first?.evidence?.method).toBe("VoiceOver");
    expect(first?.ruleId.startsWith("manual:")).toBe(true);
  });

  it("uses the explicit estimate when given, else estimates", () => {
    const [withEstimate, withoutEstimate] = manualToFindings(entries);
    expect(withEstimate?.estimatedHours).toBe(3);
    expect(withoutEstimate?.estimatedHours).toBeGreaterThan(0);
  });

  it("defaults platforms to the option when not provided", () => {
    const [, second] = manualToFindings(entries, { platform: "android" });
    expect(second?.platforms).toEqual(["android"]);
  });

  it("drops unknown wcag ids", () => {
    const [f] = manualToFindings([
      { title: "x", description: "y", severity: "low", wcag: ["9.9.9"] },
    ]);
    expect(f?.wcag).toEqual([]);
  });
});

describe("manualFindingsToAssessment", () => {
  it("produces an assessment with counts, categories, and pages", () => {
    const a = manualFindingsToAssessment(entries, { platform: "web", targetLevel: "AA" });
    expect(a.counts.critical).toBe(1);
    expect(a.counts.high).toBe(1);
    expect(a.categories.map((c) => c.category).sort()).toEqual(["Keyboard", "Screen Reader"]);
    expect(a.pages).toContain("https://app.test/checkout");
    expect(a.pages).toContain("https://app.test/signup");
    expect(a.findings.every((f) => f.source === "manual")).toBe(true);
  });

  it("deducts from the WCAG rollup for failing levels", () => {
    const a = manualFindingsToAssessment(entries);
    // Both findings map to level A criteria, so A is deducted the most.
    expect(a.wcag.A).toBeLessThan(100);
  });
});

describe("merging manual with automated", () => {
  it("folds manual findings into a combined report", () => {
    const manual = manualFindingsToAssessment(entries, { platform: "web" });
    const axe = axeToAssessment({
      url: "https://app.test/checkout",
      violations: [],
      passes: [],
    });
    const combined = mergeAssessments([axe, manual], { targetLevel: "AA" });
    expect(combined.findings.some((f) => f.source === "manual")).toBe(true);
    const md = formatMarkdown(combined);
    expect(md).toContain("## Pages Scanned");
    expect(md).toContain("Focus order skips the form");
  });
});
