import { describe, it, expect } from "vitest";
import {
  pa11yToFindings,
  pa11yToAssessment,
  combinePa11yResults,
  parseHtmlcsCode,
  resolveIssueMapping,
  type Pa11yResults,
} from "../src/integrations/pa11y.js";
import { samplePa11yResults } from "./fixtures.pa11y.js";

describe("parseHtmlcsCode", () => {
  it("extracts the WCAG criterion and level from an HTML_CodeSniffer code", () => {
    expect(parseHtmlcsCode("WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail")).toEqual({
      wcag: "1.4.3",
      level: "AA",
    });
    expect(parseHtmlcsCode("WCAG2A.Principle1.Guideline1_1.1_1_1.H37")).toEqual({
      wcag: "1.1.1",
      level: "A",
    });
    expect(parseHtmlcsCode("WCAG2AAA.Principle1.Guideline1_4.1_4_6.G17")).toEqual({
      wcag: "1.4.6",
      level: "AAA",
    });
  });

  it("returns undefined fields for non-htmlcs codes", () => {
    expect(parseHtmlcsCode("color-contrast")).toEqual({ wcag: undefined, level: undefined });
  });
});

describe("resolveIssueMapping", () => {
  it("resolves axe-runner codes through the shared axe rule map", () => {
    const mapping = resolveIssueMapping({
      code: "link-name",
      type: "error",
      message: "Links must have discernible text",
    });
    expect(mapping.severity).toBe("critical");
    expect(mapping.category).toBe("Semantics");
    expect(mapping.wcag).toContain("4.1.2");
  });

  it("caps softer issue types below the mapped rule severity", () => {
    const mapping = resolveIssueMapping({
      code: "link-name",
      type: "notice",
      message: "Links must have discernible text",
    });
    expect(mapping.severity).toBe("low");
  });

  it("derives category and level from HTML_CodeSniffer codes", () => {
    const mapping = resolveIssueMapping({
      code: "WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail",
      type: "error",
      message: "insufficient contrast",
    });
    expect(mapping.category).toBe("Contrast");
    expect(mapping.wcag).toEqual(["1.4.3"]);
    expect(mapping.level).toBe("AA");
    expect(mapping.severity).toBe("high");
  });
});

describe("pa11yToFindings", () => {
  const findings = pa11yToFindings(samplePa11yResults);

  it("produces a finding for every issue", () => {
    expect(findings).toHaveLength(samplePa11yResults.issues.length);
    expect(findings.every((f) => f.source === "pa11y")).toBe(true);
  });

  it("prefixes rule ids with the pa11y source and preserves the code", () => {
    const contrast = findings.find((f) => f.ruleId.includes("1_4_3"));
    expect(contrast?.ruleId).toBe("pa11y:WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail");
    expect(contrast?.evidence?.code).toBe("WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail");
    expect(contrast?.category).toBe("Contrast");
    expect(contrast?.wcag.map((c) => c.id)).toContain("1.4.3");
  });

  it("captures the selector and HTML snippet as evidence", () => {
    const img = findings.find((f) => f.ruleId.includes("1_1_1"));
    expect(img?.nodeId).toBe("html > body > img.hero");
    expect(img?.evidence?.html).toContain("hero.png");
    expect(img?.evidence?.runner).toBe("htmlcs");
  });

  it("maps warnings and notices to softer severities", () => {
    const warning = findings.find((f) => f.ruleId.includes("2_4_6"));
    const notice = findings.find((f) => f.ruleId.includes("1_3_1"));
    expect(warning?.severity).toBe("medium");
    expect(notice?.severity).toBe("low");
  });

  it("resolves axe-runner issues through the axe rule map", () => {
    const link = findings.find((f) => f.ruleId === "pa11y:link-name");
    expect(link?.severity).toBe("critical");
    expect(link?.evidence?.runner).toBe("axe");
  });
});

describe("pa11yToAssessment", () => {
  const assessment = pa11yToAssessment(samplePa11yResults, { targetLevel: "AA" });

  it("summarises counts and findings", () => {
    expect(assessment.findings).toHaveLength(samplePa11yResults.issues.length);
    expect(assessment.platform).toBe("web");
    expect(assessment.targetLevel).toBe("AA");
    expect(assessment.counts.critical).toBeGreaterThan(0);
  });

  it("penalises WCAG rollups by level, cascading to stricter levels", () => {
    // A-level failures (alt text, button name) drag every level down.
    expect(assessment.wcag.A).toBeLessThan(100);
    expect(assessment.wcag.AA).toBeLessThanOrEqual(assessment.wcag.A);
    expect(assessment.wcag.AAA).toBeLessThanOrEqual(assessment.wcag.AA);
  });

  it("builds categories sorted by score", () => {
    expect(assessment.categories.length).toBeGreaterThan(0);
    const scores = assessment.categories.map((c) => c.score);
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
  });
});

describe("combinePa11yResults", () => {
  it("tags findings with their page and aggregates across pages", () => {
    const pageB: Pa11yResults = {
      url: "https://example.com/about",
      issues: [samplePa11yResults.issues[0]!],
    };
    const assessment = combinePa11yResults([
      { url: "https://example.com/", results: samplePa11yResults },
      { url: "https://example.com/about", results: pageB },
    ]);
    expect(assessment.findings).toHaveLength(samplePa11yResults.issues.length + 1);
    const pages = new Set(assessment.findings.map((f) => f.evidence?.page));
    expect(pages).toContain("https://example.com/");
    expect(pages).toContain("https://example.com/about");
  });
});

describe("result shape tolerance", () => {
  it("accepts a bare issue array wrapped as issues", () => {
    const findings = pa11yToFindings({ issues: samplePa11yResults.issues });
    expect(findings).toHaveLength(samplePa11yResults.issues.length);
  });
});
