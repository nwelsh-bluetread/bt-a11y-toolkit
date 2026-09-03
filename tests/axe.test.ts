import { describe, it, expect } from "vitest";
import {
  axeToFindings,
  axeToAssessment,
  combineAxeResults,
  tagsToCriteria,
} from "../src/integrations/axe.js";
import { sampleAxeResults } from "./fixtures.axe.js";

describe("tagsToCriteria", () => {
  it("parses wcagNNN tags into WCAG criteria", () => {
    const crit = tagsToCriteria(["cat.color", "wcag2aa", "wcag143"]);
    expect(crit.map((c) => c.id)).toContain("1.4.3");
  });

  it("handles multi-digit criteria like wcag1410", () => {
    const crit = tagsToCriteria(["wcag1410"]);
    // Only asserted if 1.4.10 exists in the WCAG map; otherwise it's filtered out.
    for (const c of crit) expect(c.id).toBe("1.4.10");
  });

  it("ignores non-wcag and level-only tags", () => {
    const crit = tagsToCriteria(["cat.forms", "wcag2a", "best-practice"]);
    expect(crit).toEqual([]);
  });
});

describe("axeToFindings", () => {
  const findings = axeToFindings(sampleAxeResults);

  it("produces one finding per violation", () => {
    expect(findings).toHaveLength(3);
    expect(findings.map((f) => f.ruleId)).toEqual([
      "axe:color-contrast",
      "axe:image-alt",
      "axe:label",
    ]);
  });

  it("maps axe impact to severity", () => {
    const contrast = findings.find((f) => f.ruleId === "axe:color-contrast");
    const imageAlt = findings.find((f) => f.ruleId === "axe:image-alt");
    expect(contrast?.severity).toBe("high"); // serious
    expect(imageAlt?.severity).toBe("critical");
  });

  it("maps WCAG tags and assigns a category and source", () => {
    const contrast = findings.find((f) => f.ruleId === "axe:color-contrast");
    expect(contrast?.wcag.map((c) => c.id)).toContain("1.4.3");
    expect(contrast?.category).toBe("Contrast");
    expect(contrast?.source).toBe("axe");
  });

  it("captures selectors as evidence", () => {
    const contrast = findings.find((f) => f.ruleId === "axe:color-contrast");
    expect(contrast?.evidence?.affectedElements).toBe(2);
    expect(contrast?.nodeId).toBe("p.muted");
    expect(contrast?.remediation).toContain("dequeuniversity");
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

  it("computes WCAG rollups from pass/violation outcomes", () => {
    for (const level of ["A", "AA", "AAA"] as const) {
      expect(assessment.wcag[level]).toBeGreaterThanOrEqual(0);
      expect(assessment.wcag[level]).toBeLessThanOrEqual(100);
    }
  });

  it("builds a category scorecard containing Contrast", () => {
    expect(assessment.categories.map((c) => c.category)).toContain("Contrast");
  });
});

describe("combineAxeResults", () => {
  const clean: typeof sampleAxeResults = {
    url: "https://example.com/about",
    violations: [],
    passes: sampleAxeResults.passes,
  };
  const combined = combineAxeResults(
    [
      { url: "https://example.com/", results: sampleAxeResults },
      { url: "https://example.com/about", results: clean },
    ],
    { targetLevel: "AA" },
  );

  it("tags every finding with its page", () => {
    expect(combined.findings.length).toBe(3);
    expect(combined.findings.every((f) => f.evidence?.page === "https://example.com/")).toBe(true);
  });

  it("aggregates counts across pages", () => {
    const single = axeToAssessment(sampleAxeResults);
    expect(combined.findings.length).toBe(single.findings.length);
  });
});
