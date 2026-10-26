import { describe, expect, it } from "vitest";
import type { ScreenInfo } from "../src/code-scan/screens.js";
import { formatMarkdown } from "../src/report.js";
import { parseChecklist, planChecklist, renderChecklist } from "../src/wizard/checklist-md.js";
import { buildCoverage } from "../src/wizard/coverage.js";
import { comparePlatforms, formatPlatformMarkdown } from "../src/wizard/platforms.js";
import { blockedScreens, buildSessionAssessment, newSession, type AutomatedRun } from "../src/wizard/session.js";
import { wcag } from "../src/wcag.js";

const screens: ScreenInfo[] = [
  { name: "Home", kind: "mobile", file: "src/Home.tsx", files: ["src/Home.tsx"] },
  { name: "Billing", kind: "mobile", file: "src/Billing.tsx", files: ["src/Billing.tsx"] },
];
const runs: AutomatedRun[] = [
  {
    tool: "rn-code-scan",
    targets: ["ios", "android"],
    ranAt: "",
    findings: [{ ruleId: "rn-control-role", title: "Touchable has no accessibility role — src/Home.tsx", description: "", severity: "medium", wcag: wcag("4.1.2"), platforms: ["ios", "android"], source: "rn-code-scan", evidence: { file: "src/Home.tsx", lines: [3] } }],
  },
  {
    tool: "device-target-size",
    targets: ["android"],
    ranAt: "",
    findings: [{ ruleId: "device-target-size", title: "Touch target smaller than 24×24 dp — Billing", description: "", severity: "medium", wcag: wcag("2.5.8"), platforms: ["android"], source: "device", evidence: { screen: "Billing" } }],
  },
];

function setup() {
  const session = newSession({ name: "T", type: "mobile", targets: ["ios", "android"], targetLevel: "AA" }, screens);
  session.automated = runs;
  const md = renderChecklist({ projectName: "T", targetLevel: "AA", groups: planChecklist(screens, ["ios", "android"], "AA"), runs: [] });
  // Keyboard fails on Home on both platforms (different wording); contrast fails on Billing on iOS only; 2.2.2 passes on iOS, fails on Android.
  const ios = md.indexOf("# iOS");
  const android = md.indexOf("# Android");
  const mark = (part: string, screen: string, id: string, replacement: string) =>
    part.replace(new RegExp(`(### ${screen}\\n[\\s\\S]*?)- \\[ \\] (\\*\\*[^\\n]*?\`${id}\`)`), `$1- [${replacement.slice(0, 1)}] $2${replacement.slice(1)}`);
  let iosPart = md.slice(ios, android);
  let androidPart = md.slice(android);
  iosPart = mark(iosPart, "Home", "keyboard-operable", "!: Tab skips the menu (critical)");
  iosPart = mark(iosPart, "Billing", "contrast", "!: Grey total on white (high)");
  androidPart = mark(androidPart, "Home", "keyboard-operable", "!: Stuck in the date picker (critical)");
  const checklist = parseChecklist(md.slice(0, ios) + iosPart + androidPart, screens.map((s) => s.name));
  const assessment = buildSessionAssessment(session, checklist);
  const coverage = buildCoverage(session, checklist);
  return { session, checklist, assessment, coverage };
}

describe("comparePlatforms", () => {
  it("matches problems across platforms by check and screen, and lists the platform-only ones", () => {
    const { session, checklist, assessment, coverage } = setup();
    const c = comparePlatforms(assessment.findings, checklist, coverage, blockedScreens(checklist), ["ios", "android"], session.automated)!;
    // Keyboard on Home (both), the code-scan role finding (shared code = both).
    expect(c.shared).toBe(2);
    expect(c.only.ios!.map((i) => [i.title, i.screens])).toEqual([["Text contrast is 4.5:1 (3:1 large text); icons and UI borders 3:1", ["Billing"]]]);
    expect(c.only.android!.map((i) => i.screens)).toEqual([["Billing"]]);
    expect(c.measuredOnly).toEqual([{ tool: "On-device touch target measurement", targets: ["android"] }]);
    expect(c.summaries.map((s) => [s.target, s.checks.failed])).toEqual([["ios", 2], ["android", 1]]);
    expect(c.criteria.find((r) => r.id === "1.4.3")!.byTarget).toEqual({ ios: "fail", android: "not-tested" });

    const md = formatPlatformMarkdown(c);
    expect(md).toContain("## iOS vs Android");
    expect(md).toContain("**2** problems were found on both platforms; **1** only on iOS, **1** only on Android.");
    expect(md).toContain("### Only on iOS");
    expect(md).toContain("On-device touch target measurement ran on Android only");
  });

  it("is skipped for a single platform", () => {
    const { checklist, assessment, coverage } = setup();
    expect(comparePlatforms(assessment.findings, checklist, coverage, [], ["ios"])).toBeUndefined();
  });

  it("tags finding headings with their platforms", () => {
    const { assessment } = setup();
    const md = formatMarkdown(assessment);
    expect(md).toContain("- **Platform:** iOS, Android");
    expect(md).toMatch(/### 🟠 Grey total on white · iOS only/);
    expect(md).toMatch(/### 🟡 Touchable has no accessibility role — src\/Home\.tsx · iOS \+ Android/);
    expect(md).toContain("- **Platforms:** iOS, Android");
  });
});
