import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { analyzeKeyboard } from "../src/keyboard/analyze.js";
import type { KbElement, KbResult, KbStop } from "../src/keyboard/results.js";
import { runKeyboard } from "../src/keyboard/runner.js";
import { checkResults, formatKeyboardSummary } from "../src/keyboard/summary.js";
import type { Workflow } from "../src/screen-reader/workflow.js";

const FIXTURE = pathToFileURL(resolve("screen-reader/fixtures/keyboard.html")).href;
const out = mkdtempSync(join(tmpdir(), "bt-a11y-kb-"));
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe("keyboard runner (real browser)", () => {
  it("finds the fixture's built-in keyboard problems", async () => {
    const wf: Workflow = {
      id: "dialog",
      name: "Keyboard: dialog",
      url: FIXTURE,
      steps: [{ activate: "#dead" }, { activate: "#open" }, { press: "Escape" }, { find: "heading" }],
    };
    const results = await runKeyboard({ pages: [FIXTURE], workflows: [wf], outDir: out });
    const [page, flow] = results;
    expect(page!.error).toBeUndefined();
    expect(page!.skipLink).toMatchObject({ present: true, works: true, position: 2 });

    const byName = new Map(page!.steps[0]!.tab!.stops.map((s) => [s.name, s]));
    expect(byName.get("Has a focus ring")!.indicator).toBe("visible");
    expect(byName.get("No focus ring")!.indicator).toBe("none");
    expect(byName.get("Covered by the cookie banner")!.obscured).toBe(true);
    expect(page!.steps[0]!.tab!.unreached.map((u) => u.name)).toEqual(["Mouse-only button"]);

    expect(flow!.steps.map((s) => s.activated?.changed ?? s.escape?.focusReturned ?? s.skipped)).toEqual([false, true, true, true]);
    expect(flow!.steps[1]!.dialog).toMatchObject({ focusInside: true });

    const findings = analyzeKeyboard(results.map((result) => ({ result })));
    expect(findings.map((f) => f.ruleId).sort()).toEqual(
      ["kb-activate-nothing", "kb-focus-obscured", "kb-focus-order", "kb-no-focus-indicator", "kb-positive-tabindex", "kb-unreachable"].sort(),
    );
    expect(findings.every((f) => f.evidence?.needsReview === true && f.source === "keyboard")).toBe(true);
    expect(findings.find((f) => f.ruleId === "kb-no-focus-indicator")!.nodeId).toBe('button "No focus ring"');

    // The summary lists every check: what failed matches the findings, the rest passed or didn't apply.
    const status = (r: KbResult) => Object.fromEntries(checkResults(r).map((c) => [c.id, c.status]));
    expect(status(page!)).toEqual({
      "focus-indicator": "fail",
      "focus-not-obscured": "fail",
      "focus-order": "fail",
      "no-trap": "pass",
      "all-reachable": "fail",
      bypass: "pass",
      activate: "not-checked",
      "dialog-focus": "not-checked",
      "dialog-return": "not-checked",
    });
    expect(status(flow!)).toMatchObject({ activate: "fail", "dialog-focus": "pass", "dialog-return": "pass", "no-trap": "pass", "focus-indicator": "not-checked" });
    const md = formatKeyboardSummary(results.map((result) => ({ result })), "Acme");
    expect(md).toContain("# Keyboard test results — Acme");
    expect(md).toContain("| Visible focus indicator | 2.4.7 | ❌ Fail | No visible focus indicator: button “No focus ring” |");
    expect(md).toContain("| Skip link or landmark to bypass repeated content | 2.4.1 | ✅ Pass | Skip link “Skip to main content” works (but it's Tab stop 2, not the first) |");
    expect(md).toContain("## Workflow: Keyboard: dialog");
  }, 60_000);
});

describe("analyzeKeyboard", () => {
  let dom = 0;
  const el = (name: string, extra: Partial<KbElement> = {}): KbElement => ({ role: "button", name, tag: "button", domIndex: (dom += 10), ...extra });
  const stop = (name: string, extra: Partial<KbStop> = {}): KbStop => ({ ...el(name), indicator: "visible", obscured: false, inMain: true, ...extra });
  const page = (extra: Partial<KbResult>, stops: KbStop[] = [], stopped: "left-page" | "wrapped" | "repeated" = "left-page"): KbResult => ({
    version: 1,
    kind: "page",
    name: "https://acme.test/",
    url: "https://acme.test/",
    ranAt: "",
    steps: [{ step: 1, action: "tab", kind: "tab", url: "https://acme.test/", tab: { stops, stopped, unreached: [] } }],
    ...extra,
  });
  const rules = (r: KbResult) => analyzeKeyboard([{ result: r }]).map((f) => f.ruleId);

  it("passes a clean page, and wrapping back to the first stop isn't a trap", () => {
    expect(rules(page({ skipLink: { present: true, works: true, position: 1 }, hasMain: true }, [stop("A"), stop("B")], "wrapped"))).toEqual([]);
  });

  it("flags a loop that skips part of the page", () => {
    expect(rules(page({ hasMain: true }, [stop("A"), stop("B")], "repeated"))).toEqual(["kb-keyboard-trap"]);
  });

  it("flags a broken skip link, and a page with no way to bypass its header", () => {
    expect(rules(page({ skipLink: { present: true, name: "Skip", works: false }, hasMain: true }))).toEqual(["kb-skip-link-broken"]);
    const header = ["Home", "About", "Blog", "Shop", "Help"].map((n) => stop(n, { inMain: false }));
    expect(rules(page({ skipLink: { present: false }, hasMain: false }, [...header, stop("Content")]))).toEqual(["kb-no-bypass"]);
    // No main landmark at all: every stop counts as before the content.
    expect(rules(page({ skipLink: { present: false }, hasMain: false }, ["Home", "About", "Blog", "Shop", "Help"].map((n) => stop(n, { inMain: false }))))).toEqual(["kb-no-bypass"]);
    // A main landmark is an accepted way to bypass blocks.
    expect(rules(page({ skipLink: { present: false }, hasMain: true }, [...header, stop("Content")]))).toEqual([]);
  });

  it("flags dialogs that don't take focus, don't close on Escape, or lose the opener", () => {
    const opener = el("Settings");
    const wf = (steps: KbResult["steps"]): KbResult => ({ version: 1, kind: "workflow", name: "Dialog", url: "https://acme.test/", ranAt: "", steps });
    expect(rules(wf([{ step: 1, action: "activate", kind: "activate", url: "https://acme.test/", activated: { target: opener, key: "Enter", changed: true }, dialog: { focusInside: false, opener } }]))).toEqual(["kb-dialog-focus"]);
    expect(rules(wf([{ step: 1, action: "press Escape", kind: "press", url: "https://acme.test/", escape: { closed: false, focusReturned: false, opener } }]))).toEqual(["kb-dialog-escape"]);
    expect(rules(wf([{ step: 1, action: "press Escape", kind: "press", url: "https://acme.test/", escape: { closed: true, focusReturned: false, opener } }]))).toEqual(["kb-dialog-focus-return"]);
  });

  it("groups controls without a focus indicator into one finding per page", () => {
    const f = analyzeKeyboard([{ result: page({ hasMain: true }, ["A", "B", "C"].map((n) => stop(n, { indicator: "none" }))) }]);
    expect(f).toHaveLength(1);
    expect(f[0]!.title).toBe("3 controls show no visible focus indicator");
    expect(f[0]!.wcag.map((c) => c.id)).toEqual(["2.4.7"]);
  });
});

describe("matching results to audit pages, and spotting runs that didn't test the page", () => {
  it("matches the same path on another port, but not another host or an ambiguous path", async () => {
    const { matchAuditUrl } = await import("../src/screen-reader/load.js");
    const audit = ["http://localhost:4173/login", "http://localhost:4173/branches/"];
    expect(matchAuditUrl("http://localhost:4173/login#top", audit)).toBe("http://localhost:4173/login");
    expect(matchAuditUrl("http://localhost:5173/branches", audit)).toBe("http://localhost:4173/branches/");
    expect(matchAuditUrl("https://staging.acme.test/login", audit)).toBeUndefined();
    expect(matchAuditUrl("http://localhost:5173/login", [...audit, "http://localhost:3000/login"])).toBeUndefined();
  });

  it("warns about failed loads, redirects, and pages where Tab found almost nothing", async () => {
    const { runWarnings } = await import("../src/keyboard/summary.js");
    const base = { version: 1 as const, kind: "page" as const, ranAt: "" };
    const iframe = { role: "iframe", name: "", tag: "iframe", domIndex: 54, indicator: "unknown" as const, obscured: false, inMain: false };
    const tab = (stops: KbStop[]) => [{ step: 1, action: "tab", kind: "tab", url: "", tab: { stops, stopped: "left-page" as const, unreached: [] } }];

    expect(runWarnings({ ...base, name: "http://localhost:4173/x", url: "http://localhost:4173/x", steps: [], error: "net::ERR_CONNECTION_REFUSED" })[0]).toMatch(/^Couldn't load the page/);
    expect(runWarnings({ ...base, name: "http://localhost:4173/users", url: "http://localhost:4173/login", steps: tab([]) }).join(" ")).toMatch(/Redirected from \/users to \/login/);
    // What the dev server gave: only the dev-tools iframe.
    expect(runWarnings({ ...base, name: "http://localhost:5173/branches", url: "http://localhost:5173/branches", steps: tab([iframe]) })).toEqual([
      expect.stringMatching(/^Tab found no controls on the page \(plus an iframe\)/),
    ]);
    const fine = ["A", "B", "C"].map((n, i) => ({ ...iframe, role: "button", tag: "button", name: n, domIndex: i, indicator: "visible" as const, inMain: true }));
    expect(runWarnings({ ...base, name: "http://a.test/", url: "http://a.test/", steps: tab(fine) })).toEqual([]);
  });
});
