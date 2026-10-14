import { describe, expect, it } from "vitest";
import { emptyChecklist, parseChecklist, type ParsedChecklist } from "../src/wizard/checklist-md.js";
import { buildCoverage, coverageSummaryLines } from "../src/wizard/coverage.js";
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

  it("summarizes counts per platform", () => {
    const [web, ios] = coverageSummaryLines(buildCoverage(session(), emptyChecklist()));
    expect(web).toBe("Website: 55 not tested");
    expect(ios).toMatch(/^iOS: \d+ not tested · \d+ don't apply$/);
  });
});
