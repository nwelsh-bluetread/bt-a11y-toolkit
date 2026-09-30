import { describe, it, expect } from "vitest";
import {
  fingerprint,
  normalizeSelector,
  recordRun,
  diffRuns,
  mergeRunHistory,
  allFingerprints,
  type RunRecord,
} from "../src/history.js";
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
    evidence: { page: "src/pages/home.html", selectors: ["img.hero"] },
    ...overrides,
  };
}

function assessment(findings: Finding[], overrides: Partial<Assessment> = {}): Assessment {
  return {
    generatedAt: "2026-01-01T00:00:00.000Z",
    platform: "web",
    targetLevel: "AA",
    overallScore: 90,
    counts: { critical: 0, high: findings.length, medium: 0, low: 0 },
    wcag: { A: 90, AA: 90, AAA: 90 },
    categories: [],
    topIssues: [],
    findings,
    ...overrides,
  };
}

describe("normalizeSelector", () => {
  it("reduces an ancestor path to its target element", () => {
    expect(normalizeSelector("div.wrap > nav.crumbs > a.link")).toBe("a.link");
  });

  it("drops pseudo-classes and attribute selectors", () => {
    expect(normalizeSelector("a.link:nth-child(2)")).toBe("a.link");
    expect(normalizeSelector('input[type="text"].field')).toBe("input.field");
  });

  it("prefers a DOM id over classes", () => {
    expect(normalizeSelector("div#main.wrapper")).toBe("div#main");
  });

  it("sorts classes so order does not change identity", () => {
    expect(normalizeSelector("span.b.a")).toBe(normalizeSelector("span.a.b"));
  });
});

describe("fingerprint", () => {
  it("is stable for the same problem on the same element", () => {
    expect(fingerprint(finding())).toBe(fingerprint(finding()));
  });

  it("is identical across engines reporting the same issue", () => {
    const axe = finding({ ruleId: "axe:image-alt", source: "axe" });
    const pa11y = finding({ ruleId: "pa11y:WCAG2A...1_1_1.H37", source: "pa11y" });
    expect(fingerprint(axe)).toBe(fingerprint(pa11y));
  });

  it("differs when the element differs", () => {
    const a = finding({ evidence: { page: "home.html", selectors: ["img.hero"] } });
    const b = finding({ evidence: { page: "home.html", selectors: ["img.thumb"] } });
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it("differs when the page differs", () => {
    const a = finding({ evidence: { page: "home.html", selectors: ["img.hero"] } });
    const b = finding({ evidence: { page: "about.html", selectors: ["img.hero"] } });
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it("falls back to ruleId when there is no selector or location", () => {
    const a = finding({ ruleId: "toolkit:contrast", evidence: {}, nodeId: undefined });
    const b = finding({ ruleId: "toolkit:image-alt", evidence: {}, nodeId: undefined });
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });
});

describe("recordRun", () => {
  it("produces a durable record with fingerprints and seen timestamps", () => {
    const run = recordRun(assessment([finding()]), { commitSha: "abc123", branch: "main" });
    expect(run.commitSha).toBe("abc123");
    expect(run.overallScore).toBe(90);
    expect(run.findings).toHaveLength(1);
    const tracked = run.findings[0]!;
    expect(tracked.fingerprint).toHaveLength(16);
    expect(tracked.firstSeen).toBe("2026-01-01T00:00:00.000Z");
    expect(tracked.lastSeen).toBe("2026-01-01T00:00:00.000Z");
    expect(tracked.location).toBe("src/pages/home.html");
    expect(tracked.selector).toBe("img.hero");
  });

  it("derives a run id from the timestamp when none is given", () => {
    const run = recordRun(assessment([finding()]));
    expect(run.runId).toContain("run-2026-01-01");
  });
});

describe("diffRuns", () => {
  const alt = finding({ evidence: { page: "home.html", selectors: ["img.hero"] } });
  const contrast = finding({
    ruleId: "axe:color-contrast",
    wcag: [WCAG["1.4.3"]!],
    evidence: { page: "home.html", selectors: ["p.muted"] },
  });

  it("classifies new, fixed, and persisting findings", () => {
    const prev = recordRun(assessment([alt]), { runId: "r1" });
    const next = recordRun(assessment([alt, contrast]), { runId: "r2" });
    const diff = diffRuns(prev, next);
    expect(diff.persisting.map((f) => f.ruleId)).toEqual(["axe:image-alt"]);
    expect(diff.new.map((f) => f.ruleId)).toEqual(["axe:color-contrast"]);
    expect(diff.fixed).toHaveLength(0);
  });

  it("reports fixed findings that disappear", () => {
    const prev = recordRun(assessment([alt, contrast]), { runId: "r1" });
    const next = recordRun(assessment([alt]), { runId: "r2" });
    const diff = diffRuns(prev, next);
    expect(diff.fixed.map((f) => f.ruleId)).toEqual(["axe:color-contrast"]);
  });

  it("detects regressions using prior fingerprints", () => {
    const r1 = recordRun(assessment([contrast]), { runId: "r1" });
    const r2 = recordRun(assessment([]), { runId: "r2" });
    const r3 = recordRun(assessment([contrast]), { runId: "r3" });
    const prior = allFingerprints([r1, r2]);
    const diff = diffRuns(r2, r3, prior);
    expect(diff.regressed.map((f) => f.ruleId)).toEqual(["axe:color-contrast"]);
    expect(diff.new).toHaveLength(0);
  });

  it("computes the score delta", () => {
    const prev = recordRun(assessment([alt], { overallScore: 80 }), { runId: "r1" });
    const next = recordRun(assessment([alt], { overallScore: 88 }), { runId: "r2" });
    expect(diffRuns(prev, next).scoreDelta).toBe(8);
  });
});

describe("mergeRunHistory", () => {
  it("carries firstSeen forward to the earliest run a fingerprint appeared", () => {
    const alt = finding();
    const r1 = recordRun(assessment([alt]), { runId: "r1", timestamp: "2026-01-01T00:00:00.000Z" });
    const r2 = recordRun(assessment([alt]), { runId: "r2", timestamp: "2026-01-08T00:00:00.000Z" });
    const [, merged2] = mergeRunHistory([r2, r1]);
    expect(merged2!.findings[0]!.firstSeen).toBe("2026-01-01T00:00:00.000Z");
    expect(merged2!.findings[0]!.lastSeen).toBe("2026-01-08T00:00:00.000Z");
  });
});
