import { describe, it, expect } from "vitest";
import { recordRun, mergeRunHistory, type RunRecord } from "../src/history.js";
import {
  scoreTrend,
  recurringIssues,
  mttrByCategory,
  mttrBySeverity,
  hotspots,
} from "../src/trends.js";
import type { Assessment, Finding } from "../src/types.js";
import { WCAG } from "../src/wcag.js";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: "axe:image-alt",
    title: "Images must have alternate text",
    description: "…",
    severity: "high",
    wcag: [WCAG["1.1.1"]!],
    category: "Images/Icons",
    source: "axe",
    evidence: { page: "home.html", selectors: ["img.hero"] },
    ...overrides,
  };
}

function assessment(findings: Finding[], score: number, at: string): Assessment {
  return {
    generatedAt: at,
    platform: "web",
    targetLevel: "AA",
    overallScore: score,
    counts: { critical: 0, high: findings.length, medium: 0, low: 0 },
    wcag: { A: score, AA: score, AAA: score },
    categories: [],
    topIssues: [],
    findings,
  };
}

const contrast = (page = "home.html") =>
  finding({
    ruleId: "axe:color-contrast",
    title: "Contrast too low",
    category: "Contrast",
    wcag: [WCAG["1.4.3"]!],
    evidence: { page, selectors: ["p.muted"] },
  });

function history(): RunRecord[] {
  const alt = finding();
  const runs = [
    recordRun(assessment([alt, contrast()], 70, "2026-01-01T00:00:00.000Z"), { runId: "r1" }),
    recordRun(assessment([alt], 82, "2026-01-02T00:00:00.000Z"), { runId: "r2" }),
    recordRun(assessment([alt, contrast()], 78, "2026-01-03T00:00:00.000Z"), { runId: "r3" }),
  ];
  return mergeRunHistory(runs);
}

describe("scoreTrend", () => {
  it("produces per-run deltas in chronological order", () => {
    const trend = scoreTrend(history());
    expect(trend.map((p) => p.overallScore)).toEqual([70, 82, 78]);
    expect(trend.map((p) => p.delta)).toEqual([0, 12, -4]);
  });
});

describe("recurringIssues", () => {
  it("flags an issue that was fixed then came back", () => {
    const recurring = recurringIssues(history());
    const c = recurring.find((r) => r.ruleId === "axe:color-contrast");
    expect(c).toBeDefined();
    expect(c!.recurrences).toBe(1);
    expect(c!.presentIn).toEqual(["r1", "r3"]);
  });

  it("does not flag an always-present issue", () => {
    const recurring = recurringIssues(history());
    expect(recurring.find((r) => r.ruleId === "axe:image-alt")).toBeUndefined();
  });
});

describe("mttr", () => {
  it("measures time-to-fix by category when an issue is resolved", () => {
    // contrast present in r1 (Jan 1), absent in r2 (Jan 2) => resolved, ~24h.
    const mttr = mttrByCategory(history());
    const contrastMttr = mttr.find((m) => m.key === "Contrast");
    expect(contrastMttr).toBeDefined();
    expect(contrastMttr!.resolvedCount).toBeGreaterThanOrEqual(1);
    expect(contrastMttr!.avgHoursToFix).toBeGreaterThan(0);
  });

  it("also groups by severity", () => {
    const mttr = mttrBySeverity(history());
    expect(mttr.some((m) => m.key === "high")).toBe(true);
  });
});

describe("hotspots", () => {
  it("ranks locations by distinct issue count", () => {
    const alt = finding();
    const runs = mergeRunHistory([
      recordRun(
        assessment([alt, contrast("home.html"), contrast("about.html")], 60, "2026-01-01T00:00:00.000Z"),
        { runId: "r1" },
      ),
    ]);
    const spots = hotspots(runs);
    const home = spots.find((s) => s.location === "home.html");
    expect(home).toBeDefined();
    expect(home!.distinctIssues).toBe(2);
    expect(home!.worstSeverity).toBe("high");
  });
});
