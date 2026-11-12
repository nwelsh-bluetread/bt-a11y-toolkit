/**
 * Run the keyboard tests for a project and add what they found to its guided
 * audit (one automated run, replacing the previous keyboard run). Shared by
 * `bt-a11y kb` and the guided audit.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { alignPages, sameUrl } from "../screen-reader/load.js";
import { keyboardResultsDir, screenReaderPaths } from "../screen-reader/paths.js";
import { loadWorkflows } from "../screen-reader/workflow.js";
import type { Finding } from "../types.js";
import type { AuditSession } from "../wizard/session.js";
import { upsertRun } from "../wizard/session.js";
import { analyzeKeyboard, KEYBOARD_CRITERIA, SOURCE } from "./analyze.js";
import type { KbResult } from "./results.js";
import { runKeyboard, type KeyboardProgress } from "./runner.js";

export interface KeyboardTestOptions {
  cwd: string;
  pages: string[];
  /** Saved workflows to run too: all of them, these names, or none. */
  workflows: "all" | string[];
  signIn?: string;
  onProgress?: KeyboardProgress;
}

/** Run the pages and workflows; results are saved to the keyboard results folder. */
export async function keyboardTest(opts: KeyboardTestOptions): Promise<KbResult[]> {
  const dir = screenReaderPaths(opts.cwd).workflows;
  const saved = existsSync(dir) ? loadWorkflows(dir) : [];
  const workflows = opts.workflows === "all" ? saved : saved.filter((w) => opts.workflows.includes(w.name));
  return runKeyboard({ pages: opts.pages, workflows, signIn: opts.signIn, outDir: keyboardResultsDir(opts.cwd), onProgress: opts.onProgress });
}

/** Every saved result in the project's keyboard results folder. */
export function loadKeyboardResults(cwd: string): Array<{ result: KbResult; file: string }> {
  const dir = keyboardResultsDir(cwd);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => {
      try {
        const result = JSON.parse(readFileSync(join(dir, f), "utf8")) as KbResult;
        return result.version === 1 && Array.isArray(result.steps) ? [{ result, file: relative(cwd, join(dir, f)) }] : [];
      } catch {
        return [];
      }
    });
}

export interface KeyboardMerge {
  findings: Finding[];
  /** Pages the results cover. */
  pages: string[];
  /** Pages tested that aren't audit pages (their findings go under app-wide). */
  outside: string[];
}

/** Findings from every saved result, matched to the audit's page URLs. */
export function keyboardFindings(cwd: string, auditUrls: string[]): KeyboardMerge {
  const results = loadKeyboardResults(cwd);
  const findings = alignPages(analyzeKeyboard(results), auditUrls);
  const pages = [...new Set(results.flatMap(({ result }) => [result.url, ...result.steps.map((s) => s.url)]))];
  return { findings, pages, outside: pages.filter((p) => !auditUrls.some((u) => sameUrl(u, p))) };
}

/** Add the saved keyboard results to the audit. Undefined when there are none. */
export function addKeyboardRun(session: AuditSession, cwd: string): KeyboardMerge | undefined {
  if (loadKeyboardResults(cwd).length === 0) return undefined;
  const merged = keyboardFindings(cwd, session.project.urls ?? []);
  upsertRun(session, {
    tool: SOURCE,
    targets: ["web"],
    ranAt: new Date().toISOString(),
    pages: merged.pages.length,
    checked: KEYBOARD_CRITERIA,
    findings: merged.findings,
  });
  return merged;
}
