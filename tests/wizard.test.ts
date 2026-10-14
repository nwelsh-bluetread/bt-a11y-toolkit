import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CodeScanResult } from "../src/code-scan/react-native.js";
import type { ScreenInfo } from "../src/code-scan/screens.js";
import type { Assessment } from "../src/types.js";
import { wcag } from "../src/wcag.js";
import { runWizard, type WizardDeps } from "../src/wizard/index.js";
import type { Choice, Prompter } from "../src/wizard/prompts.js";
import { loadSession, writeReports } from "../src/wizard/session.js";

type Answer = (message: string, choices?: Choice<unknown>[]) => unknown;

/** A prompter driven by `{ match, answer }` rules; the first matching rule answers. `once` rules are consumed. */
function scripted(rules: Array<{ match: RegExp; answer: unknown; once?: boolean }>): Prompter & { log: string[] } {
  const log: string[] = [];
  const respond = (message: string, choices?: Choice<unknown>[]) => {
    log.push(message);
    const i = rules.findIndex((r) => r.match.test(message));
    if (i === -1) throw new Error(`Unscripted prompt: ${message}`);
    const rule = rules[i]!;
    if (rule.once) rules.splice(i, 1);
    return typeof rule.answer === "function" ? (rule.answer as Answer)(message, choices) : rule.answer;
  };
  return {
    log,
    select: async (m, c) => respond(m, c as Choice<unknown>[]) as never,
    checkbox: async (m, c) => respond(m, c as Choice<unknown>[]) as never,
    input: async (m, o) => (respond(m) ?? o?.default ?? "") as string,
    confirm: async (m, o) => (respond(m) ?? o?.default) as boolean,
  };
}

const SCREENS: ScreenInfo[] = [
  { name: "Login", kind: "mobile", file: "src/Login.tsx", files: ["src/Login.tsx"], features: ["inputs", "auth"] },
  { name: "Inbox", kind: "mobile", file: "src/Inbox.tsx", files: ["src/Inbox.tsx"], features: ["gestures"] },
];

const SCAN: CodeScanResult = {
  root: "",
  filesScanned: 42,
  checked: ["1.1.1", "1.4.4", "3.3.2", "4.1.2"],
  signals: [{ id: "gestures", criteria: ["2.5.1", "2.5.7"], message: "Gesture interaction", locations: [{ file: "src/Inbox.tsx", line: 9 }] }],
  findings: [
    {
      ruleId: "rn-input-label",
      title: "Text input has no accessible label — src/Login.tsx",
      description: "",
      severity: "high",
      wcag: wcag("3.3.2", "4.1.2"),
      platforms: ["ios", "android"],
      source: "rn-code-scan",
      nodeId: "src/Login.tsx:12",
      evidence: { file: "src/Login.tsx", lines: [12] },
    },
  ],
};

function deps(cwd: string, prompter: Prompter, overrides: Partial<WizardDeps> = {}): WizardDeps & { output: string[] } {
  const output: string[] = [];
  const fail = async (): Promise<never> => {
    throw new Error("should not run");
  };
  return {
    output,
    prompter,
    cwd,
    out: (t) => output.push(t),
    resolveUrls: async (o) => o.urls ?? [],
    scanAxe: fail,
    scanLighthouse: fail,
    scanCode: async () => SCAN,
    discoverScreens: async () => ({ screens: SCREENS, method: "react-navigation" }),
    hasModule: async () => true,
    runCommand: async () => 0,
    ...overrides,
  };
}

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "bt-a11y-wizard-"));
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

const rnPackage = () => writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "acme-rn", dependencies: { "react-native": "0.76.0" } }));
const read = (file: string) => readFileSync(join(cwd, "a11y-audit", file), "utf8");

describe("runWizard — React Native app", () => {
  it("asks only setup questions, then scans, and writes + prints a per-screen checklist", async () => {
    rnPackage();
    mkdirSync(join(cwd, ".git"));
    const p = scripted([
      { match: /Project \/ client name/, answer: undefined }, // accept default
      { match: /What are you auditing/, answer: "mobile" },
      { match: /Target WCAG/, answer: "AA" },
      { match: /Audit these screens/, answer: true },
      { match: /gitignore/, answer: true },
    ]);
    const d = deps(cwd, p);
    await runWizard(d);

    expect(p.log).toHaveLength(5);
    const session = loadSession(cwd)!;
    expect(session.project).toMatchObject({ name: "acme-rn", type: "mobile", targets: ["ios", "android"], stack: "react-native", targetLevel: "AA" });
    expect(session.screens.map((s) => s.name)).toEqual(["Login", "Inbox"]);
    expect(session.automated[0]).toMatchObject({ tool: "rn-code-scan", filesScanned: 42, targets: ["ios", "android"] });

    const out = d.output.join("\n");
    expect(out).toContain("Found 2 screens");
    expect(out).toContain("React Native code scan");
    expect(out).toMatch(/Manual checklist — Mobile app — iOS \+ Android · WCAG AA/);
    expect(out).toMatch(/Login — every-screen checks, plus:\s+src\/Login\.tsx · form inputs, sign-in · ⚑ 1 automated finding/);
    expect(out).toContain("☐ Swipe, pinch, and drag gestures have a single-tap alternative (2.5.1)");
    expect(out).toMatch(/On every screen \(\d+ checks\)/);
    expect(out).toContain("npx bt-a11y report");

    const md = read("checklist.md");
    expect(md).toContain("## Screen: Login");
    expect(md).toContain("⚑ rn-code-scan: Text input has no accessible label (src/Login.tsx:12)");
    expect(md).toContain("⚑ Verify: Gesture interaction (src/Inbox.tsx:9)");
    expect(read("report.md")).toContain("## WCAG 2.2 criteria coverage");
    expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toContain("a11y-audit/");
  });

  it("builds the audit from the filled-in checklist, and keeps answers on re-run", async () => {
    rnPackage();
    await runWizard(
      deps(
        cwd,
        scripted([
          { match: /Project \/ client name/, answer: "Acme" },
          { match: /What are you auditing/, answer: "mobile" },
          { match: /Target WCAG/, answer: "AA" },
          { match: /Audit these screens/, answer: true },
        ]),
      ),
    );

    // A tester fills in the gestures check on the Inbox screen.
    const path = join(cwd, "a11y-audit", "checklist.md");
    const md = readFileSync(path, "utf8");
    const gestures = md.indexOf("`pointer-gestures`", md.indexOf("## Screen: Inbox"));
    const filled =
      md.slice(0, gestures) +
      md.slice(gestures).replace("- [ ] iOS", "- [!] iOS: Delete is swipe-only, no button (high)").replace("- [ ] Android", "- [x] Android");
    writeFileSync(path, filled);

    const { assessment, coverage } = writeReports(cwd, loadSession(cwd)!);
    const manual = assessment.findings.find((f) => f.ruleId === "manual:pointer-gestures")!;
    expect(manual).toMatchObject({ title: "Delete is swipe-only, no button", severity: "high", platforms: ["ios"], nodeId: "Inbox" });
    const row = coverage.rows.find((r) => r.id === "2.5.1")!;
    expect(row.byTarget.ios!.status).toBe("fail");
    expect(row.byTarget.android!.status).toBe("pass");
    expect(read("report.md")).toContain("Delete is swipe-only, no button");

    // Re-run: no setup questions, answers kept.
    const p = scripted([{ match: /What would you like to do/, answer: "rerun" }]);
    const d = deps(cwd, p);
    await runWizard(d);
    expect(p.log).toEqual(["What would you like to do?"]);
    expect(readFileSync(path, "utf8")).toContain("- [!] iOS: Delete is swipe-only, no button (high)");
    expect(d.output.join("\n")).toContain("kept 2 answers");
  });

  it("lets the user type screens when the project isn't React Native", async () => {
    const p = scripted([
      { match: /Project \/ client name/, answer: "Acme Native" },
      { match: /What are you auditing/, answer: "mobile" },
      { match: /Target WCAG/, answer: "A" },
      { match: /Screens to audit/, answer: "Home, Checkout, Home" },
    ]);
    await runWizard(
      deps(cwd, p, {
        scanCode: async () => {
          throw new Error("no code scan for non-RN apps");
        },
      }),
    );
    const session = loadSession(cwd)!;
    expect(session.screens).toEqual([
      { name: "Home", kind: "mobile" },
      { name: "Checkout", kind: "mobile" },
    ]);
    expect(session.automated).toEqual([]);
    const md = read("checklist.md");
    expect(md).toContain("## Screen: Checkout");
    // Screen contents are unknown, so feature checks are listed once app-wide.
    expect(md).toMatch(/`input-labels` \*\(no form inputs found in code/);
  });
});

describe("runWizard — website", () => {
  it("asks for pages, installs missing scanners, and runs them without further prompts", async () => {
    const commands: string[] = [];
    const scanned: string[][] = [];
    const fake = (tool: string): Assessment => ({
      generatedAt: "",
      platform: "web",
      targetLevel: "AA",
      overallScore: 90,
      counts: { critical: 0, high: 1, medium: 0, low: 0 },
      wcag: { A: 90, AA: 80, AAA: 70 },
      categories: [],
      topIssues: [],
      findings: [
        { ruleId: `${tool}:x`, title: "x", description: "", severity: "high", wcag: wcag("1.1.1"), source: tool, evidence: { page: "https://acme.test/about" } },
      ],
    });
    const p = scripted([
      { match: /Project \/ client name/, answer: "Acme Web" },
      { match: /What are you auditing/, answer: "web" },
      { match: /Target WCAG/, answer: "AA" },
      { match: /Pages to audit/, answer: "https://acme.test/ https://acme.test/about" },
      { match: /need playwright/, answer: true },
    ]);
    await runWizard(
      deps(cwd, p, {
        hasModule: async (name) => !name.includes("playwright"),
        runCommand: async (cmd, args) => {
          commands.push([cmd, ...args].join(" "));
          return 0;
        },
        scanAxe: async (urls) => {
          scanned.push(urls);
          return fake("axe");
        },
        scanLighthouse: async () => fake("lighthouse"),
      }),
    );

    expect(commands).toEqual(["npm install -D playwright @axe-core/playwright", "npx playwright install chromium"]);
    expect(scanned).toEqual([["https://acme.test/", "https://acme.test/about"]]);
    const session = loadSession(cwd)!;
    expect(session.screens.map((s) => s.name)).toEqual(["/", "/about"]);
    expect(session.automated.map((r) => r.tool).sort()).toEqual(["axe", "lighthouse"]);
    const md = read("checklist.md");
    const about = md.slice(md.indexOf("## Page: /about"));
    expect(about).toContain("⚑ axe: x (https://acme.test/about)");
    expect(existsSync(join(cwd, "a11y-audit", "report.json"))).toBe(true);
  });
});
