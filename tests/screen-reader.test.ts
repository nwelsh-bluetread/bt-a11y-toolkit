import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeTranscript, reviewFindings } from "../src/screen-reader/analyze.js";
import { alignPages, loadTranscripts, sameUrl } from "../src/screen-reader/load.js";
import type { FocusedControl, Spoken, Transcript, TranscriptStep } from "../src/screen-reader/transcript.js";
import { planChecklist, renderChecklist } from "../src/wizard/checklist-md.js";

const PAGE = "https://acme.test/login";
let dom = 0;

function ctl(role: string, name: string, extra: Partial<FocusedControl> = {}): FocusedControl {
  return { role, name, states: [], tag: role === "link" ? "a" : "div", domIndex: (dom += 10), ...extra };
}

function said(spoken: string, focus?: FocusedControl): Spoken {
  return { spoken, item: spoken, ...(focus ? { focus } : {}) };
}

function step(kind: string, output: Spoken[], extra: Partial<TranscriptStep> = {}): TranscriptStep {
  return { step: 1, action: kind, kind, url: PAGE, output, ...extra };
}

function transcript(...steps: TranscriptStep[]): Transcript {
  return { version: 1, workflow: "Login", url: PAGE, ranAt: "", steps: steps.map((s, i) => ({ ...s, step: i + 1 })) };
}

const rules = (t: Transcript) => analyzeTranscript(t).map((f) => f.ruleId);

describe("analyzeTranscript", () => {
  it("passes a clean run", () => {
    const t = transcript(
      step("read", [said("heading level 1 Sign in"), said("Email edit text"), said("heading level 2 Help")]),
      step("tab", [said("Email edit text", ctl("textbox", "Email")), said("Remember me unchecked checkbox", ctl("checkbox", "Remember me")), said("Sign in button", ctl("button", "Sign in"))], { tab: { stopped: "left-page", unreached: [] } }),
      step("activate", [said("Enter your email address")], { expect: "email address", passed: true }),
    );
    expect(analyzeTranscript(t)).toEqual([]);
  });

  it("flags controls with no name, or that say nothing on focus", () => {
    const t = transcript(step("tab", [said("edit text", ctl("textbox", "")), said("button", ctl("button", "")), said("", ctl("link", "Help"))]));
    const found = analyzeTranscript(t);
    expect(found.map((f) => [f.ruleId, f.title])).toEqual([
      ["sr-no-name", "Form field has no accessible name"],
      ["sr-no-name", "Button has no accessible name"],
      ["sr-silent-focus", "Nothing announced when the control received focus"],
    ]);
    expect(found[0]!.wcag.map((c) => c.id)).toEqual(["4.1.2", "3.3.2"]);
    expect(found[0]!.nodeId).toBe("textbox (no name)");
  });

  it("flags a checkbox announced without its state", () => {
    expect(rules(transcript(step("tab", [said("Remember me checkbox", ctl("checkbox", "Remember me"))])))).toEqual(["sr-missing-state"]);
    expect(rules(transcript(step("tab", [said("Dark mode switch on", ctl("switch", "Dark mode"))])))).toEqual([]);
  });

  it("flags a dropdown or accordion announced without expanded/collapsed", () => {
    const menu = ctl("button", "Country", { expanded: false });
    expect(rules(transcript(step("tab", [said("Country, pop up button", menu)])))).toEqual(["sr-missing-expanded"]);
    expect(rules(transcript(step("tab", [said("Country, collapsed, pop up button", menu)])))).toEqual([]);
    // Not expandable: no expanded state to announce.
    expect(rules(transcript(step("tab", [said("Sign in button", ctl("button", "Sign in"))])))).toEqual([]);
  });

  it("checks that activating a dropdown opens it and that the change is announced", () => {
    const menu = ctl("button", "Country", { expanded: false });
    const open = { ...menu, expanded: true };
    const activate = (spoken: string, focus: FocusedControl | undefined, after: boolean | undefined) =>
      rules(transcript(step("activate", [said(spoken, focus)], { toggle: { control: menu, before: false, ...(after !== undefined ? { after } : {}) } })));

    expect(activate("Country, collapsed, pop up button", menu, false)).toEqual(["sr-expanded-unchanged"]);
    expect(activate("expanded", open, true)).toEqual([]);
    expect(activate("Country, pop up button", open, true)).toEqual(["sr-missing-expanded", "sr-expanded-change-silent"]);
    // Focus moved into the opened list: VoiceOver reads the first option instead, which is fine.
    expect(activate("Canada, menu item", ctl("menuitem", "Canada"), true)).toEqual([]);
    // The control went away (e.g. replaced on open): nothing to compare.
    expect(activate("Canada, menu item", ctl("menuitem", "Canada"), undefined)).toEqual([]);

    const [f] = analyzeTranscript(transcript(step("activate", [said("Country, collapsed, pop up button", menu)], { toggle: { control: menu, before: false, after: false } })));
    expect(f!.title).toBe("Activating it didn't open it");
    expect(f!.wcag.map((c) => c.id)).toEqual(["4.1.2", "2.1.1"]);
  });

  it("flags generic link text and same-named links to different places", () => {
    const t = transcript(step("tab", [
      said("link Read more", ctl("link", "Read more", { href: "/a" })),
      said("link Pricing", ctl("link", "Pricing", { href: "/pricing" })),
      said("link Pricing", ctl("link", "Pricing", { href: "/plans" })),
    ]));
    expect(rules(t)).toEqual(["sr-generic-link", "sr-ambiguous-links"]);
  });

  it("flags images read out as file names or unlabelled", () => {
    const t = transcript(step("read", [said("image hero_banner-2.jpg"), said("unlabelled image"), said("image Team photo")]));
    expect(analyzeTranscript(t).map((f) => f.title)).toEqual(["Image is announced by its file name", "Image has no text alternative"]);
  });

  it("checks heading structure on full reads only", () => {
    expect(rules(transcript(step("read", [said("heading level 1 A"), said("heading level 3 B")])))).toEqual(["sr-heading-skip"]);
    expect(rules(transcript(step("read", Array.from({ length: 12 }, (_, i) => said(`text ${i}`)))))).toEqual(["sr-no-headings"]);
    expect(rules(transcript(step("next", [said("heading level 1 A"), said("heading level 4 B")])))).toEqual([]);
  });

  it("flags focus order going backwards, positive tabindex, traps and unreachable controls", () => {
    const t = transcript(step("tab", [
      said("Search button", ctl("button", "Search", { domIndex: 50, tabindex: 2 })),
      said("Home link", ctl("link", "Home", { domIndex: 5 })),
    ], { tab: { stopped: "repeated", unreached: [ctl("button", "Open menu")] } }));
    const found = analyzeTranscript(t);
    expect(found.map((f) => f.ruleId)).toEqual(["sr-positive-tabindex", "sr-focus-order", "sr-keyboard-trap", "sr-unreachable"]);
    expect(found.find((f) => f.ruleId === "sr-unreachable")!.wcag[0]!.id).toBe("2.1.1");
  });

  it("turns a missed expect into a finding, using the step's WCAG when given", () => {
    const status = analyzeTranscript(transcript(step("activate", [said("Sign in button")], { expect: "Enter your email", passed: false })));
    expect(status[0]!.wcag.map((c) => c.id)).toEqual(["4.1.3"]);
    expect(status[0]!.description).toContain("It said: “Sign in button”");
    const custom = analyzeTranscript(transcript(step("activate", [said("")], { expect: "Error", passed: false, wcag: ["3.3.1"] })));
    expect(custom[0]!.wcag.map((c) => c.id)).toEqual(["3.3.1"]);
    // A step that errored is a workflow problem, not a page finding.
    expect(analyzeTranscript(transcript(step("activate", [], { expect: "x", passed: false, error: "timeout" })))).toEqual([]);
  });

  it("marks every finding for review, with the page, step and what was said", () => {
    const [f] = analyzeTranscript(transcript(step("tab", [said("button", ctl("button", ""))])), "reports/screen-reader/login.json");
    expect(f!.source).toBe("voiceover");
    expect(f!.evidence).toEqual({ page: PAGE, workflow: "Login", step: "1. tab", spoken: "button", transcript: "reports/screen-reader/login.json", needsReview: true });
  });

  it("dedupes the same issue on the same element", () => {
    const button = ctl("button", "");
    expect(analyzeTranscript(transcript(step("tab", [said("button", button)]), step("tab", [said("button", button)])))).toHaveLength(1);
  });
});

describe("reviewFindings", () => {
  it("converts AI review entries, dropping unknown WCAG ids", () => {
    const t = transcript(step("read", [said("image photo")]));
    const found = reviewFindings(t, {
      findings: [
        { step: 1, title: "Alt text doesn't describe the image", description: "“photo” says nothing about it.", wcag: ["1.1.1"], severity: "medium" },
        { step: 1, title: "Bogus", description: "", wcag: ["9.9.9"], severity: "low" },
      ],
    });
    expect(found).toHaveLength(1);
    expect(found[0]!).toMatchObject({ ruleId: "sr-ai-review", source: "voiceover-ai", severity: "medium" });
    expect(found[0]!.evidence?.needsReview).toBe(true);
  });
});

describe("loading transcripts", () => {
  it("reads transcripts and reviews from a folder, skipping other JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "sr-"));
    const t = transcript(step("tab", [said("button", ctl("button", ""))]));
    writeFileSync(join(dir, "login.json"), JSON.stringify(t));
    writeFileSync(join(dir, "login.review.json"), JSON.stringify({ findings: [{ step: 1, title: "Vague", description: "", wcag: ["2.4.6"], severity: "low" }] }));
    writeFileSync(join(dir, "other.json"), JSON.stringify({ hello: 1 }));
    const loaded = loadTranscripts(dir, dir);
    expect(loaded.transcripts.map((x) => [x.file, x.findings, x.reviewed])).toEqual([["login.json", 2, true]]);
    expect(loaded.pages).toEqual([PAGE]);
  });

  it("matches pages to the audit's URLs ignoring trailing slash and #hash", () => {
    expect(sameUrl("https://acme.test/login/", "https://acme.test/login#top")).toBe(true);
    const [f] = alignPages(analyzeTranscript(transcript(step("tab", [said("button", ctl("button", ""))]))), ["https://acme.test/login/"]);
    expect(f!.evidence?.page).toBe("https://acme.test/login/");
  });
});

describe("on the checklist", () => {
  it("pre-fills the page's matching check as not reviewed yet", () => {
    const groups = planChecklist([{ name: "Login", kind: "web", url: PAGE }], ["web"], "AA");
    const findings = analyzeTranscript(transcript(step("tab", [said("edit text", ctl("textbox", ""))])));
    const md = renderChecklist({ projectName: "Acme", targetLevel: "AA", groups, runs: [{ tool: "voiceover", targets: ["web"], ranAt: "", findings }] });
    const login = md.slice(md.indexOf("### Login"), md.indexOf("### App-wide"));
    expect(login).toContain("- [!] **4.1.2** Screen reader announces the name, role, and state of every control · `sr-name-role-value` — scan found issues · not reviewed yet\n  ⚑ High · Form field has no accessible name — textbox (no name)");
  });
});
