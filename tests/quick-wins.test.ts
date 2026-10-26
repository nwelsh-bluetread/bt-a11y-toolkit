import { describe, expect, it } from "vitest";
import type { ScreenInfo } from "../src/code-scan/screens.js";
import type { Finding } from "../src/types.js";
import { parseChecklist, planChecklist, renderChecklist } from "../src/wizard/checklist-md.js";
import { buildQuickWins, componentName, familyOf, formatQuickWinsMarkdown, topQuickWins } from "../src/wizard/quick-wins.js";
import { newSession } from "../src/wizard/session.js";
import { wcag } from "../src/wcag.js";

const screens: ScreenInfo[] = [
  { name: "Home", kind: "mobile", file: "src/Home.tsx", files: ["src/Home.tsx", "src/StyledModal.tsx", "src/Dropdown/index.tsx"] },
  { name: "Billing", kind: "mobile", file: "src/Billing.tsx", files: ["src/Billing.tsx", "src/StyledModal.tsx", "src/ConfirmModal.tsx"] },
  { name: "Login", kind: "mobile", file: "src/Login.tsx", files: ["src/Login.tsx"] },
];
const finding = (ruleId: string, file: string, ids: string[], lines = [1]): Finding => ({
  ruleId,
  title: `${ruleId} issue — ${file}`,
  description: "",
  severity: "high",
  wcag: wcag(...ids),
  platforms: ["ios", "android"],
  source: "rn-code-scan",
  evidence: { file, lines },
});

function audit(edit: (md: string) => string = (md) => md) {
  const session = newSession({ name: "T", type: "mobile", targets: ["ios", "android"], targetLevel: "AA" }, screens);
  session.automated = [
    {
      tool: "rn-code-scan",
      targets: ["ios", "android"],
      ranAt: "",
      findings: [
        finding("rn-control-name", "src/StyledModal.tsx", ["4.1.2"], [10, 20]),
        finding("rn-control-name", "src/ConfirmModal.tsx", ["4.1.2"]),
        finding("rn-orientation-lock", "App.tsx", ["1.3.4"]),
        finding("rn-font-scaling", "src/Login.tsx", ["1.4.4"]),
        finding("rn-font-scaling-cap", "src/Login.tsx", ["1.4.4"]),
      ],
    },
  ];
  const md = renderChecklist({ projectName: "T", targetLevel: "AA", groups: planChecklist(screens, ["ios", "android"], "AA"), runs: session.automated });
  return { session, checklist: parseChecklist(edit(md), screens.map((s) => s.name)) };
}

describe("quick wins", () => {
  it("names components and families from their files", () => {
    expect(componentName("src/Dropdown/index.tsx")).toBe("Dropdown");
    expect(componentName("src/components/StyledModal.tsx")).toBe("StyledModal");
    expect(familyOf("CountryPicker")).toBe("Dropdowns & pickers");
    expect(familyOf("StyledModal")).toBe("Modals");
    expect(familyOf("Home")).toBeUndefined();
  });

  it("counts the checks and criteria a fix clears", () => {
    const { session, checklist } = audit();
    const wins = buildQuickWins(session, checklist);
    const modal = wins.components.find((w) => w.name === "StyledModal")!;
    // 4.1.2 on Home and Billing, iOS and Android. Billing also has ConfirmModal, so only Home clears.
    expect(modal).toMatchObject({ screens: 2, locations: 2, checksCleared: 2, criteriaFixed: [], quickWin: true });
    const family = wins.families.find((w) => w.name === "Modals")!;
    expect(family).toMatchObject({ members: ["StyledModal", "ConfirmModal"], checksCleared: 4, criteriaFixed: ["4.1.2"] });
    // App.tsx isn't in any screen: it affects the whole app.
    expect(wins.components.find((w) => w.name === "App")).toMatchObject({ screens: 3, criteriaFixed: ["1.3.4"] });
  });

  it("offers rules that fail the same checks as one fix", () => {
    const { session, checklist } = audit();
    const wins = buildQuickWins(session, checklist);
    const bundle = wins.issues.find((w) => w.name.startsWith("Font scaling turned off or capped"))!;
    expect(bundle).toMatchObject({ checksCleared: 2, criteriaFixed: ["1.4.4"] });
    // Either half alone clears nothing (it may still raise the score).
    expect(wins.issues.find((w) => w.name === "rn-font-scaling issue")?.checksCleared ?? 0).toBe(0);
  });

  it("leaves failures a tester described, and skips fixes covered by a bigger one", () => {
    const { session, checklist } = audit((md) => md.replace(/(### Home\n[\s\S]*?- \[)!(\] \*\*4\.1\.2\*\*[^\n]*?`sr-name-role-value`)[^\n]*/, "$1!$2: Close icon reads as \"button\" (high)"));
    const modal = buildQuickWins(session, checklist).components.find((w) => w.name === "StyledModal");
    expect(modal?.checksCleared ?? 0).toBe(1);
    const fresh = audit();
    const top = topQuickWins(buildQuickWins(fresh.session, fresh.checklist));
    // StyledModal and the control-name issue type are both inside "all modals", which ranks above them.
    expect(top.map((w) => w.name)).toContain("Modals");
    expect(top.map((w) => w.name)).not.toContain("StyledModal");
    expect(formatQuickWinsMarkdown(buildQuickWins(session, checklist))).toContain("## Fix these first");
  });
});

describe("shared component issues", () => {
  it("lists components used on several screens with their issues, most widely used first", async () => {
    const { sharedComponents, issueText } = await import("../src/wizard/shared-components.js");
    const { session } = audit();
    const list = sharedComponents(screens, session.automated.flatMap((r) => r.findings));
    // StyledModal is on Home and Billing; ConfirmModal and Login.tsx are on one screen each, App.tsx on none.
    expect(list.map((c) => [c.name, c.screens])).toEqual([["StyledModal", ["Home", "Billing"]]]);
    expect(issueText(list[0]!.issues[0]!)).toBe("High · rn-control-name issue (lines 10, 20)");
  });

  it("goes in the checklist (where the GUI reads it) and the report", async () => {
    const { session, checklist } = audit();
    const md = renderChecklist({ projectName: "T", targetLevel: "AA", groups: planChecklist(screens, ["ios", "android"], "AA"), runs: session.automated });
    expect(md).toContain("## Shared components with issues (1)");
    expect(md).toContain("| `StyledModal` (src/StyledModal.tsx) | 2 screens | High · rn-control-name issue (lines 10, 20) | 4.1.2 |");
    expect(parseChecklist(md).warnings).toEqual([]);

    const { readFileSync } = await import("node:fs");
    const html = readFileSync(new URL("../assets/checklist-ui/checklist.html", import.meta.url), "utf8");
    const core = html.slice(html.indexOf("// <core>"), html.indexOf("// </core>"));
    const ui = new Function(`${core}; return { parseDoc, serialize };`)() as { parseDoc(t: string): { sharedRows: string[][] }; serialize(d: unknown): string };
    const doc = ui.parseDoc(md);
    expect(doc.sharedRows).toEqual([["`StyledModal` (src/StyledModal.tsx)", "2 screens", "High · rn-control-name issue (lines 10, 20)", "4.1.2"]]);
    expect(ui.serialize(doc)).toBe(md);

    const { formatSharedComponentsMarkdown, sharedComponents } = await import("../src/wizard/shared-components.js");
    const { checksClearedByFile } = await import("../src/wizard/quick-wins.js");
    const list = sharedComponents(screens, session.automated.flatMap((r) => r.findings));
    const report = formatSharedComponentsMarkdown(list, checksClearedByFile(session, checklist, list.map((c) => c.file)));
    expect(report).toContain("| **StyledModal**<br>`src/StyledModal.tsx` | 2 screens | High · rn-control-name issue (lines 10, 20) | 4.1.2 | 2 |");
  });
});
