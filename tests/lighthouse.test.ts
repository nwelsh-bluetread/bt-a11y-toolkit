import { describe, it, expect } from "vitest";
import {
  lighthouseToFindings,
  lighthouseToAssessment,
  combineLighthouseResults,
  type LighthouseResult,
} from "../src/integrations/lighthouse.js";
import { sampleLhr } from "./fixtures.lighthouse.js";

describe("lighthouseToFindings", () => {
  const findings = lighthouseToFindings(sampleLhr);

  it("produces a finding for each failing audit only", () => {
    const ids = findings.map((f) => f.ruleId);
    expect(ids).toContain("lighthouse:color-contrast");
    expect(ids).toContain("lighthouse:image-alt");
    expect(ids).toContain("lighthouse:heading-order");
    // passing audits are excluded
    expect(ids).not.toContain("lighthouse:button-name");
    expect(ids).not.toContain("lighthouse:label");
  });

  it("skips non-applicable audits", () => {
    const ids = findings.map((f) => f.ruleId);
    expect(ids).not.toContain("lighthouse:meta-refresh");
  });

  it("maps severity and WCAG criteria", () => {
    const contrast = findings.find((f) => f.ruleId === "lighthouse:color-contrast");
    expect(contrast?.severity).toBe("high");
    expect(contrast?.wcag.map((c) => c.id)).toContain("1.4.3");
    expect(contrast?.category).toBe("Contrast");
    expect(contrast?.source).toBe("lighthouse");
  });

  it("captures affected element selectors as evidence", () => {
    const contrast = findings.find((f) => f.ruleId === "lighthouse:color-contrast");
    expect(contrast?.evidence?.affectedElements).toBe(2);
    expect(contrast?.nodeId).toBe("p.muted");
  });
});

describe("lighthouseToAssessment", () => {
  const assessment = lighthouseToAssessment(sampleLhr, { targetLevel: "AA" });

  it("uses Lighthouse's own accessibility score as the overall score", () => {
    expect(assessment.overallScore).toBe(82);
  });

  it("counts findings by severity", () => {
    const total =
      assessment.counts.critical +
      assessment.counts.high +
      assessment.counts.medium +
      assessment.counts.low;
    expect(total).toBe(assessment.findings.length);
  });

  it("computes WCAG rollups from pass/fail audits", () => {
    for (const level of ["A", "AA", "AAA"] as const) {
      expect(assessment.wcag[level]).toBeGreaterThanOrEqual(0);
      expect(assessment.wcag[level]).toBeLessThanOrEqual(100);
    }
  });

  it("builds a category scorecard", () => {
    expect(assessment.categories.length).toBeGreaterThan(0);
    expect(assessment.categories.map((c) => c.category)).toContain("Contrast");
  });
});

describe("combineLighthouseResults", () => {
  // A second "page" derived from the sample with a perfect score and no failing audits.
  const perfectLhr: LighthouseResult = JSON.parse(JSON.stringify(sampleLhr));
  if (perfectLhr.categories?.accessibility) perfectLhr.categories.accessibility.score = 1;
  for (const audit of Object.values(perfectLhr.audits)) {
    if (audit && typeof audit === "object") {
      const a = audit as { score?: number | null; details?: unknown };
      a.score = 1;
      a.details = undefined;
    }
  }

  const pages = [
    { url: "https://example.com/", lhr: sampleLhr },
    { url: "https://example.com/about", lhr: perfectLhr },
  ];
  const combined = combineLighthouseResults(pages, { targetLevel: "AA" });

  it("tags every finding with the page it came from", () => {
    expect(combined.findings.length).toBeGreaterThan(0);
    for (const f of combined.findings) {
      expect(f.evidence?.page).toBeDefined();
    }
    // all findings should come from the failing page
    expect(combined.findings.every((f) => f.evidence?.page === "https://example.com/")).toBe(true);
  });

  it("averages the per-page accessibility scores", () => {
    // (82 + 100) / 2 = 91
    expect(combined.overallScore).toBe(91);
  });

  it("aggregates counts across all pages", () => {
    const single = lighthouseToAssessment(sampleLhr, { targetLevel: "AA" });
    expect(combined.findings.length).toBe(single.findings.length);
  });

  it("produces valid WCAG rollups", () => {
    for (const level of ["A", "AA", "AAA"] as const) {
      expect(combined.wcag[level]).toBeGreaterThanOrEqual(0);
      expect(combined.wcag[level]).toBeLessThanOrEqual(100);
    }
  });
});
