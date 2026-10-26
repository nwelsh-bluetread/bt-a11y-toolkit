import { describe, expect, it } from "vitest";
import { emptyChecklist, parseChecklist, type ParsedChecklist } from "../src/wizard/checklist-md.js";
import { buildCoverage, coverageSummaryLines, criterionResult, formatCoverageMarkdown, levelResults } from "../src/wizard/coverage.js";
import { newSession, type AuditSession } from "../src/wizard/session.js";
import { wcag } from "../src/wcag.js";

function session(overrides: Partial<AuditSession> = {}): AuditSession {
  return { ...newSession({ name: "T", type: "both", targets: ["web", "ios"], targetLevel: "AA" }), ...overrides };
}
const cell = (s: AuditSession, id: string, target: "web" | "ios", parsed: ParsedChecklist = emptyChecklist()) =>
  buildCoverage(s, parsed).rows.find((r) => r.id === id)!.byTarget[target]!;

/** A checklist with the given rows under one mobile screen. */
function checklist(rows: Array<[itemId: string, mark: string]>, screen = "Login"): ParsedChecklist {
  const body = rows.map(([id, mark]) => `### Check · \`${id}\`\n- [${mark}] iOS`).join("\n\n");
  return parseChecklist(`# Mobile app — iOS\n\n## Screen: ${screen}\n\n${body}\n`);
}

describe("buildCoverage", () => {
  it("scopes rows to the target level", () => {
    expect(buildCoverage(session(), emptyChecklist()).rows).toHaveLength(55);
    expect(buildCoverage(session(), emptyChecklist()).outOfScope).toBe(31);
    const aaa = session();
    aaa.project.targetLevel = "AAA";
    expect(buildCoverage(aaa, emptyChecklist()).rows).toHaveLength(86);
  });

  it("starts applicable criteria as not tested, and web-only ones as not applicable on mobile", () => {
    expect(cell(session(), "4.1.2", "ios").status).toBe("not-tested");
    expect(cell(session(), "2.4.1", "web").status).toBe("not-tested");
    expect(cell(session(), "2.4.1", "ios").status).toBe("not-applicable");
  });

  it("marks scanned criteria scan-clear until confirmed, and fails on findings for that platform only", () => {
    const s = session({
      automated: [
        {
          tool: "rn-code-scan",
          targets: ["ios"],
          ranAt: "",
          checked: ["1.4.4", "4.1.2"],
          findings: [{ ruleId: "x", title: "x", description: "", severity: "high", wcag: wcag("4.1.2"), platforms: ["ios"] }],
        },
      ],
    });
    expect(cell(s, "1.4.4", "ios").status).toBe("scan-clear");
    expect(cell(s, "4.1.2", "ios")).toMatchObject({ status: "fail", findings: 1 });
    expect(cell(s, "4.1.2", "web").status).toBe("not-tested");
  });

  it("passes a criterion only when every screen's row is answered, and N/As when all are N/A", () => {
    // 2.4.3 is covered by "focus-order" (every screen) and "modal-focus".
    expect(cell(session(), "1.4.3", "ios", checklist([["contrast", "x"]])).status).toBe("pass");
    expect(cell(session(), "1.2.2", "ios", checklist([["captions", "-"]])).status).toBe("na");
    expect(cell(session(), "2.4.3", "ios", checklist([["focus-order", "x"], ["modal-focus", " "]])).status).toBe("not-tested");
    expect(cell(session(), "2.4.3", "ios", checklist([["focus-order", "x"], ["modal-focus", "x"]])).status).toBe("pass");
  });

  it("fails a criterion from a checklist failure, unless the issue was narrowed to another criterion", () => {
    const failed = parseChecklist("# Mobile app — iOS\n\n## Screen: Login\n\n### C · `focus-order`\n- [!] iOS: Focus jumps [1.3.2]\n");
    expect(cell(session(), "1.3.2", "ios", failed).status).toBe("fail");
    expect(cell(session(), "2.4.3", "ios", failed).status).toBe("pass");
  });

  it("counts scan failures nobody has reviewed yet", () => {
    const s = session({
      automated: [
        { tool: "rn-code-scan", targets: ["ios"], ranAt: "", findings: [{ ruleId: "x", title: "x", description: "", severity: "high", wcag: wcag("4.1.2"), platforms: ["ios"] }] },
      ],
    });
    const parsed = parseChecklist(
      "# iOS\n## 1. Screen reader\n### C · `sr-name-role-value`\n- [!] **Login** — scan found issues · not reviewed yet\n  ⚑ High · x — a.tsx:1\n- [!] **Inbox**\n  ⚑ High · x — b.tsx:1\n",
    );
    const coverage = buildCoverage(s, parsed);
    expect(coverage.rows.find((r) => r.id === "4.1.2")!.byTarget.ios).toMatchObject({ status: "fail", unreviewed: 1 });
    expect(formatCoverageMarkdown(coverage)).toMatch(/4\.1\.2 Name, Role, Value \| A \| ⬜ Not tested \| ❌ Fail \(1\) · 1 not reviewed/);
    expect(coverageSummaryLines(coverage)[1]).toMatch(/^iOS: 1 fail \(1 found only by the scan, not yet reviewed\)/);
  });

  it("summarizes counts per platform", () => {
    const [web, ios] = coverageSummaryLines(buildCoverage(session(), emptyChecklist()));
    expect(web).toBe("Website: 55 not tested");
    expect(ios).toMatch(/^iOS: \d+ not tested · 3 web only$/);
  });

  it("says why a criterion is N/A: no such content, or web only", () => {
    expect(cell(session(), "2.4.1", "ios")).toMatchObject({ status: "not-applicable", reason: "Web only: doesn't apply to native apps" });
    const parsed = checklist([["captions", "-"], ["sr-name-role-value", "-"]]);
    expect(cell(session(), "1.2.2", "ios", parsed)).toMatchObject({ status: "na", reason: "No audio/video in the app" });
    expect(cell(session(), "4.1.2", "ios", parsed)).toMatchObject({ status: "na", reason: "Marked not applicable by testers" });
  });
});

describe("criterion results by level", () => {
  const mobile = () => ({ ...newSession({ name: "T", type: "mobile" as const, targets: ["ios" as const], targetLevel: "AA" as const }) });

  it("combines platforms into one result per criterion", () => {
    const parsed = checklist([["captions", "-"], ["sr-name-role-value", "x"], ["color-alone", "!"]]);
    const rows = buildCoverage(mobile(), parsed).rows;
    const result = (id: string) => criterionResult(rows.find((r) => r.id === id)!);
    expect(result("1.2.2")).toEqual({ result: "na", reason: "No audio/video in the app" });
    expect(result("2.4.1")).toEqual({ result: "platform-na", reason: "Web only: doesn't apply to native apps" });
    expect(result("4.1.2").result).toBe("pass");
    expect(result("1.4.1").result).toBe("fail");
    expect(result("3.3.2").result).toBe("not-verified");

    const both = buildCoverage(session(), checklist([["sr-name-role-value", "x"]])).rows.find((r) => r.id === "4.1.2")!;
    expect(criterionResult(both)).toEqual({ result: "not-verified", note: "Passes on iOS so far" });
  });

  it("counts each level on its own and shows it in the report", () => {
    const coverage = buildCoverage(mobile(), checklist([["captions", "-"]]));
    const [a, aa] = levelResults(coverage);
    expect(a).toMatchObject({ level: "A", total: 31, counts: { na: 1, "platform-na": 1 } });
    expect(aa).toMatchObject({ level: "AA", counts: { "platform-na": 2 } });
    expect(a!.counts.pass + a!.counts.fail + a!.counts.na + a!.counts["platform-na"] + a!.counts["not-verified"]).toBe(31);
    const md = formatCoverageMarkdown(coverage);
    expect(md).toContain("| Level | Pass | Fail | N/A | Web only | Not yet verified | Criteria |");
    expect(md).toContain("➖ N/A: no such content (No audio/video)");
    expect(md).toContain("| 2.4.1 Bypass Blocks | A | 🌐 Web only |");
  });
});

describe("sessionWcagRollup", () => {
  it("counts code-scan findings even when every checklist line is marked pass, and skips levels above the target", async () => {
    const { planChecklist, renderChecklist } = await import("../src/wizard/checklist-md.js");
    const { sessionWcagRollup, buildSessionAssessment } = await import("../src/wizard/session.js");
    const { formatConsole } = await import("../src/report.js");
    const s = newSession({ name: "T", type: "mobile", targets: ["ios", "android"], targetLevel: "AA" }, [
      { name: "Login", kind: "mobile", file: "src/Login.tsx", files: ["src/Login.tsx"], features: ["inputs"] },
    ]);
    s.automated = [
      {
        tool: "rn-code-scan",
        targets: ["ios", "android"],
        ranAt: "",
        checked: ["1.4.4", "4.1.2"],
        findings: [
          { ruleId: "rn-font-scaling", title: "Font scaling disabled", description: "", severity: "high", wcag: wcag("1.4.4"), platforms: ["ios", "android"], evidence: { file: "src/Login.tsx" } },
          { ruleId: "rn-control-role", title: "No role", description: "", severity: "medium", wcag: wcag("4.1.2"), platforms: ["ios", "android"], evidence: { file: "src/Login.tsx" } },
        ],
      },
    ];
    // A tester marks every single line as passing.
    const md = renderChecklist({ projectName: "T", targetLevel: "AA", groups: planChecklist(s.screens, s.project.targets, "AA"), runs: s.automated });
    const allPass = parseChecklist(md.replace(/- \[ \]/g, "- [x]"));

    const rollup = sessionWcagRollup(s, allPass);
    expect(rollup.A).toBeLessThan(100); // 4.1.2 fails at Level A
    expect(rollup.AA).toBeLessThan(rollup.A!); // 1.4.4 fails too at AA
    expect(rollup.AAA).toBeUndefined();

    const console = formatConsole(buildSessionAssessment(s, allPass));
    expect(console).toMatch(/WCAG A:\s+\d+%/);
    expect(console).toContain("WCAG AAA:   not assessed");
  });

  it("reports nothing until some criterion is actually verified", async () => {
    const { sessionWcagRollup } = await import("../src/wizard/session.js");
    expect(sessionWcagRollup(session(), emptyChecklist())).toEqual({});
  });
});
