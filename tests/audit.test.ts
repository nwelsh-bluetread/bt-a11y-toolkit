import { describe, it, expect } from "vitest";
import { runAudit, combineAudits, computeOverallScore, computeTopIssues } from "../src/audit.js";
import { formatConsole, formatJson, formatMarkdown } from "../src/report.js";
import type { A11yNode, Finding } from "../src/types.js";
import { wcag } from "../src/wcag.js";
import { sampleTree } from "./fixtures.js";

describe("runAudit", () => {
  const assessment = runAudit(sampleTree, { platform: "web", targetLevel: "AA" });

  it("produces findings and a score between 0 and 100", () => {
    expect(assessment.findings.length).toBeGreaterThan(0);
    expect(assessment.overallScore).toBeGreaterThanOrEqual(0);
    expect(assessment.overallScore).toBeLessThanOrEqual(100);
  });

  it("counts severities", () => {
    const total =
      assessment.counts.critical +
      assessment.counts.high +
      assessment.counts.medium +
      assessment.counts.low;
    expect(total).toBe(assessment.findings.length);
  });

  it("produces a scorecard sorted by ascending score", () => {
    const scores = assessment.categories.map((c) => c.score);
    const sorted = [...scores].sort((a, b) => a - b);
    expect(scores).toEqual(sorted);
  });

  it("provides WCAG rollups as percentages", () => {
    for (const level of ["A", "AA", "AAA"] as const) {
      expect(assessment.wcag[level]).toBeGreaterThanOrEqual(0);
      expect(assessment.wcag[level]).toBeLessThanOrEqual(100);
    }
  });
});

describe("combineAudits", () => {
  const clean: A11yNode = {
    type: "view",
    id: "clean-root",
    children: [
      {
        type: "button",
        id: "ok",
        role: "button",
        accessibleName: "Pay",
        interactive: true,
        size: { width: 48, height: 48 },
      },
    ],
  };
  const combined = combineAudits(
    [
      { name: "Billing/Home", tree: sampleTree },
      { name: "Billing/Detail", tree: sampleTree },
      { name: "Billing/Clean", tree: clean },
    ],
    { platform: "react-native", targetLevel: "AA" },
  );

  it("lists every audited target, including ones with no findings", () => {
    expect(combined.pages).toEqual(["Billing/Home", "Billing/Detail", "Billing/Clean"]);
  });

  it("attributes every finding to the target it came from", () => {
    const pages = new Set(combined.findings.map((f) => f.evidence?.page));
    expect(pages).toEqual(new Set(["Billing/Home", "Billing/Detail"]));
  });

  it("keeps matching findings from different targets as separate defects", () => {
    const single = runAudit(sampleTree, { platform: "react-native", targetLevel: "AA" });
    // Two copies of the same tree are two real screens to fix, not one.
    expect(combined.findings.length).toBe(single.findings.length * 2);
  });

  it("sums the underlying checks rather than averaging per-target rates", () => {
    // The clean target adds passing checks, so the rollup must improve on the
    // rate of the failing targets alone.
    const failingOnly = combineAudits(
      [
        { name: "Billing/Home", tree: sampleTree },
        { name: "Billing/Detail", tree: sampleTree },
      ],
      { platform: "react-native", targetLevel: "AA" },
    );
    expect(combined.wcag.AA).toBeGreaterThan(failingOnly.wcag.AA);
  });

  it("produces an empty assessment for no targets", () => {
    const empty = combineAudits([], { platform: "react-native" });
    expect(empty.findings).toEqual([]);
    expect(empty.pages).toEqual([]);
    expect(empty.overallScore).toBe(100);
  });
});

describe("computeOverallScore", () => {
  it("returns 100 with no findings", () => {
    expect(computeOverallScore([], 50)).toBe(100);
  });
});

describe("computeTopIssues", () => {
  it("ranks by weighted severity", () => {
    const findings: Finding[] = [
      { ruleId: "a", title: "A", description: "", severity: "low", wcag: wcag("1.1.1") },
      { ruleId: "b", title: "B", description: "", severity: "critical", wcag: wcag("4.1.2") },
    ];
    const top = computeTopIssues(findings);
    expect(top[0]).toContain("B");
  });
});

describe("formatters", () => {
  const assessment = runAudit(sampleTree, { platform: "web" });

  it("renders the console report with the expected header", () => {
    const out = formatConsole(assessment);
    expect(out).toContain("Accessibility Assessment");
    expect(out).toContain("Overall Score:");
    expect(out).toContain("WCAG AA:");
  });

  it("renders valid JSON", () => {
    expect(() => JSON.parse(formatJson(assessment))).not.toThrow();
  });

  it("renders markdown with a scorecard table", () => {
    const md = formatMarkdown(assessment);
    expect(md).toContain("# Accessibility Assessment");
    expect(md).toContain("## Accessibility Scorecard");
  });
});
