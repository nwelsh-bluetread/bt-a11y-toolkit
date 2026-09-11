import { describe, it, expect } from "vitest";
import {
  axeToFindings,
  axeToAssessment,
  combineAxeResults,
  wcagIdsFromTags,
  AXE_RULE_MAP,
  type AxeResults,
} from "../src/integrations/axe.js";
import { sampleAxeResults } from "./fixtures.axe.js";

describe("wcagIdsFromTags", () => {
  it("decodes axe wcag tags into criterion ids", () => {
    expect(wcagIdsFromTags(["cat.color", "wcag2aa", "wcag143"])).toEqual(["1.4.3"]);
    expect(wcagIdsFromTags(["wcag111"])).toEqual(["1.1.1"]);
    expect(wcagIdsFromTags(["wcag412", "wcag332"])).toEqual(["4.1.2", "3.3.2"]);
  });

  it("handles multi-digit sub-criteria", () => {
    expect(wcagIdsFromTags(["wcag1412"])).toEqual(["1.4.12"]);
  });

  it("ignores non-wcag tags", () => {
    expect(wcagIdsFromTags(["cat.semantics", "best-practice"])).toEqual([]);
  });
});

describe("axeToFindings", () => {
  const findings = axeToFindings(sampleAxeResults);

  it("produces a finding for each violation only", () => {
    const ids = findings.map((f) => f.ruleId);
    expect(ids).toContain("axe:color-contrast");
    expect(ids).toContain("axe:image-alt");
    expect(ids).toContain("axe:heading-order");
    // passing rules are excluded
    expect(ids).not.toContain("axe:button-name");
    expect(ids).not.toContain("axe:label");
    // inapplicable rules are excluded
    expect(ids).not.toContain("axe:video-caption");
  });

  it("maps severity and WCAG criteria from the explicit rule map", () => {
    const contrast = findings.find((f) => f.ruleId === "axe:color-contrast");
    expect(contrast?.severity).toBe("high");
    expect(contrast?.wcag.map((c) => c.id)).toContain("1.4.3");
    expect(contrast?.category).toBe("Contrast");
    expect(contrast?.source).toBe("axe");
  });

  it("falls back to tags/impact for unmapped rules", () => {
    const custom = findings.find((f) => f.ruleId === "axe:custom-unmapped-rule");
    expect(custom).toBeDefined();
    // impact "minor" -> severity "low"
    expect(custom?.severity).toBe("low");
    // derived from wcag248 tag
    expect(custom?.evidence?.ruleId).toBe("custom-unmapped-rule");
  });

  it("captures affected element selectors as evidence", () => {
    const contrast = findings.find((f) => f.ruleId === "axe:color-contrast");
    expect(contrast?.evidence?.affectedElements).toBe(2);
    expect(contrast?.nodeId).toBe("p.muted");
    expect(contrast?.evidence?.impact).toBe("serious");
  });

  it("flattens nested (iframe) selectors", () => {
    const custom = findings.find((f) => f.ruleId === "axe:custom-unmapped-rule");
    expect(custom?.nodeId).toBe("#frame div.section");
  });

  it("carries the help url as remediation", () => {
    const img = findings.find((f) => f.ruleId === "axe:image-alt");
    expect(img?.remediation).toContain("dequeuniversity.com");
  });
});

describe("axeToAssessment", () => {
  const assessment = axeToAssessment(sampleAxeResults, { targetLevel: "AA" });

  it("counts findings by severity", () => {
    const total =
      assessment.counts.critical +
      assessment.counts.high +
      assessment.counts.medium +
      assessment.counts.low;
    expect(total).toBe(assessment.findings.length);
  });

  it("computes WCAG rollups from violations vs passes", () => {
    for (const level of ["A", "AA", "AAA"] as const) {
      expect(assessment.wcag[level]).toBeGreaterThanOrEqual(0);
      expect(assessment.wcag[level]).toBeLessThanOrEqual(100);
    }
  });

  it("builds a category scorecard", () => {
    expect(assessment.categories.length).toBeGreaterThan(0);
    expect(assessment.categories.map((c) => c.category)).toContain("Contrast");
  });

  it("produces a 0-100 overall score", () => {
    expect(assessment.overallScore).toBeGreaterThanOrEqual(0);
    expect(assessment.overallScore).toBeLessThanOrEqual(100);
  });
});

describe("combineAxeResults", () => {
  // A second "page" derived from the sample with no violations.
  const cleanResults: AxeResults = JSON.parse(JSON.stringify(sampleAxeResults));
  cleanResults.violations = [];

  const pages = [
    { url: "https://example.com/", results: sampleAxeResults },
    { url: "https://example.com/about", results: cleanResults },
  ];
  const combined = combineAxeResults(pages, { targetLevel: "AA" });

  it("tags every finding with the page it came from", () => {
    expect(combined.findings.length).toBeGreaterThan(0);
    for (const f of combined.findings) {
      expect(f.evidence?.page).toBeDefined();
    }
    // all findings should come from the failing page
    expect(combined.findings.every((f) => f.evidence?.page === "https://example.com/")).toBe(true);
  });

  it("aggregates findings across all pages", () => {
    const single = axeToAssessment(sampleAxeResults, { targetLevel: "AA" });
    expect(combined.findings.length).toBe(single.findings.length);
  });

  it("produces valid WCAG rollups", () => {
    for (const level of ["A", "AA", "AAA"] as const) {
      expect(combined.wcag[level]).toBeGreaterThanOrEqual(0);
      expect(combined.wcag[level]).toBeLessThanOrEqual(100);
    }
  });
});

describe("AXE_RULE_MAP", () => {
  it("maps critical name/role rules to critical severity", () => {
    expect(AXE_RULE_MAP["button-name"]?.severity).toBe("critical");
    expect(AXE_RULE_MAP["link-name"]?.severity).toBe("critical");
  });
});
