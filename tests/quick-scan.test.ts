import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axeToAssessment } from "../src/integrations/axe.js";
import { QUICK_SCAN_DIR, quickScanBaseName, runQuickScan, type QuickScanDeps } from "../src/quick-scan.js";
import type { Assessment } from "../src/types.js";
import type { Prompter } from "../src/wizard/prompts.js";

const AXE = axeToAssessment(JSON.parse(readFileSync(join(__dirname, "..", "examples", "sample-axe-result.json"), "utf8")));
const EMPTY: Assessment = { ...AXE, findings: [] };

const noPrompts: Prompter = {
  select: async () => {
    throw new Error("unexpected prompt");
  },
  checkbox: async () => {
    throw new Error("unexpected prompt");
  },
  input: async () => {
    throw new Error("unexpected prompt");
  },
  confirm: async () => {
    throw new Error("unexpected prompt");
  },
};

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "bt-a11y-quick-"));
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

function deps(overrides: Partial<QuickScanDeps> = {}): QuickScanDeps & { output: string[]; scanned: string[][] } {
  const output: string[] = [];
  const scanned: string[][] = [];
  return {
    output,
    scanned,
    cwd,
    prompter: noPrompts,
    out: (t) => output.push(t),
    hasModule: async () => true,
    runCommand: async () => 0,
    scanAxe: async (urls) => {
      scanned.push(urls);
      return AXE;
    },
    scanLighthouse: async (urls) => {
      scanned.push(urls);
      return EMPTY;
    },
    ...overrides,
  };
}

describe("runQuickScan", () => {
  it("scans one page with both scanners and writes the report, summary data, and PDF", async () => {
    let pdfFrom: string | undefined;
    const d = deps({
      buildPdf: async (json) => {
        pdfFrom = json;
        return true;
      },
    });
    const result = await runQuickScan(d, { url: "https://example.com/pricing", level: "AA" });

    expect(d.scanned).toEqual([["https://example.com/pricing"], ["https://example.com/pricing"]]);
    expect(result!.assessment.findings.length).toBe(AXE.findings.length);
    const base = quickScanBaseName("https://example.com/pricing");
    expect(base).toMatch(/^a11y-quick-scan-example\.com-pricing-\d{4}-\d{2}-\d{2}$/);
    expect(result!.markdown).toBe(join(cwd, QUICK_SCAN_DIR, `${base}.md`));
    expect(result!.pdf).toBe(join(cwd, QUICK_SCAN_DIR, `${base}.pdf`));
    expect(pdfFrom).toBe(result!.json);
    // A full audit's folder is never created or touched.
    expect(existsSync(join(cwd, "a11y-audit"))).toBe(false);

    const md = readFileSync(result!.markdown, "utf8");
    expect(md).toMatch(/^# Accessibility Quick Scan — example\.com/);
    expect(md).toContain("automated checks only (axe-core, Lighthouse) of https://example.com/pricing");
    expect(md).toMatch(/## WCAG AA conformance: not yet met/);

    const data = JSON.parse(readFileSync(result!.json, "utf8"));
    expect(data).toMatchObject({ title: "example.com", scope: "1 page · https://example.com/pricing", pageNoun: "page", targetLevel: "AA" });
    expect(data.subtitle).toContain("No manual testing was done");
    expect(data.footer).toContain("Automated checks only (axe-core, Lighthouse)");
    expect(data.keyTakeaway).toMatch(/ on this page\. Fix first: /);
    expect(data.levelPassing).toBeUndefined();
    // Criteria the scanners checked and found clean still need a person to verify them.
    expect(data.criteriaResults["2.4.2"]).toEqual({ result: "not-verified", note: "Scanners found no issues; needs a manual check" });
    expect(data.criteriaResults["2.4.7"]).toEqual({ result: "not-verified" });
    expect(Object.values(data.criteriaResults).some((r) => (r as { result: string }).result === "fail")).toBe(true);
  });

  it("asks for the URL and level when they aren't given", async () => {
    const asked: string[] = [];
    const d = deps({
      prompter: {
        ...noPrompts,
        input: async (m, o) => {
          asked.push(m);
          expect(o?.validate?.("example.com")).toMatch(/http/);
          return " https://example.com ";
        },
        select: async (m) => {
          asked.push(m);
          return "A" as never;
        },
      },
    });
    const result = await runQuickScan(d);
    expect(asked).toEqual(["Page URL to scan:", "Target WCAG level?"]);
    expect(d.scanned[0]).toEqual(["https://example.com"]);
    expect(result!.pdf).toBeUndefined();
    expect(JSON.parse(readFileSync(result!.json, "utf8")).targetLevel).toBe("A");
  });

  it("says nothing was found without claiming conformance", async () => {
    const d = deps({ scanAxe: async () => EMPTY });
    const result = await runQuickScan(d, { url: "https://example.com", level: "AA" });
    const data = JSON.parse(readFileSync(result!.json, "utf8"));
    expect(data.keyTakeaway).toMatch(/found no issues on this page.*still needed/);
    expect(data.conformance.conformant).toBe(false);
  });

  it("reports why a page couldn't be loaded, and writes nothing when every scanner fails", async () => {
    const unreachable = async (urls: string[], _level: unknown, onProgress: (e: { type: "skip"; url: string; error: string }) => void): Promise<Assessment> => {
      onProgress({ type: "skip", url: urls[0]!, error: "net::ERR_NAME_NOT_RESOLVED" });
      throw new Error("No pages could be scanned.");
    };
    const d = deps({ scanAxe: unreachable, scanLighthouse: unreachable });
    expect(await runQuickScan(d, { url: "https://nope.invalid", level: "AA" })).toBeUndefined();
    expect(d.output.join("\n")).toContain("✗ axe-core failed: net::ERR_NAME_NOT_RESOLVED");
    expect(existsSync(join(cwd, QUICK_SCAN_DIR))).toBe(false);
  });

  it("keeps going with the scanners that are installed", async () => {
    const d = deps({
      hasModule: async (name) => name !== "playwright",
      prompter: { ...noPrompts, confirm: async () => false },
    });
    const result = await runQuickScan(d, { url: "https://example.com", level: "AA" });
    expect(d.scanned).toHaveLength(1);
    expect(JSON.parse(readFileSync(result!.json, "utf8")).footer).toContain("(Lighthouse)");
  });
});
