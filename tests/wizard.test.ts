import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checklistFor } from "../src/checklist.js";
import { runWizard, type WizardDeps } from "../src/wizard/index.js";
import type { Choice, Prompter } from "../src/wizard/prompts.js";
import { loadSession, sessionWcagRollup } from "../src/wizard/session.js";
import type { Assessment } from "../src/types.js";

type Answer = (message: string, choices?: Choice<unknown>[]) => unknown;

/**
 * A prompter driven by `[pattern, answer]` rules: the first rule whose pattern
 * matches the prompt message answers it. Rules marked `once` are consumed.
 */
function scripted(rules: Array<{ match: RegExp; answer: unknown | Answer; once?: boolean }>): Prompter & { log: string[] } {
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

/** Pick a menu choice whose label contains `text`. */
const choose = (text: string): Answer => (_, choices) => {
  const c = choices!.find((ch) => ch.name.includes(text));
  if (!c) throw new Error(`No choice containing "${text}"`);
  return c.value;
};

function deps(cwd: string, prompter: Prompter, overrides: Partial<WizardDeps> = {}): WizardDeps {
  const fail = async (): Promise<Assessment> => {
    throw new Error("scanner should not run");
  };
  return {
    prompter,
    cwd,
    out: () => {},
    env: {},
    resolveUrls: async (o) => o.urls ?? [],
    scanAxe: fail,
    scanLighthouse: fail,
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

describe("runWizard — mobile app", () => {
  it("runs setup, the iOS checklist with one failure, and writes a report", async () => {
    mkdirSync(join(cwd, ".git"));
    const iosItems = checklistFor("ios", "AA");
    let checked = 0;

    const p = scripted([
      { match: /Project \/ client name/, answer: "Acme Mobile" },
      { match: /What are you auditing/, answer: "mobile" },
      { match: /Which mobile platforms/, answer: ["ios"] },
      { match: /How is the app built/, answer: "react-native" },
      { match: /Target WCAG/, answer: "AA" },
      { match: /gitignore/, answer: true },
      // Main menu: checklist first, then report, then exit.
      { match: /What next/, answer: choose("Manual checklist — iOS"), once: true },
      {
        match: /^Result:/,
        answer: () => (checked++ === 0 ? "fail" : "pass"),
      },
      { match: /Issue title/, answer: undefined }, // accept default (item title)
      { match: /Screen \/ flow/, answer: "Login" },
      { match: /What happens/, answer: "Sign-in button announced as 'button' with no name" },
      { match: /^Severity/, answer: "critical" },
      { match: /Suggested fix/, answer: "Add accessibilityLabel='Sign in'" },
      { match: /Screenshot/, answer: "evidence/login.png" },
      { match: /Log another issue for this check/, answer: false },
      { match: /What next/, answer: choose("Generate audit report"), once: true },
      { match: /What next/, answer: choose("Save & exit"), once: true },
    ]);

    await runWizard(deps(cwd, p));

    expect(checked).toBe(iosItems.length);
    expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toContain("a11y-audit/");

    const session = loadSession(cwd)!;
    expect(session.project).toMatchObject({ name: "Acme Mobile", type: "mobile", targets: ["ios"], targetLevel: "AA" });
    const results = session.checklist.ios!;
    expect(Object.keys(results)).toHaveLength(iosItems.length);
    const failed = results[iosItems[0]!.id]!;
    expect(failed.status).toBe("fail");
    expect(failed.findings[0]).toMatchObject({
      ruleId: `manual:${iosItems[0]!.id}`,
      title: iosItems[0]!.title,
      severity: "critical",
      platforms: ["ios"],
      source: "manual",
      nodeId: "Login",
      evidence: { screen: "Login", screenshot: "evidence/login.png" },
    });

    const report = readFileSync(join(cwd, "a11y-audit", "report.md"), "utf8");
    expect(report).toContain("# Accessibility Assessment — Acme Mobile");
    expect(report).toContain("Sign-in button announced");
    expect(report).toContain("**Screen:** Login");
    expect(existsSync(join(cwd, "a11y-audit", "report.json"))).toBe(true);
  });

  it("logs scanner findings for each mobile platform", async () => {
    const p = scripted([
      { match: /Project \/ client name/, answer: "Acme" },
      { match: /What are you auditing/, answer: "mobile" },
      { match: /Which mobile platforms/, answer: ["ios", "android"] },
      { match: /How is the app built/, answer: "native" },
      { match: /Target WCAG/, answer: "A" },
      { match: /What next/, answer: choose("Automated scans"), once: true },
      { match: /Which platforms do you want to scan/, answer: ["ios", "android"] },
      { match: /Did the scanner find real issues/, answer: "log", once: true },
      { match: /Issue title/, answer: "Small close button" },
      { match: /Screen \/ flow/, answer: "Settings" },
      { match: /What happens/, answer: "Close button is 20x20" },
      { match: /^Severity/, answer: "medium" },
      { match: /WCAG criteria/, answer: "2.5.8" },
      { match: /^Category/, answer: "Touch Targets" },
      { match: /Suggested fix/, answer: "" },
      { match: /Screenshot/, answer: "" },
      { match: /Log another issue from the scanner/, answer: "done" },
      { match: /Did the scanner find real issues/, answer: "done" },
      { match: /What next/, answer: choose("Save & exit"), once: true },
    ]);

    await runWizard(deps(cwd, p));

    const session = loadSession(cwd)!;
    expect(session.automated.map((r) => [r.tool, r.findings.length])).toEqual([
      ["ios-accessibility-inspector", 1],
      ["android-accessibility-scanner", 0],
    ]);
    expect(session.automated[0]!.findings[0]).toMatchObject({
      ruleId: "ios-inspector:small-close-button",
      source: "ios-inspector",
      wcag: [{ id: "2.5.8" }],
      category: "Touch Targets",
    });
  });
});

describe("runWizard — website", () => {
  it("runs the selected scanners and offers to install missing ones", async () => {
    const commands: string[] = [];
    const scanned: string[][] = [];
    const fakeAssessment = (tool: string): Assessment => ({
      generatedAt: "",
      platform: "web",
      targetLevel: "AA",
      overallScore: 90,
      counts: { critical: 0, high: 1, medium: 0, low: 0 },
      wcag: { A: 90, AA: 80, AAA: 70 },
      categories: [],
      topIssues: [],
      findings: [{ ruleId: `${tool}:x`, title: "x", description: "", severity: "high", wcag: [], source: tool }],
    });

    const p = scripted([
      { match: /Project \/ client name/, answer: "Acme Web" },
      { match: /What are you auditing/, answer: "web" },
      { match: /Target WCAG/, answer: "AA" },
      { match: /What next/, answer: choose("Automated scans"), once: true },
      { match: /Which pages/, answer: "urls" },
      { match: /^URLs/, answer: "https://acme.test https://acme.test/about" },
      { match: /Which scanners/, answer: ["axe", "lighthouse"] },
      { match: /needs playwright/, answer: true },
      { match: /What next/, answer: choose("Save & exit"), once: true },
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
          return fakeAssessment("axe");
        },
        scanLighthouse: async () => fakeAssessment("lighthouse"),
      }),
    );

    expect(commands).toEqual([
      "npm install -D playwright @axe-core/playwright",
      "npx playwright install chromium",
    ]);
    expect(scanned).toEqual([["https://acme.test", "https://acme.test/about"]]);
    const session = loadSession(cwd)!;
    expect(session.project.urls).toHaveLength(2);
    expect(session.automated.map((r) => r.tool)).toEqual(["axe", "lighthouse"]);
    expect(sessionWcagRollup(session)).toEqual({ A: 90, AA: 80, AAA: 70 });
  });

  it("resumes a saved audit instead of re-running setup", async () => {
    mkdirSync(join(cwd, "a11y-audit"));
    writeFileSync(
      join(cwd, "a11y-audit", "session.json"),
      JSON.stringify({
        version: 1,
        createdAt: "",
        updatedAt: "",
        project: { name: "Saved", type: "web", targets: ["web"], targetLevel: "AA" },
        automated: [],
        checklist: {},
        extraFindings: [],
      }),
    );
    const p = scripted([
      { match: /What would you like to do/, answer: "continue" },
      { match: /What next/, answer: choose("Save & exit") },
    ]);

    await runWizard(deps(cwd, p));

    expect(p.log.some((m) => /Project \/ client name/.test(m))).toBe(false);
  });
});
