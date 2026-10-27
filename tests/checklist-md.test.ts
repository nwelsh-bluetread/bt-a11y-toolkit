import { describe, expect, it } from "vitest";
import type { ScreenInfo } from "../src/code-scan/screens.js";
import { APP_WIDE, classifyIssueText, navPath, parseChecklist, parseScreenHeading, planChecklist, renderChecklist, renderScanDetails, type ChecklistRow } from "../src/wizard/checklist-md.js";
import { blockedScreens, checklistFindings, formatBlockedMarkdown, type AutomatedRun } from "../src/wizard/session.js";
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
  /** One screen's block within a platform part. */
  const screenIn = (part: string, name: string) => {
    const at = part.indexOf(`### ${name}\n`);
    if (at === -1) return "";
    const next = part.indexOf("\n### ", at + 4);
    return part.slice(at, next === -1 ? undefined : next);
  };

  it("is one section per platform, screen by screen, every check grouped by tool with keyboard last", () => {
    expect(md.indexOf("# iOS")).toBeLessThan(md.indexOf("# Android"));
    expect([...ios.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(["All checks, screen by screen"]);
    expect(ios).toMatch(/## All checks, screen by screen\n\n> \*\*Setup:\*\* Pair a Bluetooth keyboard and leave it connected\. Set the Accessibility Shortcut/);
    expect(android).toMatch(/> \*\*Setup:\*\* Pair a Bluetooth or USB keyboard and leave it connected\. Turn on the TalkBack shortcut/);
    const login = screenIn(ios, "Login");
    expect([...login.matchAll(/^#### (.+)$/gm)].map((m) => m[1])).toEqual([
      "Screen reader",
      "Voice & switch control",
      "Visual, text size & orientation",
      "Touch & gestures",
      "Cognitive: content, forms & behavior",
      "Keyboard",
    ]);
    expect(login.indexOf("`keyboard-operable`")).toBeGreaterThan(login.indexOf("#### Keyboard"));
    expect(ios.indexOf("### Login")).toBeLessThan(ios.indexOf("### Inbox"));
    expect(ios.indexOf("### Inbox")).toBeLessThan(ios.indexOf(`### ${APP_WIDE}`));
  });

  it("explains every check once, with criteria by name and level and how to test", () => {
    expect(ios).toContain("- **3.3.2** Every input has a label or instructions (not just placeholder text) — *Labels or Instructions (A).* Focus each field with the screen reader.");
    expect(ios).toContain("- **1.3.2, 2.4.3** Reading and focus order is logical and matches the visual layout — *Meaningful Sequence (A) · Focus Order (A).*");
    expect(ios).toContain("*Only applies if the app has modals; none were found in the code, so mark N/A if there are none.*");
    expect(android).toContain("Set Settings → Display → Font size");
  });

  it("lists, for each screen, only the checks that apply to it", () => {
    const login = screenIn(ios, "Login");
    const inbox = screenIn(ios, "Inbox");
    expect(login).toContain("- [ ] **1.3.2, 2.4.3** Reading and focus order is logical and matches the visual layout · `focus-order`");
    expect(login).toContain("`input-labels`");
    expect(inbox).not.toContain("`input-labels`");
    expect(inbox).toContain("`pointer-gestures`");
    expect(login).not.toContain("`pointer-gestures`");
    expect(screenIn(ios, APP_WIDE)).toContain("`orientation`");
  });

  it("puts automated findings and signals under the check they belong to on that screen", () => {
    // A scan finding pre-marks the line as failing; a "Verify" signal leaves it for the tester.
    expect(screenIn(ios, "Login")).toContain(
      "- [!] **3.3.2** Every input has a label or instructions (not just placeholder text) · `input-labels` — scan found issues · not reviewed yet\n  ⚑ High · Text input has no accessible label — Login.tsx:12",
    );
    expect(screenIn(ios, "Inbox")).toMatch(/- \[ \] \*\*2\.5\.1\*\* [^\n]*`pointer-gestures`\n {2}⚑ Verify · Gesture or drag: needs a single-tap alternative — Inbox\.tsx:7/);
    expect(screenIn(ios, APP_WIDE)).toMatch(/- \[!\] \*\*1\.3\.4\*\* [^\n]*`orientation` — scan found issues · not reviewed yet\n {2}⚑ Medium · Screen orientation is locked — app\.json:4/);
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
    expect(out).toMatch(/### Scheduling\n\n#### Screen reader\n\n- \[!\] \*\*4\.1\.2\*\* [^\n]*`sr-name-role-value` — scan found issues · not reviewed yet\n {2}⚑ Medium · Touchable has no accessibility role — A\.js:1, B\.js:2, C\.js:3, D\.js:4, E\.js:5 \+2 more\n/);
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
    // No description from the tester: titled as the failure, not the check's "should" wording.
    expect(findings[2]).toMatchObject({ ruleId: "manual:orientation", nodeId: "App-wide", severity: "medium", title: "Locked to one orientation (portrait or landscape) — App-wide" });
    expect(findings[3]).toMatchObject({ ruleId: "manual:other", platforms: ["ios", "android"], wcag: [{ id: "1.4.3" }] });
    // An issue written without a severity is Low; a bare [!] keeps the check's default (orientation: medium, above).
    expect(findings[1]).toMatchObject({ title: "Password field has no label either", severity: "low" });
  });

  it("carries answers from the earlier screen-first layout into the new one", () => {
    const groups = planChecklist(screens, ["ios", "android"], "AA");
    const regenerated = renderChecklist({ projectName: "Acme", targetLevel: "AA", groups, runs, previous: parsed });
    const android = regenerated.slice(regenerated.indexOf("# Android"), regenerated.indexOf("# Other findings"));
    expect(android).toMatch(/### Login\n[\s\S]*?- \[!\] \*\*3\.3\.2\*\* [^\n]*`input-labels`: Email field is read as "edit box" \(critical\)\n {2}- Password field has no label either \[3\.3\.2\]/);
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
    expect(line("Login")).toBe("- [ ] **4.1.2** Screen reader announces the name, role, and state of every control · `sr-name-role-value`");
    expect(line("Signup")).toBe("- [!] **4.1.2** Screen reader announces the name, role, and state of every control · `sr-name-role-value`");
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

describe("indented text without a dash", () => {
  const groups = planChecklist(screens, ["ios", "android"], "AA");
  const base = renderChecklist({ projectName: "Demo", targetLevel: "AA", groups, runs: [] });
  // First occurrences are in the iOS part, on Login.
  const filled = base
    .replace(/- \[ \] (\*\*4\.1\.2\*\* .*`sr-name-role-value`)/, "- [!] $1\n  High - Back caret doesn't read as a button\n  Low- reads the name twice\n  Note: header is an image\n  Phone number link")
    .replace(/- \[ \] (\*\*1\.4\.10\*\* .*`reflow`)/, "- [!] $1\n  Cant test without font scaling/zoom")
    .replace(/- \[ \] (\*\*3\.3\.2\*\* .*`input-labels`)/, "- [x] $1\n      Low - update header")
    .replace(/- \[ \] (\*\*1\.4\.3, 1\.4\.11\*\* .*`contrast`)/, "- [-] $1\n  na - only a camera view");
  const row = (rows: ChecklistRow[], id: string) => rows.find((r) => r.target === "ios" && r.screen === "Login" && r.itemId === id)!;

  it("reads severity-first lines as issues, and Note / N/A / can't-test lines as notes", () => {
    expect(classifyIssueText("High: tabs aren't announced")).toEqual({ issue: { text: "tabs aren't announced", severity: "high" } });
    expect(classifyIssueText("Low-contrast placeholder")).toEqual({ issue: { text: "Low-contrast placeholder" } });
    expect(classifyIssueText("NOTE: are there modals?")).toEqual({ note: "are there modals?" });

    const parsed = parseChecklist(filled);
    expect(row(parsed.rows, "sr-name-role-value")).toMatchObject({
      status: "fail",
      issues: [
        { text: "Back caret doesn't read as a button", severity: "high" },
        { text: "reads the name twice", severity: "low" },
        { text: "Phone number link" },
      ],
      notes: ["header is an image"],
    });
    expect(row(parsed.rows, "reflow")).toMatchObject({ status: "fail", issues: [], notes: ["Cant test without font scaling/zoom"] });
    expect(row(parsed.rows, "input-labels")).toMatchObject({ status: "pass", issues: [], notes: ["update header (low)"] });
    expect(row(parsed.rows, "contrast")).toMatchObject({ status: "na", notes: ["only a camera view"] });
    expect(parsed.warnings).toEqual([
      expect.stringContaining("input-labels: has issue text but isn't marked [!] — kept as a note"),
      expect.stringContaining("1 line(s) are marked [!] fail but say they couldn't be tested"),
    ]);
  });

  it("keeps them when the checklist is regenerated, in the standard format", () => {
    const parsed = parseChecklist(filled);
    const regenerated = renderChecklist({ projectName: "Demo", targetLevel: "AA", groups, runs: [], previous: parsed });
    expect(regenerated).toContain("`sr-name-role-value`: Back caret doesn't read as a button (high)\n  - reads the name twice (low)\n  - Phone number link\n  Note: header is an image\n");
    expect(regenerated).toContain("`input-labels`\n  Note: update header (low)\n");
    const reparsed = parseChecklist(regenerated);
    for (const id of ["sr-name-role-value", "reflow", "input-labels", "contrast"]) {
      const { lines: _a, ...before } = row(parsed.rows, id);
      const { lines: _b, ...after } = row(reparsed.rows, id);
      expect(after).toEqual(before);
    }
  });
});

describe("blocked screens and edited headings", () => {
  const groups = planChecklist(screens, ["ios", "android"], "AA");
  const names = screens.map((s) => s.name);

  it("maps edited headings back to their screen", () => {
    expect(parseScreenHeading("LOGIN - BLOCKED", names)).toEqual({ screen: "Login", blocked: { reason: "" } });
    expect(parseScreenHeading("Inbox (step 2) - BLOCKED: no test account", names)).toEqual({ screen: "Inbox", blocked: { reason: "no test account" }, note: "step 2" });
    expect(parseScreenHeading("INBOX: swipe rows", names)).toEqual({ screen: "Inbox", note: "swipe rows" });
    expect(parseScreenHeading("Settings", names)).toEqual({ screen: "Settings" });
  });

  it("keeps answers, Blocked lines, and notes when the checklist is regenerated", () => {
    // First occurrences are in the iOS part.
    const md = renderChecklist({ projectName: "Demo", targetLevel: "AA", groups, runs: [] })
      .replace(/### Login\n/, "### LOGIN (main flow) - BLOCKED\n")
      .replace(/(### Inbox\n)/, "$1\n> **Blocked:** No test account\n");
    const filled = md.replace(/- \[ \] (\*\*4\.1\.2\*\* .*`sr-name-role-value`)/, "- [x] $1");
    const parsed = parseChecklist(filled, names);
    expect(parsed.screenMarks).toEqual([
      { target: "ios", screen: "Login", blocked: { reason: "" }, note: "main flow" },
      { target: "ios", screen: "Inbox", blocked: { reason: "No test account" } },
    ]);
    expect(parsed.rows.find((r) => r.status === "pass")).toMatchObject({ target: "ios", screen: "Login", itemId: "sr-name-role-value" });

    const regenerated = renderChecklist({ projectName: "Demo", targetLevel: "AA", groups, runs: [], previous: parsed });
    expect(regenerated).toContain("### Login\n\n> **Blocked:**\n\n> **Note:** main flow\n");
    expect(regenerated).toContain("### Inbox\n\n> **Blocked:** No test account\n");
    const reparsed = parseChecklist(regenerated, names);
    expect(reparsed.screenMarks).toEqual(parsed.screenMarks);
    expect(reparsed.rows.filter((r) => r.status === "pass")).toHaveLength(1);

    const blocked = blockedScreens(reparsed);
    expect(blocked.map((b) => [b.screen, b.platforms, b.reasons])).toEqual([
      ["Login", ["ios"], []],
      ["Inbox", ["ios"], ["No test account"]],
    ]);
    expect(blocked[0]!.open).toBe(reparsed.rows.filter((r) => r.target === "ios" && r.screen === "Login" && r.status === "open").length);
    expect(formatBlockedMarkdown(blocked)).toContain("| Inbox | iOS | No test account |");
  });
});

describe("navPath", () => {
  const scr = (name: string, reachedFrom: string[]): ScreenInfo => ({ name, kind: "mobile", file: `src/${name}.tsx`, features: [], reachedFrom });
  const all = [
    scr("Login", ["App launch", "Side menu (Logout)"]),
    scr("Loading", ["Login"]),
    scr("Home", ["Loading (has patientKey)", "Tab bar"]),
    scr("Billing", ["Home (billing enabled)", "Tab bar"]),
    scr("InvoiceDetail", ["InvoiceHistory"]),
    scr("InvoiceHistory", ["Billing"]),
    scr("Orphan", ["Orphan"]),
  ];
  const path = (name: string) => navPath(all.find((s) => s.name === name)!, all);

  it("finds the shortest route from an entry point, preferring app launch on ties", () => {
    expect(path("Login")).toEqual(["App launch", "Login"]);
    expect(path("Loading")).toEqual(["App launch", "Login", "Loading"]);
    expect(path("Home")).toEqual(["Tab bar", "Home"]);
    expect(path("InvoiceDetail")).toEqual(["Tab bar", "Billing", "InvoiceHistory", "InvoiceDetail"]);
    expect(path("Orphan")).toBeUndefined();
  });

  it("writes the route under the screen heading", () => {
    const md = renderChecklist({ projectName: "Demo", targetLevel: "AA", groups: planChecklist(all, ["ios"], "AA"), runs: [] });
    expect(md).toContain("### InvoiceDetail\n\n*path: Tab bar → Billing → InvoiceHistory → InvoiceDetail*\n");
    expect(md).toContain("### Home\n\n*path: Tab bar → Home · also from: Loading (has patientKey)*\n");
    expect(md).toContain("### Orphan\n\n*reached from Orphan*\n");
  });
});
