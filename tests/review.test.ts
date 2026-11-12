import { describe, expect, it } from "vitest";
import type { Finding } from "../src/types.js";
import { wcag } from "../src/wcag.js";
import { planChecklist, type ChecklistRow, type ParsedChecklist } from "../src/wizard/checklist-md.js";
import { applyReviews } from "../src/wizard/review.js";
import { newSession } from "../src/wizard/session.js";

const PAGE = "https://acme.test/login";
const session = newSession({ name: "Acme", type: "web", targets: ["web"], targetLevel: "AA", urls: [PAGE] }, [{ name: "/login", kind: "web", url: PAGE }]);

const finding = (ruleId: string, source: string, criterion: string, needsReview = false): Finding => ({
  ruleId,
  title: ruleId,
  description: "",
  severity: "high",
  wcag: wcag(criterion),
  platforms: ["web"],
  source,
  evidence: { page: PAGE, ...(needsReview ? { needsReview: true } : {}) },
});

session.automated = [
  { tool: "axe", targets: ["web"], ranAt: "", pages: 1, checked: ["1.4.3"], findings: [finding("color-contrast", "axe", "1.4.3")] },
  { tool: "voiceover", targets: ["web"], ranAt: "", pages: 1, checked: ["4.1.2"], findings: [finding("sr-no-name", "voiceover", "4.1.2", true)] },
];

/** Checklist rows on /login for every check covering a criterion, all with one answer. */
function rowsFor(criterion: string, status: ChecklistRow["status"], reviewed = true): ChecklistRow[] {
  const section = planChecklist(session.screens, ["web"], "AA")[0]!.sections.find((s) => s.screen?.name === "/login")!;
  return section.checks
    .filter((c) => c.item.wcag.includes(criterion))
    .map((c) => ({ group: "web", section: "", screen: "/login", itemId: c.item.id, target: "web", status, issues: [], lines: [], ...(reviewed ? {} : { reviewed: false as const }) }));
}

const checklist = (...rows: ChecklistRow[][]): ParsedChecklist => ({ rows: rows.flat(), screenMarks: [], other: [], warnings: [] }) as unknown as ParsedChecklist;
const kept = (c: ParsedChecklist) => applyReviews(session, c).session.automated.flatMap((r) => r.findings.map((f) => f.ruleId));

describe("applyReviews", () => {
  it("has a checklist line for both findings to be reviewed on", () => {
    expect(rowsFor("1.4.3", "open").length).toBeGreaterThan(0);
    expect(rowsFor("4.1.2", "open").length).toBeGreaterThan(0);
  });

  it("holds back screen reader findings nobody reviewed, but keeps other unreviewed scan findings", () => {
    const r = applyReviews(session, checklist(rowsFor("1.4.3", "fail", false), rowsFor("4.1.2", "fail", false)));
    expect(r.session.automated.flatMap((x) => x.findings.map((f) => f.ruleId))).toEqual(["color-contrast"]);
    expect(r.held).toEqual({ voiceover: 1 });
    expect(r.dismissed).toBe(0);
  });

  it("keeps findings a tester confirmed with Fail", () => {
    expect(kept(checklist(rowsFor("1.4.3", "fail"), rowsFor("4.1.2", "fail")))).toEqual(["color-contrast", "sr-no-name"]);
  });

  it("drops findings a tester dismissed with Pass or N/A on every line", () => {
    const r = applyReviews(session, checklist(rowsFor("1.4.3", "pass"), rowsFor("4.1.2", "na")));
    expect(r.session.automated.flatMap((x) => x.findings)).toEqual([]);
    expect(r.dismissed).toBe(2);
    // The saved session is untouched: the checklist is still built from every finding.
    expect(session.automated.flatMap((x) => x.findings)).toHaveLength(2);
  });

  it("keeps a finding when one of its lines is confirmed and another passed", () => {
    const lines = rowsFor("4.1.2", "pass");
    if (lines.length < 2) return; // only one check covers 4.1.2 on this page
    lines[0]!.status = "fail";
    expect(kept(checklist(rowsFor("1.4.3", "fail"), lines))).toContain("sr-no-name");
  });

  it("keeps findings no checklist line covers, counting screen reader ones it couldn't review", () => {
    expect(kept(checklist())).toEqual(["color-contrast", "sr-no-name"]);
    // Website alt text is an app-wide check, so a page's image finding has no line to be reviewed on.
    const alt = { ...session, automated: [{ tool: "voiceover", targets: ["web" as const], ranAt: "", pages: 1, checked: ["1.1.1"], findings: [finding("sr-image-alt", "voiceover", "1.1.1", true)] }] };
    const r = applyReviews(alt, checklist(rowsFor("4.1.2", "fail", false)));
    expect(r.session.automated[0]!.findings.map((f) => f.ruleId)).toEqual(["sr-image-alt"]);
    expect(r.unreviewable).toEqual({ voiceover: 1 });
    expect(r.held).toEqual({});
  });
});
