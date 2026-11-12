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
    // The optional BrowserStack import is skipped unless a test scripts it.
    if (i === -1 && /BrowserStack App Accessibility CSV/.test(message)) return "";
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
      { match: /What would you like to do/, answer: "new", once: true },
      { match: /context docs/, answer: "" },
      { match: /Project \/ client name/, answer: undefined }, // accept default
      { match: /What are you auditing/, answer: "mobile" },
      { match: /Target WCAG/, answer: "AA" },
      { match: /Audit these \d+ screens/, answer: true },
      { match: /gitignore/, answer: true },
    ]);
    const d = deps(cwd, p);
    await runWizard(d);

    expect(p.log).toHaveLength(8);
    const session = loadSession(cwd)!;
    expect(session.project).toMatchObject({ name: "acme-rn", type: "mobile", targets: ["ios", "android"], stack: "react-native", targetLevel: "AA" });
    expect(session.screens.map((s) => s.name)).toEqual(["Login", "Inbox"]);
    expect(session.automated[0]).toMatchObject({ tool: "rn-code-scan", filesScanned: 42, targets: ["ios", "android"] });

    const out = d.output.join("\n");
    expect(out).toContain("Found 2 screens");
    expect(out).toContain("React Native code scan");
    expect(out).toMatch(/Manual checklist — Mobile app — iOS \+ Android · WCAG AA/);
    expect(out).toContain("all of iOS first, then the same passes on Android");
    expect(out).toMatch(/All checks, screen by screen \(\d+ checks · \d+ to mark per platform\)/);
    expect(out).toContain("☐ Swipe, pinch, and drag gestures have a single-tap alternative (2.5.1) — 1 screen");
    expect(out).toContain("⚑ Automated findings by screen: Login (1)");
    expect(out).toContain("npx bt-a11y report");

    const md = read("checklist.md");
    expect(md).toContain("# iOS");
    expect(md).toContain("## All checks, screen by screen");
    expect(md).toMatch(/### Login\n[\s\S]*?`input-labels` — scan found issues · not reviewed yet\n {2}⚑ High · Text input has no accessible label — Login\.tsx:12/);
    expect(md).toMatch(/### Inbox\n[\s\S]*?- \[ \] [^\n]*`pointer-gestures`\n {2}⚑ Verify · Gesture or drag: needs a single-tap alternative — Inbox\.tsx:9/);
    expect(read("scan-details.md")).toContain("### High · Text input has no accessible label\n\n- **WCAG:** 3.3.2 Labels or Instructions (A), 4.1.2 Name, Role, Value (A)\n- **Where:**\n  - `src/Login.tsx` line 12");
    expect(read("report.md")).toContain("## WCAG 2.2 criteria coverage");
    expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toContain("a11y-audit/");
  });

  it("builds the audit from the filled-in checklist, and keeps answers on re-run", async () => {
    rnPackage();
    await runWizard(
      deps(
        cwd,
        scripted([
          { match: /What would you like to do/, answer: "new", once: true },
          { match: /context docs/, answer: "" },
      { match: /Project \/ client name/, answer: "Acme" },
          { match: /What are you auditing/, answer: "mobile" },
          { match: /Target WCAG/, answer: "AA" },
          { match: /Audit these \d+ screens/, answer: true },
        ]),
      ),
    );

    // A tester marks the gestures check on the Inbox screen: fails on iOS, passes on Android.
    const path = join(cwd, "a11y-audit", "checklist.md");
    let md = readFileSync(path, "utf8");
    const mark = (part: string, edit: (line: string) => string) => {
      const lines = md.split("\n");
      let i = lines.indexOf(part);
      while (!(lines[i]!.startsWith("- [ ]") && lines[i]!.includes("`pointer-gestures`"))) i++;
      lines[i] = edit(lines[i]!);
      md = lines.join("\n");
    };
    mark("# iOS", (l) => `${l.replace("- [ ]", "- [!]")}: Delete is swipe-only, no button (high)`);
    mark("# Android", (l) => l.replace("- [ ]", "- [x]"));
    writeFileSync(path, md);

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
    expect(readFileSync(path, "utf8")).toMatch(/### Inbox\n[\s\S]*?- \[!\] \*\*2\.5\.1\*\* [^\n]*`pointer-gestures`: Delete is swipe-only, no button \(high\)/);
    expect(d.output.join("\n")).toContain("kept 2 answers");
  });

  it("lets the user type screens when the project isn't React Native", async () => {
    const p = scripted([
      { match: /What would you like to do/, answer: "new", once: true },
      { match: /context docs/, answer: "" },
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
    expect(md).toContain("- **Checkout**");
    expect(md).toContain("### Checkout\n");
    // Screen contents are unknown, so feature checks are listed once app-wide.
    expect(md).toMatch(/- \*\*3\.3\.2\*\* Every input has a label[^\n]*\*Only applies if the app has form inputs; none were found in the code/);
  });
});

describe("runWizard — context docs", () => {
  const MAP = [
    "# Navigation Map",
    "",
    "## 1. Root stack: `src/navigator/index.js`",
    "",
    "| Route name | Screen component | Deep link |",
    "| --- | --- | --- |",
    "| `Login` | `Auth/Login` | `login` |",
    "",
    "## 2. Main bottom tabs",
    "",
    "| Tab → route | Screen component | Deep link |",
    "| --- | --- | --- |",
    "| **`BillingTab`** (opens on `Billing`) | | `home/billing` |",
    "| ↳ `Billing` | `Billing` | — |",
    "| ↳ `Inbox` | `Other/Inbox` | — |",
    "| **`SettingsTab`** | | |",
    "| ↳ `Settings` | `Settings` | — |",
    "",
    "```mermaid",
    "flowchart TD",
    "    Login --> Billing",
    "    Billing --> Inbox",
    "```",
  ].join("\n");

  it("starts from a context doc: groups screens, scopes by group, and annotates the checklist", async () => {
    rnPackage();
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "docs", "navigation-map.md"), MAP);
    const p = scripted([
      { match: /What would you like to do/, answer: "new", once: true },
      { match: /context docs/, answer: undefined }, // accept the suggested docs/navigation-map.md
      { match: /Project \/ client name/, answer: "Acme" },
      { match: /What are you auditing/, answer: "mobile" },
      { match: /Target WCAG/, answer: "AA" },
      {
        match: /Which parts of the app are in scope/,
        answer: ((_, choices) => {
          expect(choices!.map((c) => c.name)).toEqual(["Root stack (1)", "Main bottom tabs › BillingTab (2)", "Main bottom tabs › SettingsTab (1)"]);
          return ["Root stack", "Main bottom tabs › BillingTab"];
        }) as Answer,
      },
      { match: /Audit these 3 screens/, answer: true },
    ]);
    const d = deps(cwd, p);
    await runWizard(d);

    expect(p.log.slice(0, 2)).toEqual(["What would you like to do?", expect.stringMatching(/context docs/)]);
    const session = loadSession(cwd)!;
    expect(session.context).toEqual({ files: ["context/navigation-map.md"] });
    expect(existsSync(join(cwd, "a11y-audit", "context", "navigation-map.md"))).toBe(true);
    // Login and Inbox matched screens found in code; Billing comes only from the doc.
    expect(session.screens.map((s) => [s.name, s.group, Boolean(s.file)])).toEqual([
      ["Login", "Root stack", true],
      ["Billing", "Main bottom tabs › BillingTab", false],
      ["Inbox", "Main bottom tabs › BillingTab", true],
    ]);

    const out = d.output.join("\n");
    expect(out).toContain("Context: 4 screens in 3 groups, 2 navigation links.");

    const md = read("checklist.md");
    expect(md).toContain("**Context:** [context/navigation-map.md](context/navigation-map.md)");
    expect(md).toContain("**Main bottom tabs › BillingTab**\n\n- **Billing** — deep link `home/billing` · reached from: Login");

    // Re-run: the saved context is re-applied without asking again, and a saved
    // selection in an old order is put back into the doc's order.
    const saved = loadSession(cwd)!;
    saved.screens.reverse();
    writeFileSync(join(cwd, "a11y-audit", "session.json"), JSON.stringify(saved));
    const again = scripted([{ match: /What would you like to do/, answer: "rerun" }]);
    await runWizard(deps(cwd, again));
    const rerun = loadSession(cwd)!;
    expect(rerun.screens.map((s) => s.name)).toEqual(["Login", "Billing", "Inbox"]);
    expect(rerun.screens.find((s) => s.name === "Inbox")!.reachedFrom).toEqual(["Billing"]);
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
      { match: /What would you like to do/, answer: "new", once: true },
      { match: /context docs/, answer: "" },
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
    // Alt-text checks are app-wide for websites (page contents aren't known), so the finding is listed in the index.
    expect(md).toContain("- **/about** — https://acme.test/about · ⚑ 2 automated findings");
    expect(md).toContain("  - ⚑ High · x (1.1.1; no check covers this)");
    expect(md).toContain("# Website");
    expect(md).toContain("### /about\n");
    expect(existsSync(join(cwd, "a11y-audit", "report.json"))).toBe(true);
  });
});

describe("runWizard — screen reader test", () => {
  async function setupWebAudit() {
    const { newSession, saveSession } = await import("../src/wizard/session.js");
    const urls = ["http://localhost:4173/login", "http://localhost:4173/users"];
    saveSession(cwd, newSession({ name: "v2", type: "web", targets: ["web"], targetLevel: "AA", urls }, urls.map((url) => ({ name: new URL(url).pathname, kind: "web", url }))));
    return urls;
  }

  it("isn't offered where VoiceOver can't run", async () => {
    let choices: string[] = [];
    const p = scripted([{ match: /What would you like to do/, answer: (_m: string, c?: Choice<unknown>[]) => ((choices = c!.map((x) => String(x.value))), "quick") }]);
    await runWizard(deps(cwd, p, { scanAxe: async () => ({}) as Assessment, scanLighthouse: async () => ({}) as Assessment })).catch(() => {});
    expect(choices).not.toContain("sr");
  });

  it("runs VoiceOver on every audit page, then adds the findings", async () => {
    const urls = await setupWebAudit();
    mkdirSync(join(cwd, "a11y-audit", "screen-reader", "sessions"), { recursive: true });
    writeFileSync(join(cwd, "a11y-audit", "screen-reader", "sessions", "localhost-4173.json"), "{}");
    const calls: string[][] = [];
    const p = scripted([
      { match: /What would you like to do/, answer: "sr" },
      { match: /What should VoiceOver test/, answer: "audit" },
      { match: /Sign in first/, answer: "localhost-4173" },
      { match: /Start VoiceOver now/, answer: true },
    ]);
    const d = deps(cwd, p, { runScreenReader: async (a) => (calls.push(a), 0) });
    await runWizard(d);

    expect(d.output[1]).toContain("2 pages");
    const dir = join(cwd, "a11y-audit", "screen-reader", "workflows");
    const wf = JSON.parse(readFileSync(join(dir, "baseline-localhost-login.json"), "utf8"));
    expect(wf).toMatchObject({ name: `Baseline: ${urls[0]}`, url: urls[0], session: "localhost-4173" });
    expect(existsSync(join(dir, "baseline-localhost-users.json"))).toBe(true);
    expect(calls).toEqual([["test", "-g", "Baseline: http://localhost:4173/login|Baseline: http://localhost:4173/users"], ["findings"]]);
  });

  it("runs one page, or the saved workflows picked, and doesn't start VoiceOver without a yes", async () => {
    const dir = join(cwd, "a11y-audit", "screen-reader", "workflows");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "checkout.json"), JSON.stringify({ name: "Checkout (bad promo)", url: "https://x.test", steps: [{ read: "page" }] }));
    let offered: string[] = [];
    const calls: string[][] = [];
    const p = scripted([
      { match: /What would you like to do/, answer: "sr" },
      { match: /What should VoiceOver test/, answer: (_m: string, c?: Choice<unknown>[]) => ((offered = c!.map((x) => String(x.value))), "saved") },
      { match: /Which workflows/, answer: ["Checkout (bad promo)"] },
      { match: /Start VoiceOver now/, answer: true },
    ]);
    await runWizard(deps(cwd, p, { runScreenReader: async (a) => (calls.push(a), 0) }));
    // No audit: no "every page" option.
    expect(offered).toEqual(["page", "saved"]);
    expect(calls[0]).toEqual(["test", "-g", "Checkout \\(bad promo\\)"]);

    const p2 = scripted([
      { match: /What would you like to do/, answer: "sr" },
      { match: /What should VoiceOver test/, answer: "page" },
      { match: /Page URL/, answer: " https://acme.test/pricing " },
      { match: /Start VoiceOver now/, answer: false },
    ]);
    const calls2: string[][] = [];
    const d2 = deps(cwd, p2, { runScreenReader: async (a) => (calls2.push(a), 0) });
    await runWizard(d2);
    expect(existsSync(join(dir, "baseline-acme-test-pricing.json"))).toBe(true);
    expect(calls2).toEqual([]);
    expect(d2.output.join("\n")).toContain("Not started");
  });
});

describe("runWizard — VoiceOver as part of a website audit", () => {
  const empty = (_tool: string): Assessment => ({
    generatedAt: "",
    platform: "web",
    targetLevel: "AA",
    overallScore: 100,
    counts: { critical: 0, high: 0, medium: 0, low: 0 },
    wcag: { A: 100, AA: 100, AAA: 100 },
    categories: [],
    topIssues: [],
    findings: [],
  });
  const transcript = (url: string) => ({
    version: 1,
    workflow: "Login: sign in",
    url,
    ranAt: "",
    steps: [{ step: 1, action: "tab", kind: "tab", url, output: [{ spoken: "button", item: "", focus: { role: "button", name: "", states: [], tag: "button", domIndex: 3 } }] }],
  });

  function webAnswers(extra: Array<{ match: RegExp; answer: unknown; once?: boolean }>) {
    return scripted([
      { match: /What would you like to do/, answer: "new", once: true },
      { match: /context docs/, answer: "" },
      { match: /Project \/ client name/, answer: "Acme Web" },
      { match: /What are you auditing/, answer: "web" },
      { match: /Target WCAG/, answer: "AA" },
      { match: /Pages to audit/, answer: "https://acme.test/login" },
      ...extra,
    ]);
  }

  it("asks for a workflow file, copies it into the audit, runs it after the scans and adds the findings", async () => {
    mkdirSync(join(cwd, "flows"));
    writeFileSync(join(cwd, "flows", "login.json"), JSON.stringify({ name: "Login: sign in", url: "https://acme.test/login", steps: [{ tab: "all" }] }));
    const order: string[] = [];
    const p = webAnswers([
      { match: /Add screen reader testing/, answer: true },
      { match: /Workflow file/, answer: "flows" },
    ]);
    await runWizard(
      deps(cwd, p, {
        scanAxe: async () => (order.push("axe"), empty("axe")),
        scanLighthouse: async () => (order.push("lighthouse"), empty("lighthouse")),
        runScreenReader: async (args) => {
          order.push(args.join(" "));
          const dir = join(cwd, "a11y-audit", "screen-reader", "transcripts");
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, "login.json"), JSON.stringify(transcript("https://acme.test/login")));
          return 0;
        },
      }),
    );

    expect(existsSync(join(cwd, "a11y-audit", "screen-reader", "workflows", "login.json"))).toBe(true);
    expect(order).toEqual(["axe", "lighthouse", "test -g Login: sign in"]);
    const session = loadSession(cwd)!;
    expect(session.screenReader).toEqual({ workflows: ["Login: sign in"] });
    const run = session.automated.find((r) => r.tool === "voiceover")!;
    expect(run.findings.map((f) => f.ruleId)).toEqual(["sr-no-name"]);
    expect(read("checklist.md")).toContain("not reviewed yet");

    // A re-run offers the same workflows again; "no" leaves the earlier findings in place.
    const again = scripted([
      { match: /What would you like to do/, answer: "rerun" },
      { match: /Run the 1 VoiceOver workflow again/, answer: false },
    ]);
    let ran = false;
    await runWizard(deps(cwd, again, { scanAxe: async () => empty("axe"), scanLighthouse: async () => empty("lighthouse"), runScreenReader: async () => ((ran = true), 0) }));
    expect(ran).toBe(false);
    expect(loadSession(cwd)!.automated.some((r) => r.tool === "voiceover")).toBe(true);
  });

  it("rejects a file that isn't a workflow, and is skipped when declined", async () => {
    writeFileSync(join(cwd, "notes.json"), JSON.stringify({ hello: 1 }));
    const p = webAnswers([{ match: /Add screen reader testing/, answer: false }]);
    const calls: string[][] = [];
    await runWizard(deps(cwd, p, { scanAxe: async () => empty("axe"), scanLighthouse: async () => empty("lighthouse"), runScreenReader: async (a) => (calls.push(a), 0) }));
    expect(calls).toEqual([]);
    expect(loadSession(cwd)!.screenReader).toBeUndefined();

    const { findWorkflowFiles } = await import("../src/screen-reader/baseline.js");
    expect(findWorkflowFiles([join(cwd, "notes.json")])).toEqual({ error: `notes.json isn't a screen reader workflow (needs "name", "url" and "steps")` });
  });
});
