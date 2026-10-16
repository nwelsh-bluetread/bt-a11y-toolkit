import { describe, expect, it } from "vitest";
import type { ScreenInfo } from "../src/code-scan/screens.js";
import { APP_WIDE, parseChecklist, planChecklist, renderChecklist, renderScanDetails } from "../src/wizard/checklist-md.js";
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
  const ios = md.slice(md.indexOf("# iOS"), md.indexOf("# Android"));
  const android = md.slice(md.indexOf("# Android"), md.indexOf("# Other findings"));
  /** A testing pass ("## 1. …") within a platform part. */
  const pass = (part: string, n: number) => {
    const at = part.indexOf(`## ${n}. `);
    const next = part.indexOf(`\n## ${n + 1}. `, at);
    return part.slice(at, next === -1 ? undefined : next);
  };
  /** One screen's block within a pass. */
  const screenIn = (passText: string, name: string) => {
    const at = passText.indexOf(`### ${name}\n`);
    if (at === -1) return "";
    const next = passText.indexOf("\n### ", at + 4);
    return passText.slice(at, next === -1 ? undefined : next);
  };

  it("is organized platform → two passes (screen reader & glance, keyboard) → screen → checks", () => {
    expect(md.indexOf("# iOS")).toBeLessThan(md.indexOf("# Android"));
    const passes = [...ios.matchAll(/^## (\d+\. .+)$/gm)].map((m) => m[1]);
    expect(passes).toEqual(["1. Screen reader & glance checks", "2. Keyboard"]);
    expect(ios).toMatch(/## 1\. Screen reader & glance checks\n\n> \*\*Setup:\*\* Set the Accessibility Shortcut to VoiceOver/);
    expect(android).toMatch(/## 1\. Screen reader & glance checks\n\n> \*\*Setup:\*\* Turn on the TalkBack shortcut/);
    expect(pass(ios, 2)).toMatch(/> \*\*Setup:\*\* Turn VoiceOver off\. Pair a Bluetooth keyboard/);
    // Within each screen of pass 1, checks are grouped by type, screen reader first; keyboard checks are only in pass 2.
    const login = screenIn(pass(ios, 1), "Login");
    const types = [...login.matchAll(/^#### (.+)$/gm)].map((m) => m[1]);
    expect(types).toEqual(["Screen reader", "Voice & switch control", "Visual, text size & orientation", "Touch & gestures", "Cognitive: content, forms & behavior"]);
    expect(login).not.toContain("`keyboard-operable`");
    expect(screenIn(pass(ios, 2), "Login")).toContain("`keyboard-operable`");
    expect(screenIn(pass(ios, 2), "Login")).not.toContain("#### ");
    const sr = pass(ios, 1);
    expect(sr.indexOf("### Login")).toBeLessThan(sr.indexOf("### Inbox"));
    expect(sr.indexOf("### Inbox")).toBeLessThan(sr.indexOf(`### ${APP_WIDE}`));
  });

  it("explains every check once per pass, with criteria by name and level and how to test", () => {
    const sr = pass(ios, 1);
    expect(sr).toContain(
      "- **1.6 Every input has a label or instructions (not just placeholder text)** — 3.3.2 Labels or Instructions (A). Focus each field with the screen reader.",
    );
    expect(sr).toContain("— 1.3.2 Meaningful Sequence (A) · 2.4.3 Focus Order (A).");
    expect(sr).toContain("*Only applies if the app has modals; none were found in the code, so mark N/A if there are none.*");
    expect(pass(android, 1)).toContain("Set Settings → Display → Font size");
  });

  it("lists, for each screen, only the checks that apply to it", () => {
    const login = screenIn(pass(ios, 1), "Login");
    const inbox = screenIn(pass(ios, 1), "Inbox");
    expect(login).toContain("- [ ] **1.2** Reading and focus order is logical and matches the visual layout · `focus-order`");
    expect(login).toContain("`input-labels`");
    expect(inbox).not.toContain("`input-labels`");
    expect(screenIn(pass(ios, 1), "Inbox")).toContain("`pointer-gestures`");
    expect(screenIn(pass(ios, 1), "Login")).not.toContain("`pointer-gestures`");
    expect(screenIn(pass(ios, 1), APP_WIDE)).toContain("`orientation`");
  });

  it("puts automated findings and signals under the check they belong to on that screen", () => {
    // A scan finding pre-marks the line as failing; a "Verify" signal leaves it for the tester.
    expect(screenIn(pass(ios, 1), "Login")).toContain(
      "- [!] **1.6** Every input has a label or instructions (not just placeholder text) · `input-labels` — scan found issues · not reviewed yet\n  ⚑ High · Text input has no accessible label — Login.tsx:12",
    );
    expect(screenIn(pass(ios, 1), "Inbox")).toMatch(/- \[ \] \*\*1\.\d+\*\* [^\n]*`pointer-gestures`\n {2}⚑ Verify · Gesture or drag: needs a single-tap alternative — Inbox\.tsx:7/);
    expect(screenIn(pass(ios, 1), APP_WIDE)).toMatch(/- \[!\] \*\*1\.\d+\*\* [^\n]*`orientation` — scan found issues · not reviewed yet\n {2}⚑ Medium · Screen orientation is locked — app\.json:4/);
  });

  it("collapses one issue across many files into a single line with severity, short paths, and +N more", () => {
    const files = ["A.js", "B.js", "C.js", "D.js", "E.js", "Card/index.js", "G.js"].map((f) => `src/components/${f}`);
    const shared: ScreenInfo = { name: "Scheduling", kind: "mobile", file: "src/Scheduling.js", files: ["src/Scheduling.js", ...files], features: [] };
    const many: AutomatedRun[] = [
      {
        tool: "rn-code-scan",
        targets: ["ios"],
        ranAt: "",
        findings: files.map((file, i) => ({
          ruleId: "rn-control-role",
          title: `Touchable has no accessibility role — ${file}`,
          description: "",
          severity: "medium" as const,
          wcag: wcag("4.1.2"),
          evidence: { file, lines: [i + 1] },
        })),
      },
    ];
    const out = renderChecklist({ projectName: "Acme", targetLevel: "AA", groups: planChecklist([shared], ["ios"], "AA"), runs: many });
    expect(out).toMatch(/### Scheduling\n\n#### Screen reader\n\n- \[!\] \*\*1\.1\*\* [^\n]*`sr-name-role-value` — scan found issues · not reviewed yet\n {2}⚑ Medium · Touchable has no accessibility role — A\.js:1, B\.js:2, C\.js:3, D\.js:4, E\.js:5 \+2 more\n/);
    const details = renderScanDetails({ projectName: "Acme", groups: planChecklist([shared], ["ios"], "AA"), runs: many });
    expect(details).toContain("  - `src/components/Card/index.js` line 6");
    expect(details).toContain("  - `src/components/G.js` line 7");
  });

  it("starts with an index of the screens in scope", () => {
    expect(md).toContain("## Screens in scope (2)");
    expect(md).toMatch(/- \*\*Login\*\* — `src\/Login\.tsx` · contains: form inputs, images, sign-in · ⚑ 1 automated finding/);
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

  it("carries answers from the earlier screen-first layout into the new one", () => {
    const groups = planChecklist(screens, ["ios", "android"], "AA");
    const regenerated = renderChecklist({ projectName: "Acme", targetLevel: "AA", groups, runs, previous: parsed });
    const android = regenerated.slice(regenerated.indexOf("# Android"), regenerated.indexOf("# Other findings"));
    expect(android).toMatch(/### Login\n[\s\S]*?- \[!\] \*\*1\.6\*\* [^\n]*`input-labels`: Email field is read as "edit box" \(critical\)\n {2}- Password field has no label either \[3\.3\.2\]/);
    expect(regenerated).toContain("- [!] iOS, Android · Inbox · 1.4.3 · Unread badge text is too light (medium)");
    const answered = (p: typeof parsed) =>
      p.rows.filter((r) => r.status !== "open").map((r) => `${r.target}|${r.itemId}|${r.screen ?? ""}|${r.status}|${JSON.stringify(r.issues)}`).sort();
    const reparsed = parseChecklist(regenerated);
    expect(answered(reparsed)).toEqual(answered(parsed));
    expect(reparsed.other).toHaveLength(1);
    // And it's stable: regenerating the new layout keeps the same answers.
    expect(answered(parseChecklist(renderChecklist({ projectName: "Acme", targetLevel: "AA", groups, runs, previous: reparsed })))).toEqual(answered(parsed));
  });

  it("doesn't duplicate pre-filled scan failures, and warns when a scan-flagged line is marked pass", () => {
    const md = [
      "# iOS",
      "## 1. Screen reader",
      "### Name, role, value · 4.1.2 · `sr-name-role-value`",
      "- [!] Login",
      "  ⚑ rn-code-scan: Touchable has no accessibility role (src/Login.tsx:18)",
      "- [!] Signup: Submit button reads as just \"button\" (high)",
      "  ⚑ rn-code-scan: Touchable has no accessibility role (src/Signup.tsx:4)",
      "- [x] InvoiceDetail",
      "  ⚑ rn-code-scan: Touchable has no accessibility role (src/components/ActiveRentalsList.js:18)",
      "- [x] Home",
      "  ⚑ Verify: Gesture interaction (src/Home.tsx:3)",
    ].join("\n");
    const parsed = parseChecklist(md);
    expect(parsed.rows.map((r) => [r.screen, r.status, Boolean(r.flagged)])).toEqual([
      ["Login", "fail", true],
      ["Signup", "fail", true],
      ["InvoiceDetail", "pass", true],
      ["Home", "pass", false],
    ]);
    // Only the tester's own note becomes a manual finding; the bare [!] is already the scan finding.
    expect(checklistFindings(parsed).map((f) => f.title)).toEqual(['Submit button reads as just "button"']);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toMatch(/1 line\(s\) are marked \[x\] pass, but an automated scan found an issue there.*iOS › InvoiceDetail › sr-name-role-value/);
  });

  it("tracks which scan pre-fills a tester has reviewed, and rebuilds untouched ones from the current scan", () => {
    const md = [
      "# iOS",
      "## 1. Screen reader",
      "### Name, role, value · 4.1.2 · `sr-name-role-value`",
      "- [!] **Login** — scan found issues · not reviewed yet",
      "  ⚑ High · Touchable has no accessible name — Login.tsx:10",
      "- [!] **Signup**",
      "  ⚑ High · Touchable has no accessible name — Signup.tsx:4",
      "- [!] **Inbox** — scan found issues · not reviewed yet: Swipe actions have no labels (high)",
      "  ⚑ Medium · Touchable has no accessibility role — Inbox.tsx:9",
    ].join("\n");
    const parsed = parseChecklist(md);
    expect(parsed.rows.map((r) => [r.screen, r.status, r.reviewed])).toEqual([
      ["Login", "fail", false], // untouched pre-fill
      ["Signup", "fail", undefined], // tester deleted the note: reviewed
      ["Inbox", "fail", undefined], // tester added their own finding: reviewed
    ]);
    expect(checklistFindings(parsed).map((f) => f.title)).toEqual(["Swipe actions have no labels"]);

    // On regenerate, a reviewed line is kept; an untouched pre-fill follows the current scan (here: fixed, so it's blank).
    const screensNow: ScreenInfo[] = ["Login", "Signup"].map((name) => ({ name, kind: "mobile", file: `src/${name}.tsx`, files: [`src/${name}.tsx`], features: [] }));
    const regenerated = renderChecklist({ projectName: "Acme", targetLevel: "AA", groups: planChecklist(screensNow, ["ios"], "AA"), runs: [], previous: parsed });
    const line = (screen: string) => {
      const at = regenerated.indexOf(`### ${screen}\n`);
      return regenerated.slice(at).split("\n").find((l) => l.includes("`sr-name-role-value`"))!;
    };
    expect(line("Login")).toBe("- [ ] **1.1** Screen reader announces the name, role, and state of every control · `sr-name-role-value`");
    expect(line("Signup")).toBe("- [!] **1.1** Screen reader announces the name, role, and state of every control · `sr-name-role-value`");
  });

  it("carries answers from the check-first layout (one check, many screens) into the screen-by-screen one", () => {
    const checkFirst = [
      "# iOS",
      "## 1. Screen reader",
      "### 1.6 **Every input has a label** · `input-labels`",
      "- [x] **Login**",
      "- [!] **Signup**: Email field has no label (high)",
      "### 1.1 **Name, role, value** · `sr-name-role-value`",
      "- [-] **App-wide**",
    ].join("\n");
    const before = parseChecklist(checkFirst);
    const two: ScreenInfo[] = ["Login", "Signup"].map((name) => ({ name, kind: "mobile", file: `src/${name}.tsx`, files: [`src/${name}.tsx`], features: ["inputs"] }));
    const after = parseChecklist(renderChecklist({ projectName: "A", targetLevel: "AA", groups: planChecklist(two, ["ios"], "AA"), runs: [], previous: before }));
    const answered = (p: typeof before) => p.rows.filter((r) => r.status !== "open").map((r) => [r.screen, r.itemId, r.status, r.issues.map((i) => i.text)]);
    expect(answered(after)).toEqual(
      expect.arrayContaining([
        ["Login", "input-labels", "pass", []],
        ["Signup", "input-labels", "fail", ["Email field has no label"]],
      ]),
    );
  });

  it("reads the new layout: screen labels, App-wide, and issues", () => {
    const md = [
      "# iOS",
      "## 1. Screen reader",
      "### Every input has a label · 3.3.2 · `input-labels`",
      "- [x] Login",
      "- [!] Terms & Privacy: Checkbox has no label [3.3.2] (high)",
      "  - Second field too",
      "# Android",
      "## 3. Visual",
      "### Orientation · 1.3.4 · `orientation`",
      "- [-] App-wide",
    ].join("\n");
    const rows = parseChecklist(md).rows;
    expect(rows.map((r) => [r.target, r.itemId, r.screen, r.status])).toEqual([
      ["ios", "input-labels", "Login", "pass"],
      ["ios", "input-labels", "Terms & Privacy", "fail"],
      ["android", "orientation", undefined, "na"],
    ]);
    expect(rows[1]!.issues).toEqual([{ text: "Checkbox has no label", wcag: ["3.3.2"], severity: "high" }, { text: "Second field too" }]);
  });
});
