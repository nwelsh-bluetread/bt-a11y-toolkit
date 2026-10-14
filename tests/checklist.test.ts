import { describe, expect, it } from "vitest";
import { checklistFor, howToFor, MANUAL_CHECKLIST } from "../src/checklist.js";
import { findingsToAssessment } from "../src/audit.js";
import { WCAG, wcag } from "../src/wcag.js";
import type { Finding } from "../src/types.js";

describe("MANUAL_CHECKLIST", () => {
  it("only references known WCAG criteria at the item's level or below", () => {
    const rank = { A: 1, AA: 2, AAA: 3 };
    for (const item of MANUAL_CHECKLIST) {
      for (const id of item.wcag) {
        expect(WCAG[id], `${item.id} → ${id}`).toBeDefined();
        expect(rank[WCAG[id]!.level]).toBeLessThanOrEqual(rank[item.level]);
      }
    }
  });

  it("covers all 86 WCAG 2.2 success criteria", () => {
    expect(Object.keys(WCAG)).toHaveLength(86);
    const covered = new Set(MANUAL_CHECKLIST.flatMap((i) => i.wcag));
    expect(Object.keys(WCAG).filter((id) => !covered.has(id))).toEqual([]);
  });

  it("has unique ids and instructions for every item", () => {
    const ids = MANUAL_CHECKLIST.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of MANUAL_CHECKLIST) {
      expect(howToFor(item, "web")).not.toBe("");
      expect(howToFor(item, "ios")).not.toBe("");
    }
  });
});

describe("checklistFor", () => {
  it("stacks levels: AA includes A, AAA includes both", () => {
    const a = checklistFor("web", "A");
    const aa = checklistFor("web", "AA");
    const aaa = checklistFor("web", "AAA");
    expect(a.every((i) => i.level === "A")).toBe(true);
    expect(aa.length).toBeGreaterThan(a.length);
    expect(aaa.length).toBeGreaterThan(aa.length);
    expect(aa.some((i) => i.level === "AAA")).toBe(false);
  });

  it("leaves out web-only checks for mobile apps", () => {
    const ios = checklistFor("ios", "AA").map((i) => i.id);
    expect(ios).not.toContain("bypass-blocks");
    expect(ios).not.toContain("text-spacing");
    expect(checklistFor("web", "AA").map((i) => i.id)).toContain("bypass-blocks");
  });

  it("uses platform-specific instructions when available", () => {
    const item = MANUAL_CHECKLIST.find((i) => i.id === "resize-text")!;
    expect(howToFor(item, "ios")).toContain("Larger Text");
    expect(howToFor(item, "android")).toContain("Font size");
  });
});

describe("findingsToAssessment", () => {
  const findings: Finding[] = [
    { ruleId: "manual:a", title: "A", description: "", severity: "high", wcag: wcag("4.1.2"), category: "Screen Reader" },
    { ruleId: "manual:b", title: "B", description: "", severity: "low", wcag: wcag("1.4.6"), category: "Contrast" },
  ];

  it("scores, counts, and categorizes arbitrary findings", () => {
    const a = findingsToAssessment(findings, { platforms: ["ios", "android"], targetLevel: "AA" });
    expect(a.platform).toBe("ios");
    expect(a.platforms).toEqual(["ios", "android"]);
    expect(a.counts).toEqual({ critical: 0, high: 1, medium: 0, low: 1 });
    expect(a.categories.map((c) => c.category).sort()).toEqual(["Contrast", "Screen Reader"]);
    expect(a.overallScore).toBeLessThan(100);
  });

  it("derives a WCAG rollup that only penalizes the levels a finding belongs to", () => {
    const a = findingsToAssessment([findings[1]!]);
    expect(a.wcag.A).toBe(100);
    expect(a.wcag.AA).toBe(100);
    expect(a.wcag.AAA).toBeLessThan(100);
  });

  it("uses a caller-provided rollup when given", () => {
    const rollup = { A: 50, AA: 40, AAA: 30 };
    expect(findingsToAssessment(findings, { wcag: rollup }).wcag).toEqual(rollup);
  });
});
