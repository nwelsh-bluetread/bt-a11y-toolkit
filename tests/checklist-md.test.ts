import { describe, expect, it } from "vitest";
import type { ScreenInfo } from "../src/code-scan/screens.js";
import { APP_WIDE, parseChecklist, planChecklist, renderChecklist } from "../src/wizard/checklist-md.js";
import { checklistFindings, type AutomatedRun } from "../src/wizard/session.js";
import { wcag } from "../src/wcag.js";

const screens: ScreenInfo[] = [
  { name: "Login", kind: "mobile", file: "src/Login.tsx", files: ["src/Login.tsx", "src/Logo.tsx"], features: ["inputs", "images", "auth"] },
  { name: "Inbox", kind: "mobile", file: "src/Inbox.tsx", files: ["src/Inbox.tsx", "src/Logo.tsx"], features: ["images", "gestures"] },
];

const runs: AutomatedRun[] = [
  {
    tool: "rn-code-scan",
    targets: ["ios", "android"],
    ranAt: "",
    signals: [{ id: "gestures", criteria: ["2.5.1", "2.5.7"], message: "Gesture interaction", locations: [{ file: "src/Inbox.tsx", line: 7 }] }],
    findings: [
      {
        ruleId: "rn-input-label",
        title: "Text input has no accessible label — src/Login.tsx",
        description: "",
        severity: "high",
        wcag: wcag("3.3.2", "4.1.2"),
        nodeId: "src/Login.tsx:12",
        evidence: { file: "src/Login.tsx", lines: [12] },
      },
      {
        ruleId: "rn-orientation-lock",
        title: "Screen orientation is locked — app.json",
        description: "",
        severity: "medium",
        wcag: wcag("1.3.4"),
        evidence: { file: "app.json", lines: [4] },
      },
    ],
  },
];

describe("planChecklist", () => {
  const [group] = planChecklist(screens, ["ios", "android"], "AA");
  const section = (heading: string) => group!.sections.find((s) => s.heading === heading)!;
  const ids = (heading: string) => section(heading).checks.map((c) => c.item.id);

  it("gives each screen its per-screen checks plus feature checks for what it contains", () => {
    expect(group!.title).toBe("Mobile app — iOS + Android");
    expect(ids("Screen: Login")).toEqual(expect.arrayContaining(["sr-name-role-value", "input-labels", "alt-text-meaningful", "accessible-auth"]));
    expect(ids("Screen: Login")).not.toContain("pointer-gestures");
    expect(ids("Screen: Inbox")).toEqual(expect.arrayContaining(["pointer-gestures", "dragging"]));
    expect(ids("Screen: Inbox")).not.toContain("input-labels");
  });

  it("puts app-level checks, and feature checks no screen needs, in one app-wide section", () => {
    const appWide = section(APP_WIDE).checks;
    expect(appWide.map((c) => c.item.id)).toEqual(expect.arrayContaining(["orientation", "language", "captions"]));
    expect(appWide.find((c) => c.item.id === "captions")!.ifPresent).toEqual(["media"]);
    expect(appWide.find((c) => c.item.id === "orientation")!.ifPresent).toBeUndefined();
    expect(appWide.map((c) => c.item.id)).not.toContain("input-labels");
  });

  it("plans web pages separately, with feature checks app-wide (page contents aren't known)", () => {
    const groups = planChecklist([...screens, { name: "/", kind: "web", url: "https://acme.test/" }], ["ios", "android", "web"], "AA");
    const web = groups.find((g) => g.kind === "web")!;
    expect(web.targets).toEqual(["web"]);
    expect(web.sections.map((s) => s.heading)).toEqual(["Page: /", APP_WIDE]);
    expect(web.sections[1]!.checks.map((c) => c.item.id)).toContain("input-labels");
  });
});

describe("renderChecklist", () => {
  const groups = planChecklist(screens, ["ios", "android"], "AA");
  const md = renderChecklist({ projectName: "Acme", targetLevel: "AA", groups, runs });

  it("writes per-screen sections with a mark line per platform and how-to steps", () => {
    expect(md).toContain("## Screen: Login");
    expect(md).toContain("### Every input has a label or instructions (not just placeholder text) · 3.3.2 · `input-labels`\n- [ ] iOS\n- [ ] Android");
    expect(md).toMatch(/How to test \(iOS\): Turn on VoiceOver/);
  });

  it("shows automated findings and signals under the matching check on the right screen", () => {
    const login = md.slice(md.indexOf("## Screen: Login"), md.indexOf("## Screen: Inbox"));
    expect(login).toContain("⚑ rn-code-scan: Text input has no accessible label (src/Login.tsx:12)");
    const inbox = md.slice(md.indexOf("## Screen: Inbox"), md.indexOf(`## ${APP_WIDE}`));
    expect(inbox).toContain("⚑ Verify: Gesture interaction (src/Inbox.tsx:7)");
    expect(inbox).not.toContain("Text input has no accessible label");
    const appWide = md.slice(md.indexOf(`## ${APP_WIDE}`));
    expect(appWide).toContain("⚑ rn-code-scan: Screen orientation is locked (app.json:4)");
  });
});

describe("parseChecklist", () => {
  const filled = `# Accessibility checklist — Acme

# Mobile app — iOS + Android

## Screen: Login

### Every input has a label or instructions (not just placeholder text) · 3.3.2 · \`input-labels\`
- [x] iOS
- [!] Android: Email field is read as "edit box" (critical)
  - Password field has no label either [3.3.2]

### Screen reader announces the name, role, and state of every control · 4.1.2 · \`sr-name-role-value\`
- [-] iOS
- [ ] Android

## ${APP_WIDE}

### Works in both portrait and landscape (not locked unless essential) · 1.3.4 · \`orientation\`
- [!] iOS
- [?] Android

# Other findings

Issues that don't fit a check above — one per line.

<!-- Example: - [!] iOS · Login · 1.4.3 · ignored -->
- [!] iOS, Android · Inbox · 1.4.3 · Unread badge text is too light (medium)
- not a valid line
`;
  const parsed = parseChecklist(filled);

  it("reads marks, issues, severities, and narrowed criteria", () => {
    const row = (itemId: string, target: string) => parsed.rows.find((r) => r.itemId === itemId && r.target === target)!;
    expect(row("input-labels", "ios").status).toBe("pass");
    expect(row("input-labels", "android")).toMatchObject({
      status: "fail",
      screen: "Login",
      issues: [
        { text: 'Email field is read as "edit box"', severity: "critical" },
        { text: "Password field has no label either", wcag: ["3.3.2"] },
      ],
    });
    expect(row("sr-name-role-value", "ios").status).toBe("na");
    expect(row("sr-name-role-value", "android").status).toBe("open");
    expect(row("orientation", "ios")).toMatchObject({ status: "fail", screen: undefined });
  });

  it("reads Other findings and reports lines it can't understand", () => {
    expect(parsed.other).toEqual([
      { text: "Unread badge text is too light", severity: "medium", platforms: ["ios", "android"], screen: "Inbox", wcag: ["1.4.3"] },
    ]);
    expect(parsed.warnings.join("\n")).toMatch(/unknown mark "\[\?\]"/);
    expect(parsed.warnings.join("\n")).toMatch(/couldn't read this "Other findings" line/);
  });

  it("turns failures into findings tagged with the screen and platform", () => {
    const findings = checklistFindings(parsed);
    expect(findings).toHaveLength(4);
    expect(findings[0]).toMatchObject({
      ruleId: "manual:input-labels",
      title: 'Email field is read as "edit box"',
      severity: "critical",
      platforms: ["android"],
      nodeId: "Login",
      evidence: { screen: "Login" },
    });
    expect(findings[2]).toMatchObject({ ruleId: "manual:orientation", nodeId: "App-wide", severity: "medium" });
    expect(findings[3]).toMatchObject({ ruleId: "manual:other", platforms: ["ios", "android"], wcag: [{ id: "1.4.3" }] });
  });

  it("keeps answers and Other findings when the file is regenerated", () => {
    const groups = planChecklist(screens, ["ios", "android"], "AA");
    const regenerated = renderChecklist({ projectName: "Acme", targetLevel: "AA", groups, runs, previous: parsed });
    expect(regenerated).toContain('- [!] Android: Email field is read as "edit box" (critical)\n  - Password field has no label either [3.3.2]');
    expect(regenerated).toContain("- [-] iOS");
    expect(regenerated).toContain("- [!] iOS, Android · Inbox · 1.4.3 · Unread badge text is too light (medium)");
    const reparsed = parseChecklist(regenerated);
    const answered = (p: typeof parsed) =>
      p.rows.filter((r) => r.status !== "open").map((r) => `${r.section}|${r.itemId}|${r.target}|${r.status}|${r.issues.length}`).sort();
    expect(answered(reparsed)).toEqual(answered(parsed));
    expect(reparsed.other).toHaveLength(1);
  });
});
