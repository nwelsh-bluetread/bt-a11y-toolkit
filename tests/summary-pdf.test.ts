import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findingsToAssessment } from "../src/audit.js";
import { buildSummaryData, mergeManualIntoScan, rendererPath, summaryPdfName, type SummaryFinding } from "../src/pdf/summary.js";
import type { Finding, Severity } from "../src/types.js";
import { wcag } from "../src/wcag.js";
import { parseChecklist } from "../src/wizard/checklist-md.js";
import { newSession } from "../src/wizard/session.js";

const session = newSession({ name: "Acme App", type: "mobile", targets: ["ios", "android"], targetLevel: "AA" }, [
  { name: "Login", kind: "mobile", file: "src/Login.tsx", files: ["src/Login.tsx", "src/Logo.tsx"], features: ["inputs"] },
  { name: "Inbox", kind: "mobile", file: "src/Inbox.tsx", files: ["src/Inbox.tsx", "src/Logo.tsx"], features: [] },
]);

const findings: Finding[] = [
  {
    ruleId: "rn-image-alt",
    title: "Image has no text alternative or decorative marking (2×) — src/Logo.tsx",
    description: "Images are invisible to screen readers.",
    severity: "medium",
    wcag: wcag("1.1.1"),
    platforms: ["ios", "android"],
    source: "rn-code-scan",
    evidence: { file: "src/Logo.tsx", lines: [4, 9] },
  },
  {
    ruleId: "manual:accessible-auth",
    title: "Password field blocks paste",
    description: "Password field blocks paste",
    severity: "critical",
    wcag: wcag("3.3.8"),
    platforms: ["android"],
    source: "manual",
    nodeId: "Login",
    evidence: { screen: "Login" },
  },
  {
    ruleId: "rn-orientation-lock",
    title: "Screen orientation is locked — app.json",
    description: "",
    severity: "medium",
    wcag: wcag("1.3.4"),
    platforms: ["ios", "android"],
    source: "rn-code-scan",
    evidence: { file: "app.json", lines: [3] },
  },
];
const assessment = findingsToAssessment(findings, { platforms: ["ios", "android"], targetLevel: "AA" });
const checklist = parseChecklist("# Mobile app — iOS + Android\n\n## Screen: Login\n\n### C · `input-labels`\n- [x] iOS\n- [ ] Android\n");

describe("buildSummaryData", () => {
  const data = buildSummaryData(session, assessment, checklist, {}, new Date("2026-10-14T12:00:00Z"));

  it("fills the cover from the audit", () => {
    expect(data).toMatchObject({
      title: "Acme App",
      auditDate: "2026-10-14",
      targetLevel: "AA",
      scope: "2 screens · iOS + Android",
      pageNoun: "screen",
      overallScore: assessment.overallScore,
    });
    expect(data.keyTakeaway).toBe("1 critical issue creates barriers on iOS + Android. Fix first: Password field blocks paste.");
    expect(data.principleSummaries.U).toBe("Most serious: Password field blocks paste.");
    expect(data.footer).toContain("1 of 2 checklist checks completed");
  });

  it("keeps one entry per finding with matching severity totals", () => {
    expect(data.findings).toHaveLength(assessment.findings.length);
    for (const sev of ["critical", "high", "medium", "low"] as const) {
      expect(data.findings.filter((f) => f.severity === sev)).toHaveLength(assessment.counts[sev]);
    }
  });

  it("names code findings by the screens that render the file, with the file as the location", () => {
    const image = data.findings.find((f) => f.rule === "rn-image-alt")!;
    expect(image).toMatchObject({
      title: "Image has no text alternative or decorative marking",
      pages: ["Login", "Inbox"],
      location: "src/Logo.tsx:4, 9",
      reportedBy: "code scan",
      group: "rn-image-alt",
    });
    expect(data.findings.find((f) => f.rule === "rn-orientation-lock")!.pages).toEqual(["App-wide"]);
  });

  it("tags manual findings with their screen and platform, and keeps distinct issues separate", () => {
    const manual = data.findings.find((f) => f.rule === "manual:accessible-auth")!;
    expect(manual.pages).toEqual(["Login (Android)"]);
    expect(manual.group).toBe("manual:accessible-auth|Password field blocks paste");
  });

  it("lets summary-overrides.json replace generated fields", () => {
    const custom = buildSummaryData(session, assessment, checklist, { keyTakeaway: "Hand-written.", preparedBy: "BlueTread A11y" });
    expect(custom.keyTakeaway).toBe("Hand-written.");
    expect(custom.preparedBy).toBe("BlueTread A11y");
  });
});

describe("renderer", () => {
  it("ships the renderer next to the sources", () => {
    expect(existsSync(rendererPath())).toBe(true);
    expect(summaryPdfName(new Date("2026-10-14T12:00:00Z"))).toBe("a11y-audit-summary-2026-10-14.pdf");
  });
});

describe("parseVeraPdf", () => {
  it("reads pass, fail (with rule ids), and missing-veraPDF output", async () => {
    const { parseVeraPdf } = await import("../src/pdf/pdfua.js");
    expect(parseVeraPdf('<validationReport profileName="PDF/UA-1" isCompliant="true"><details failedRules="0">')).toEqual({ status: "pass" });
    const fail = `<validationReport isCompliant="false"><details passedRules="102" failedRules="2" failedChecks="154">
      <rule specification="ISO 14289-1:2014" clause="7.1" testNumber="5" status="failed" failedChecks="3" tags="structure">
      <rule specification="ISO 14289-1:2014" clause="7.1" testNumber="3" status="failed" failedChecks="151" tags="artifact">`;
    expect(parseVeraPdf(fail)).toEqual({ status: "fail", failedRules: 2, details: "7.1-5, 7.1-3" });
    expect(parseVeraPdf("zsh: command not found: verapdf")).toEqual({ status: "unavailable" });
  });
});

describe("mergeManualIntoScan", () => {
  const f = (rule: string, title: string, severity: Severity, wcag: string[]): SummaryFinding => ({
    title,
    group: rule.startsWith("manual:") ? `${rule}|${title}` : rule,
    rule,
    severity,
    reportedBy: rule.startsWith("manual:") ? "manual" : "code scan",
    wcag,
    pages: ["Login"],
    description: title,
  });

  it("folds undescribed check failures into the most severe scan rule for that check", () => {
    const merged = mergeManualIntoScan([
      f("manual:input-labels", "Inputs are missing a label or instructions", "high", ["3.3.2"]),
      f("manual:sr-name-role-value", "Screen reader doesn't announce some controls' name, role, or state", "high", ["4.1.2"]),
      f("rn-touchable-role", "Touchable has no accessibility role", "medium", ["4.1.2"]),
      f("rn-touchable-role", "Touchable has no accessibility role", "medium", ["4.1.2"]),
      f("rn-touchable-name", "Touchable has no accessible name", "high", ["4.1.2", "1.1.1"]),
      f("rn-input-label", "Text input has no accessible label", "high", ["3.3.2", "4.1.2", "1.3.1"]),
    ]);
    const group = (rule: string) => merged.find((x) => x.rule === rule)!.group;
    expect(group("manual:input-labels")).toBe("rn-input-label");
    // Not the more widespread Medium rule: that would raise its severity.
    expect(group("manual:sr-name-role-value")).toBe("rn-touchable-name");
    // Scan findings lead, so each group keeps the scan's title.
    expect(merged.findIndex((x) => x.rule.startsWith("manual:"))).toBe(4);
  });

  it("keeps findings testers described, and checks with no matching scan rule, separate", () => {
    const described = f("manual:input-labels", "Email field reads as edit box", "high", ["3.3.2"]);
    const keyboard = f("manual:keyboard-operable", "Not everything works with a keyboard, or focus gets trapped", "critical", ["2.1.1", "2.1.2"]);
    const merged = mergeManualIntoScan([described, keyboard, f("rn-input-label", "Text input has no accessible label", "high", ["3.3.2"])]);
    expect(merged.find((x) => x.title === described.title)!.group).toBe(described.group);
    expect(merged.find((x) => x.rule === "manual:keyboard-operable")!.group).toBe(keyboard.group);
  });
});
