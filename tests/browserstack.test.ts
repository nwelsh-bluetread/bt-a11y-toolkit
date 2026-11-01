import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  browserStackFindings,
  detectPlatform,
  isBrowserStackCsv,
  parseBrowserStackCsv,
  parseCsv,
  scanSummaries,
} from "../src/integrations/browserstack.js";
import { buildSummaryData } from "../src/pdf/summary.js";
import { browserStackStep, findBrowserStackCsvs, importBrowserStackCsv } from "../src/wizard/browserstack.js";
import { writeChecklistFiles } from "../src/wizard/index.js";
import type { Prompter } from "../src/wizard/prompts.js";
import { newSession, writeReports, type AuditSession } from "../src/wizard/session.js";

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const HEADER =
  "Issue Type,Issue Description,WCAG,Severity,Element ID,Scan Number,Issue Index,Needs Review,Duplicate,Experimental,Issue Details,How to Fix,Element Properties,Issue Link,Docs Link";

function row(o: { type: string; wcag: string; sev: string; cls: string; scan: number; idx: number; review?: boolean; dup?: boolean; details: object; fix: string; props: object[] }): string {
  return [
    q(o.type),
    q(`${o.type} description,\n with a comma and a newline.`),
    `WCAG 2.2-${o.wcag} AA`,
    o.sev,
    o.cls,
    o.scan,
    o.idx,
    o.review ? "Yes" : "No",
    o.dup ? "TRUE" : "FALSE",
    "FALSE",
    q(JSON.stringify(o.details)),
    q(o.fix),
    q(JSON.stringify(o.props)),
    `https://app-accessibility.browserstack.com/report/abc?locator=${o.scan}-${o.idx}`,
    "https://www.browserstack.com/docs/app-accessibility/rule-repository/rules-list/x",
  ].join(",");
}

const enc = (v: unknown) => JSON.stringify(v);
const CSV = [
  "Created By,Tester",
  q("Created At") + "," + q("Oct 28, 2026, 04:04:40 PM"),
  "WCAG Version,WCAG 2.2 AA",
  "App Package Name,com.acme.app",
  "Device,iPhone 17 Pro",
  q("Issue Summary") + "," + q("Total 3, Critial 1, Serious 2, Moderate 0, Minor 0"),
  "Report Link,https://app-accessibility.browserstack.com/report/abc",
  "",
  HEADER,
  row({ type: "App Orientation Lock", wcag: "1.3.4", sev: "Critical", cls: "UIWindow", scan: 1, idx: 1, details: { portrait: true, landscape: false }, fix: "Support both orientations in Info.plist.", props: [{ portrait: true }] }),
  row({
    type: "Text Element Color Contrast (Minimum)",
    wcag: "1.4.3",
    sev: "Serious",
    cls: "RCTParagraphComponentView",
    scan: 1,
    idx: 2,
    review: true,
    details: { detectedForegroundColor: enc("#657483"), detectedBackgroundColor: enc("#EFF0F2"), calculatedColorContrast: 4.21, fontSize: enc("16.0") },
    fix: "Darken the text.",
    props: [{ class: enc("RCTParagraphComponentView") }, { visibleText: enc("Current balance") }, { accessibilityLabel: enc("Current balance") }],
  }),
  row({
    type: "Touch Target Size & Spacing",
    wcag: "2.5.8",
    sev: "Serious",
    cls: "RCTViewComponentView",
    scan: 2,
    idx: 1,
    details: { calculatedWidth: enc("16"), calculatedHeight: enc("16") },
    fix: "Make it 24x24.",
    props: [{ identifier: enc("carousel-dot-0") }, { accessibilityLabel: enc("Go to slide 1 of 2") }],
  }),
  // The same issue seen again in scan 2: BrowserStack doesn't count it.
  row({ type: "App Orientation Lock", wcag: "1.3.4", sev: "Critical", cls: "UIWindow", scan: 2, idx: 2, dup: true, details: { portrait: true, landscape: false }, fix: "x", props: [] }),
  "",
].join("\n");

describe("BrowserStack CSV parsing", () => {
  it("parses quoted fields with commas, newlines, and doubled quotes", () => {
    expect(parseCsv('a,"b,c","d\n""e"""\r\nf,g')).toEqual([
      ["a", "b,c", 'd\n"e"'],
      ["f", "g"],
    ]);
  });

  it("reads the metadata and every issue, decoding BrowserStack's double-encoded values", () => {
    expect(isBrowserStackCsv(CSV)).toBe(true);
    expect(isBrowserStackCsv("name,email\na,b")).toBe(false);
    const report = parseBrowserStackCsv(CSV);
    expect(report.meta["Device"]).toBe("iPhone 17 Pro");
    expect(report.meta["Report Link"]).toBe("https://app-accessibility.browserstack.com/report/abc");
    expect(report.issues).toHaveLength(4);
    const contrast = report.issues[1]!;
    expect(contrast).toMatchObject({ severity: "high", severityLabel: "Serious", scan: 1, needsReview: true, duplicate: false });
    expect(contrast.wcag.map((c) => c.id)).toEqual(["1.4.3"]);
    expect(contrast.details).toMatchObject({ detectedForegroundColor: "#657483", calculatedColorContrast: 4.21, fontSize: "16.0" });
    expect(contrast.element.accessibilityLabel).toBe("Current balance");
    expect(report.issues[0]!.severity).toBe("critical");
    expect(report.issues[3]!.duplicate).toBe(true);
  });

  it("rejects a CSV without the issue header", () => {
    expect(() => parseBrowserStackCsv("a,b\n1,2")).toThrow(/Not a BrowserStack/);
  });

  it("detects the platform from the device name, then element classes", () => {
    const report = parseBrowserStackCsv(CSV);
    expect(detectPlatform(report)).toBe("ios");
    expect(detectPlatform({ ...report, meta: { Device: "Google Pixel 9" } })).toBe("android");
    expect(detectPlatform({ meta: {}, issues: [{ ...report.issues[0]!, elementClass: "android.widget.Button" }] })).toBe("android");
    expect(detectPlatform({ meta: {}, issues: [] })).toBeUndefined();
  });

  it("summarizes each scan so the tester can tell which screen it was", () => {
    expect(scanSummaries(parseBrowserStackCsv(CSV))).toEqual([
      { scan: 1, issues: 2, duplicates: 0, elements: ["Current balance"], appWideOnly: false },
      { scan: 2, issues: 1, duplicates: 1, elements: ["Go to slide 1 of 2"], appWideOnly: false },
    ]);
  });
});

describe("browserStackFindings", () => {
  const findings = browserStackFindings(parseBrowserStackCsv(CSV), { platform: "ios", screens: { 1: "Home", 2: "Billing" }, file: "scan.csv" });

  it("makes one finding per issue, skipping BrowserStack's duplicates", () => {
    expect(findings).toHaveLength(3);
    expect(findings.every((f) => f.source === "browserstack" && f.platforms?.[0] === "ios")).toBe(true);
  });

  it("puts each issue on its scan's screen, and app-level issues app-wide", () => {
    expect(findings.map((f) => f.evidence?.screen)).toEqual(["App-wide", "Home", "Billing"]);
  });

  it("keeps the measured values, the element, and the fix", () => {
    const contrast = findings[1]!;
    expect(contrast).toMatchObject({
      ruleId: "browserstack:text-element-color-contrast-minimum",
      title: "Text Element Color Contrast (Minimum) — Current balance",
      severity: "high",
      nodeId: "Current balance",
      category: "Contrast",
    });
    expect(contrast.description).toContain('"Current balance": #657483 on #EFF0F2 is 4.21:1 at 16pt');
    expect(contrast.description).toContain("flagged this one for review");
    expect(contrast.remediation).toContain("Darken the text.");
    expect(contrast.evidence).toMatchObject({ scan: 1, needsReview: true, report: "https://app-accessibility.browserstack.com/report/abc", csv: "scan.csv" });
    expect(findings[2]!.description).toContain("measures 16×16");
    expect(findings[2]!.category).toBe("Touch Targets");
  });

  it("leaves scans with no screen app-wide", () => {
    const unmapped = browserStackFindings(parseBrowserStackCsv(CSV), { platform: "ios" });
    expect(unmapped.map((f) => f.evidence?.screen)).toEqual(["App-wide", "App-wide", "App-wide"]);
  });
});

describe("importing into a guided audit", () => {
  let cwd: string;
  let session: AuditSession;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "bt-a11y-bs-"));
    writeFileSync(join(cwd, "AppA11y_acme.csv"), CSV);
    session = newSession({ name: "Acme", type: "mobile", targets: ["ios", "android"], targetLevel: "AA" }, [
      { name: "Home", kind: "mobile" },
      { name: "Billing", kind: "mobile" },
    ]);
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  const prompter = (answers: Record<number, string>, log: string[] = []): Prompter => ({
    select: async (message) => {
      log.push(message);
      const scan = Number(/scan (\d+)/.exec(message)?.[1]);
      return (answers[scan] ?? "") as never;
    },
    checkbox: async () => [],
    input: async (_m, o) => o?.default ?? "",
    confirm: async () => true,
  });

  it("asks which screen each scan was, saves a run, copies the CSV, and pre-fills the checklist", async () => {
    const log: string[] = [];
    const out: string[] = [];
    const result = await importBrowserStackCsv({ cwd, prompter: prompter({ 1: "Home", 2: "Billing" }, log), out: (t) => out.push(t) }, session, join(cwd, "AppA11y_acme.csv"));
    expect(result).toEqual({ platform: "ios", findings: 3 });
    expect(log).toEqual([expect.stringContaining("scan 1? (2 issues · elements: Current balance)"), expect.stringContaining("scan 2? (1 issue")]);
    expect(out.join("\n")).toContain("Imported 3 BrowserStack issues (iOS) · 1 duplicate skipped · 1 flagged for review");

    const run = session.automated.find((r) => r.tool === "browserstack-ios")!;
    expect(run.targets).toEqual(["ios"]);
    expect(run.checked?.sort()).toEqual(["1.3.4", "1.4.3", "2.5.8"]);
    expect(existsSync(join(cwd, "a11y-audit", "browserstack", "AppA11y_acme.csv"))).toBe(true);

    writeChecklistFiles(cwd, session);
    const md = readFileSync(join(cwd, "a11y-audit", "checklist.md"), "utf8");
    const ios = md.slice(0, md.indexOf("# Android"));
    const home = ios.slice(ios.indexOf("### Home\n"), ios.indexOf("### Billing\n"));
    expect(home).toMatch(/\[!\] \*\*1\.4\.3[^\n]*scan found issues · not reviewed yet/);
    expect(home).toContain("Text Element Color Contrast (Minimum) — Current balance");
    // iOS-only scan: nothing on the Android side.
    expect(md.slice(md.indexOf("# Android"))).not.toContain("BrowserStack");
    expect(md.slice(md.indexOf("# Android"))).not.toContain("Current balance");
  });

  it("feeds the report and the summary PDF data", async () => {
    await importBrowserStackCsv({ cwd, prompter: prompter({ 1: "Home", 2: "Billing" }), out: () => {} }, session, join(cwd, "AppA11y_acme.csv"));
    const r = writeReports(cwd, session);
    expect(r.assessment.counts).toMatchObject({ critical: 1, high: 2 });
    const data = buildSummaryData(session, r.assessment, r.checklist);
    const contrast = data.findings.find((f) => f.rule === "browserstack:text-element-color-contrast-minimum")!;
    expect(contrast).toMatchObject({ reportedBy: "BrowserStack", pages: ["Home (iOS)"], element: "Current balance" });
    expect(data.findings.find((f) => f.rule === "browserstack:app-orientation-lock")!.pages).toEqual(["App-wide (iOS)"]);
    expect(data.footer).toContain("BrowserStack App Accessibility (iOS)");
    expect(data.severityGuide!.sources.map((s) => s.source)).toContain("BrowserStack App Accessibility");
    expect(readFileSync(r.markdown, "utf8")).toContain("Touch Target Size & Spacing");
  });

  it("replaces a re-imported report's issues, offering the earlier screen choices", async () => {
    const deps = { cwd, prompter: prompter({ 1: "Home", 2: "Billing" }), out: () => {} };
    await importBrowserStackCsv(deps, session, join(cwd, "AppA11y_acme.csv"));
    const defaults: unknown[] = [];
    const again: Prompter = { ...deps.prompter, select: async (_m, _c, o) => (defaults.push(o?.default), o?.default) as never };
    await importBrowserStackCsv({ ...deps, prompter: again }, session, join(cwd, "AppA11y_acme.csv"));
    expect(defaults).toEqual(["Home", "Billing"]);
    expect(session.automated.find((r) => r.tool === "browserstack-ios")!.findings).toHaveLength(3);
  });

  it("refuses a scan from a platform the audit doesn't include", async () => {
    const androidOnly = newSession({ name: "Acme", type: "mobile", targets: ["android"], targetLevel: "AA" });
    await expect(importBrowserStackCsv({ cwd, prompter: prompter({}), out: () => {} }, androidOnly, join(cwd, "AppA11y_acme.csv"))).rejects.toThrow(/iOS/);
  });

  it("suggests un-imported CSVs, and the step imports what's entered", async () => {
    expect(findBrowserStackCsvs(cwd)).toEqual(["AppA11y_acme.csv"]);
    writeFileSync(join(cwd, "other.csv"), "name,email\n");
    expect(await browserStackStep({ cwd, prompter: prompter({ 1: "Home" }), out: () => {} }, session)).toBe(1);
    // Copied into a11y-audit/browserstack/, so it's no longer suggested.
    expect(findBrowserStackCsvs(cwd)).toEqual([]);
  });
});
