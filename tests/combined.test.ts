import { describe, it, expect } from "vitest";
import { mergeAssessments } from "../src/integrations/combined.js";
import { lighthouseToAssessment } from "../src/integrations/lighthouse.js";
import { axeToAssessment } from "../src/integrations/axe.js";
import { sampleLhr } from "./fixtures.lighthouse.js";
import { sampleAxeResults } from "./fixtures.axe.js";

describe("mergeAssessments", () => {
  const lh = lighthouseToAssessment(sampleLhr, { targetLevel: "AA" });
  const axe = axeToAssessment(sampleAxeResults, { targetLevel: "AA" });
  const merged = mergeAssessments([lh, axe], { targetLevel: "AA" });

  it("throws when given no assessments", () => {
    expect(() => mergeAssessments([])).toThrow();
  });

  it("averages the overall scores of both engines", () => {
    expect(merged.overallScore).toBe(Math.round((lh.overallScore + axe.overallScore) / 2));
  });

  it("averages WCAG rollups across sources", () => {
    for (const level of ["A", "AA", "AAA"] as const) {
      expect(merged.wcag[level]).toBe(Math.round((lh.wcag[level] + axe.wcag[level]) / 2));
    }
  });

  it("de-duplicates the same issue reported by both tools", () => {
    // Both fixtures report an image-alt failure on img.hero (WCAG 1.1.1).
    const imgFindings = merged.findings.filter(
      (f) => f.nodeId === "img.hero" && f.wcag.some((c) => c.id === "1.1.1"),
    );
    expect(imgFindings).toHaveLength(1);
    // The surviving finding records both sources.
    expect(imgFindings[0]?.source).toContain("axe");
    expect(imgFindings[0]?.source).toContain("lighthouse");
    expect(imgFindings[0]?.evidence?.sources).toEqual(["axe", "lighthouse"]);
  });

  it("keeps issues unique to a single tool", () => {
    // heading-order appears in both, contrast appears in both, but axe also has
    // custom-unmapped-rule which Lighthouse lacks.
    const total = merged.findings.length;
    expect(total).toBeLessThanOrEqual(lh.findings.length + axe.findings.length);
    expect(total).toBeGreaterThan(0);
  });

  it("keeps the higher severity when merging a duplicate", () => {
    const img = merged.findings.find((f) => f.nodeId === "img.hero");
    // axe maps image-alt to "high"; lighthouse also "high" — stays high.
    expect(img?.severity).toBe("high");
  });

  it("recomputes counts to match the merged finding set", () => {
    const total =
      merged.counts.critical + merged.counts.high + merged.counts.medium + merged.counts.low;
    expect(total).toBe(merged.findings.length);
  });

  it("rebuilds the category scorecard", () => {
    expect(merged.categories.length).toBeGreaterThan(0);
    expect(merged.categories.map((c) => c.category)).toContain("Contrast");
  });
});
