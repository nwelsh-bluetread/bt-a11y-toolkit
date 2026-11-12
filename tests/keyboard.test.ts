import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { analyzeKeyboard } from "../src/keyboard/analyze.js";
import type { KbElement, KbResult, KbStop } from "../src/keyboard/results.js";
import { runKeyboard } from "../src/keyboard/runner.js";
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
