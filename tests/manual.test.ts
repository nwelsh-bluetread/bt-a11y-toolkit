import { describe, it, expect } from "vitest";
import {
  MANUAL_CHECKS,
  manualChecksForLevel,
  generateChecklistMarkdown,
  generateChecklistCsv,
  parseVerdict,
  ingestChecklist,
} from "../src/manual.js";

describe("manualChecksForLevel", () => {
  it("includes only A checks at level A", () => {
    const checks = manualChecksForLevel("A");
    expect(checks.every((c) => c.level === "A")).toBe(true);
  });

  it("is cumulative: AA includes A + AA", () => {
    const aa = manualChecksForLevel("AA");
    expect(aa.some((c) => c.level === "A")).toBe(true);
    expect(aa.some((c) => c.level === "AA")).toBe(true);
    expect(aa.some((c) => c.level === "AAA")).toBe(false);
  });

  it("AAA includes everything", () => {
    expect(manualChecksForLevel("AAA")).toHaveLength(MANUAL_CHECKS.length);
  });
});

describe("generateChecklistMarkdown", () => {
  const md = generateChecklistMarkdown({
    pages: ["/login", "/dashboard"],
    level: "AA",
    gestures: ["swipe to delete"],
  });

  it("puts pages as column headers", () => {
    expect(md).toContain("| Manual check | WCAG | How to test | /login | /dashboard |");
  });

  it("emits a row per applicable check", () => {
    const rowCount = md.split("\n").filter((l) => l.startsWith("| Screen reader announces")).length;
    expect(rowCount).toBe(1);
    // AA checklist should not contain AAA-only checks.
    expect(md).not.toContain("Enhanced contrast 7:1");
  });

  it("appends a gestures sub-table when gestures are provided", () => {
    expect(md).toContain("## Gestures / interactions");
    expect(md).toContain("| swipe to delete |");
  });

  it("escapes pipe characters in page names", () => {
    const piped = generateChecklistMarkdown({ pages: ["a|b"], level: "A" });
    expect(piped).toContain("a\\|b");
  });
});

describe("generateChecklistCsv", () => {
  it("produces a header row with pages and a row per check", () => {
    const csv = generateChecklistCsv({ pages: ["/home", "/about"], level: "A" });
    const rows = csv.split("\n");
    expect(rows[0]).toBe("Check,WCAG,How to test,/home,/about");
    expect(rows.length).toBe(1 + manualChecksForLevel("A").length);
  });

  it("quotes fields containing commas", () => {
    const csv = generateChecklistCsv({ pages: ["a,b"], level: "A" });
    expect(csv.split("\n")[0]).toContain('"a,b"');
  });
});

describe("parseVerdict", () => {
  it("recognizes pass/fail/na/untested synonyms", () => {
    expect(parseVerdict("pass")).toBe("pass");
    expect(parseVerdict("✓")).toBe("pass");
    expect(parseVerdict("fail")).toBe("fail");
    expect(parseVerdict("x")).toBe("fail");
    expect(parseVerdict("n/a")).toBe("n/a");
    expect(parseVerdict("")).toBe("untested");
    expect(parseVerdict("-")).toBe("untested");
  });

  it("treats a free-text note as a fail so it is not dropped", () => {
    expect(parseVerdict("focus lost on close")).toBe("fail");
  });
});

describe("ingestChecklist", () => {
  // A completed checklist built by hand so the test is robust to exact spacing.
  function filled(): string {
    return [
      "# Manual Accessibility Checklist",
      "",
      "| Manual check | WCAG | How to test | /login | /dashboard |",
      "| --- | --- | --- | --- | --- |",
      "| Screen reader announces name, role, and value | 4.1.2 | VoiceOver | fail | pass |",
      "| Visible focus indicator on every control | 2.4.7 | Tab | pass | n/a |",
      "",
      "## Gestures / interactions",
      "",
      "| Gesture | /login | /dashboard |",
      "| --- | --- | --- |",
      "| swipe to delete | fail | n/a |",
      "",
    ].join("\n");
  }

  it("turns fail cells into manual findings tagged with the page", () => {
    const { findings } = ingestChecklist(filled());
    const sr = findings.find((f) => f.ruleId === "manual:sr-name-role-value");
    expect(sr).toBeDefined();
    expect(sr!.source).toBe("manual");
    expect(sr!.severity).toBe("critical");
    expect(sr!.wcag.map((c) => c.id)).toContain("4.1.2");
    expect(sr!.evidence?.page).toBe("/login");
  });

  it("does not create findings for pass / n/a / untested cells", () => {
    const { findings } = ingestChecklist(filled());
    // /dashboard passed the SR check -> no finding for it.
    expect(
      findings.filter((f) => f.ruleId === "manual:sr-name-role-value" && f.evidence?.page === "/dashboard"),
    ).toHaveLength(0);
  });

  it("ingests gesture-table failures as pointer-gesture findings", () => {
    const { findings } = ingestChecklist(filled());
    const gesture = findings.find((f) => f.ruleId.startsWith("manual:gesture:"));
    expect(gesture).toBeDefined();
    expect(gesture!.wcag.map((c) => c.id)).toContain("2.5.1");
    expect(gesture!.evidence?.page).toBe("/login");
  });

  it("tallies verdict counts per page", () => {
    const { counts, byPage } = ingestChecklist(filled());
    expect(counts.fail).toBeGreaterThanOrEqual(2); // SR fail + gesture fail
    expect(byPage["/login"]!.fail).toBeGreaterThanOrEqual(2);
    expect(byPage["/dashboard"]!.pass).toBeGreaterThanOrEqual(1);
  });

  it("round-trips: a freshly generated (blank) checklist yields no findings", () => {
    const blank = generateChecklistMarkdown({
      pages: ["/a", "/b"],
      level: "AA",
      gestures: ["pinch"],
    });
    const { findings, counts } = ingestChecklist(blank);
    expect(findings).toHaveLength(0);
    expect(counts.fail).toBe(0);
    expect(counts.untested).toBeGreaterThan(0);
  });
});
