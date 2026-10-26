import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ScreenInfo } from "../src/code-scan/screens.js";
import { parseChecklist, planChecklist, renderChecklist } from "../src/wizard/checklist-md.js";
import type { AutomatedRun } from "../src/wizard/session.js";
import { wcag } from "../src/wcag.js";

// The GUI's parser/serializer is the "// <core>" block of the HTML: plain JS, no DOM.
const html = readFileSync(new URL("../assets/checklist-ui/checklist.html", import.meta.url), "utf8");
const core = html.slice(html.indexOf("// <core>"), html.indexOf("// </core>"));
interface Issue { text: string; severity: string }
interface Check { type: "check"; mark: string; slug: string; unreviewed: boolean; issues: Issue[]; notes: string[]; dirty: boolean; screen: { name: string; platform: string } }
interface Doc {
  screens: Array<{ name: string; platform: string; section: string }>;
  checks: Check[];
  platforms: string[];
  other: { dirty: boolean; entries: Array<{ item?: { platforms: string[]; screen: string; wcag: string; text: string; severity: string } }> };
}
const ui = new Function(`${core}; return { parseDoc, serialize, screenStatus };`)() as {
  parseDoc(text: string): Doc;
  serialize(doc: Doc): string;
  screenStatus(screen: Doc["screens"][number], doc: Doc): { left: number; failed: boolean; unreviewed: number };
};

const screens: ScreenInfo[] = [
  { name: "Login", kind: "mobile", file: "src/Login.tsx", files: ["src/Login.tsx"], features: ["inputs"], group: "Root", deepLink: "login" },
  { name: "Inbox", kind: "mobile", file: "src/Inbox.tsx", files: ["src/Inbox.tsx"], features: ["images"], group: "Main" },
];
const runs: AutomatedRun[] = [
  {
    tool: "rn-code-scan",
    targets: ["ios", "android"],
    ranAt: "",
    findings: [
      {
        ruleId: "rn-input-label",
        title: "Text input has no accessible label — src/Login.tsx",
        description: "",
        severity: "high",
        wcag: wcag("3.3.2"),
        evidence: { file: "src/Login.tsx", lines: [12] },
      },
    ],
  },
];
const md = renderChecklist({ projectName: "Demo", targetLevel: "AA", groups: planChecklist(screens, ["ios", "android"], "AA"), runs });
const find = (doc: Doc, platform: string, screen: string, slug: string) =>
  doc.checks.find((c) => c.screen.platform === platform && c.screen.name === screen && c.slug === slug)!;

describe("checklist GUI", () => {
  it("reads every platform, screen, and check the toolkit renders", () => {
    const doc = ui.parseDoc(md);
    expect(doc.platforms).toEqual(["ios", "android"]);
    expect(doc.screens.filter((s) => s.platform === "ios").map((s) => s.name)).toEqual(["Login", "Inbox", "App-wide (check once)"]);
    expect(doc.screens[0]!.section).toBe("Root");
    expect(doc.checks.length).toBe(parseChecklist(md).rows.length);
    expect(find(doc, "ios", "Login", "input-labels")).toMatchObject({ mark: "!", unreviewed: true });
  });

  it("writes an untouched file back unchanged", () => {
    expect(ui.serialize(ui.parseDoc(md))).toBe(md);
  });

  it("writes edits the report reads, and that survive regenerating the checklist", () => {
    const doc = ui.parseDoc(md);
    const edit = (c: Check, mark: string, issues: Issue[] = []) => Object.assign(c, { mark, issues, dirty: true, unreviewed: false });
    edit(find(doc, "ios", "Login", "sr-name-role-value"), "x");
    edit(find(doc, "ios", "Login", "input-labels"), "!");
    edit(find(doc, "android", "Inbox", "sr-name-role-value"), "!", [
      { text: "Avatar reads as image", severity: "high" },
      { text: "Badge count not announced", severity: "" },
    ]);
    // Issue text on a pass is written as a note, not an issue.
    edit(find(doc, "android", "Login", "sr-name-role-value"), "x", [{ text: "draft", severity: "" }]);
    doc.other.entries.push({ item: { platforms: ["ios"], screen: "Inbox", wcag: "1.4.3", text: "Grey subtitle", severity: "medium" } });
    doc.other.dirty = true;

    const out = ui.serialize(doc);
    const parsed = parseChecklist(out);
    expect(parsed.warnings).toEqual([]);
    const row = (target: string, screen: string, id: string) => parsed.rows.find((r) => r.target === target && r.screen === screen && r.itemId === id)!;
    expect(row("ios", "Login", "sr-name-role-value").status).toBe("pass");
    expect(row("ios", "Login", "input-labels")).toMatchObject({ status: "fail", flagged: true });
    expect(row("ios", "Login", "input-labels").reviewed).toBeUndefined();
    expect(row("android", "Inbox", "sr-name-role-value").issues).toEqual([
      { text: "Avatar reads as image", severity: "high" },
      { text: "Badge count not announced" },
    ]);
    expect(row("android", "Login", "sr-name-role-value")).toMatchObject({ status: "pass", issues: [], notes: ["draft"] });
    expect(parsed.other).toEqual([{ platforms: ["ios"], screen: "Inbox", wcag: ["1.4.3"], text: "Grey subtitle", severity: "medium" }]);

    const regenerated = renderChecklist({
      projectName: "Demo",
      targetLevel: "AA",
      groups: planChecklist(screens, ["ios", "android"], "AA"),
      runs,
      previous: parsed,
    });
    expect(ui.serialize(ui.parseDoc(regenerated))).toBe(regenerated);
    expect(parseChecklist(regenerated).rows.filter((r) => r.status !== "open" && r.reviewed !== false)).toHaveLength(4);
  });

  it("reads indented text without a dash the way the report does", () => {
    const filled = md
      .replace(/- \[ \] (\*\*4\.1\.2\*\* .*`sr-name-role-value`)/, "- [!] $1\n  High - Back caret doesn't read as a button\n  Note: header is an image")
      .replace(/- \[ \] (\*\*1\.4\.3, 1\.4\.11\*\* .*`contrast`)/, "- [x] $1\n      Low - update header");
    const doc = ui.parseDoc(filled);
    expect(ui.serialize(doc)).toBe(filled);
    const c = find(doc, "ios", "Login", "sr-name-role-value");
    expect(c).toMatchObject({ issues: [{ text: "Back caret doesn't read as a button", severity: "high" }], notes: ["header is an image"] });

    c.issues.push({ text: "Menu has no name", severity: "medium" });
    c.dirty = true;
    find(doc, "ios", "Inbox", "sr-name-role-value").dirty = true;
    const parsed = parseChecklist(ui.serialize(doc));
    const row = (screen: string, id: string) => parsed.rows.find((r) => r.target === "ios" && r.screen === screen && r.itemId === id)!;
    expect(row("Login", "sr-name-role-value")).toMatchObject({
      status: "fail",
      issues: [{ text: "Back caret doesn't read as a button", severity: "high" }, { text: "Menu has no name", severity: "medium" }],
      notes: ["header is an image"],
    });
    expect(row("Login", "contrast").notes).toEqual(["update header (low)"]);
  });

  it("counts unreviewed scan pre-fills and other issues in screen status", () => {
    const doc = ui.parseDoc(md);
    const login = doc.screens[0]!;
    expect(ui.screenStatus(login, doc)).toMatchObject({ failed: true, unreviewed: 1 });
    const inbox = doc.screens[1]!;
    expect(ui.screenStatus(inbox, doc).failed).toBe(false);
    doc.other.entries.push({ item: { platforms: ["ios"], screen: "inbox", wcag: "", text: "Something", severity: "" } });
    expect(ui.screenStatus(inbox, doc).failed).toBe(true);
  });
});

describe("checklist GUI — blocked screens", () => {
  type Screen = Doc["screens"][number] & { blocked: { reason: string } | null; heading: { dirty: boolean }; blockedBlock: { dirty: boolean } | null };
  const block = (s: Screen, blocked: { reason: string } | null) => {
    s.blocked = blocked;
    s.heading.dirty = true;
    if (s.blockedBlock) s.blockedBlock.dirty = true;
  };

  it("writes a Blocked line the report reads, and removes it again", () => {
    const doc = ui.parseDoc(md);
    const inbox = doc.screens.find((s) => s.platform === "android" && s.name === "Inbox") as Screen;
    block(inbox, { reason: "Needs a  test account" });
    const out = ui.serialize(doc);
    expect(out).toContain("### Inbox\n\n> **Blocked:** Needs a test account\n");
    expect(parseChecklist(out).screenMarks).toEqual([{ target: "android", screen: "Inbox", blocked: { reason: "Needs a test account" } }]);
    expect(ui.screenStatus(inbox, doc)).toMatchObject({ blocked: true });

    const again = ui.parseDoc(out);
    const reread = again.screens.find((s) => s.platform === "android" && s.name === "Inbox") as Screen;
    expect(reread.blocked).toEqual({ reason: "Needs a test account" });
    block(reread, null);
    expect(parseChecklist(ui.serialize(again)).screenMarks).toEqual([]);
  });

  it("reads an old '- BLOCKED' heading and rewrites it as a Blocked line when edited", () => {
    const legacy = md.replace("### Inbox", "### Inbox - BLOCKED");
    const doc = ui.parseDoc(legacy);
    expect(ui.serialize(doc)).toBe(legacy);
    const inbox = doc.screens.find((s) => s.platform === "ios" && s.name === "Inbox") as Screen;
    expect(inbox.blocked).toEqual({ reason: "" });
    block(inbox, { reason: "Feature flag off" });
    const out = ui.serialize(doc);
    expect(out).toContain("### Inbox\n\n> **Blocked:** Feature flag off\n");
    expect(out).not.toContain("### Inbox - BLOCKED\n\n> **Blocked:** Feature flag off");
  });
});
