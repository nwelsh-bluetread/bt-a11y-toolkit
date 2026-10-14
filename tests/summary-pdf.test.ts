import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findingsToAssessment } from "../src/audit.js";
import { buildSummaryData, rendererPath, summaryPdfName } from "../src/pdf/summary.js";
import type { Finding } from "../src/types.js";
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
