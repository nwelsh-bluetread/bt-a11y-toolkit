/**
 * Saved state for a guided audit (`bt-a11y start`), plus report generation.
 *
 * `a11y-audit/session.json` holds the setup answers, the screen list, and the
 * automated scan results. Manual results live in `a11y-audit/checklist.md`,
 * which testers edit by hand; `bt-a11y report` reads both and writes the report.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findingsToAssessment } from "../audit.js";
import { MANUAL_CHECKLIST, type AuditTarget } from "../checklist.js";
import type { CodeSignal } from "../code-scan/react-native.js";
import type { ScreenInfo } from "../code-scan/screens.js";
import { formatJson, formatMarkdown } from "../report.js";
import type { Assessment, Finding, WcagLevel } from "../types.js";
import { WCAG } from "../wcag.js";
import { emptyChecklist, parseChecklist, type ParsedChecklist } from "./checklist-md.js";
import { buildCoverage, formatCoverageMarkdown, type Coverage } from "./coverage.js";

export type ProjectType = "web" | "mobile" | "both";
export type MobileStack = "react-native" | "native" | "flutter" | "unknown";

/** One automated run (code scan, axe, Lighthouse). */
export interface AutomatedRun {
  tool: string;
  /** Platforms the run covers (a React Native code scan covers iOS + Android). */
  targets: AuditTarget[];
  ranAt: string;
  pages?: number;
  filesScanned?: number;
  /** Per-level pass rates reported by the tool, when it has them. */
  wcag?: Record<WcagLevel, number>;
  /** WCAG criteria the tool has checks for — feeds the coverage matrix. */
  checked?: string[];
  /** Code locations a tester should verify by hand. */
  signals?: CodeSignal[];
  findings: Finding[];
}

export interface AuditSession {
  version: 2;
  createdAt: string;
  updatedAt: string;
  project: {
    name: string;
    type: ProjectType;
    targets: AuditTarget[];
    stack?: MobileStack;
    targetLevel: WcagLevel;
    /** Pages scanned (web). */
    urls?: string[];
  };
  screens: ScreenInfo[];
  automated: AutomatedRun[];
  /** Context docs (navigation map, sitemap, notes), copied into a11y-audit/context/. Paths are relative to the audit folder. */
  context?: { files: string[] };
}

export const SESSION_DIR = "a11y-audit";

export function sessionPath(cwd: string): string {
  return join(cwd, SESSION_DIR, "session.json");
}

export function checklistPath(cwd: string): string {
  return join(cwd, SESSION_DIR, "checklist.md");
}

export function newSession(project: AuditSession["project"], screens: ScreenInfo[] = []): AuditSession {
  const now = new Date().toISOString();
  return { version: 2, createdAt: now, updatedAt: now, project, screens, automated: [] };
}

/** Load the saved session. Sessions from older versions aren't compatible and are ignored. */
export function loadSession(cwd: string): AuditSession | undefined {
  const path = sessionPath(cwd);
  if (!existsSync(path)) return undefined;
  const session = JSON.parse(readFileSync(path, "utf8")) as AuditSession;
  return session.version === 2 ? session : undefined;
}

export function saveSession(cwd: string, session: AuditSession): void {
  mkdirSync(join(cwd, SESSION_DIR), { recursive: true });
  session.updatedAt = new Date().toISOString();
  writeFileSync(sessionPath(cwd), JSON.stringify(session, null, 2) + "\n", "utf8");
}

/** Record a run, replacing any earlier run of the same tool. */
export function upsertRun(session: AuditSession, run: AutomatedRun): void {
  session.automated = session.automated.filter((r) => r.tool !== run.tool);
  session.automated.push(run);
}

export function loadChecklist(cwd: string): ParsedChecklist {
  const path = checklistPath(cwd);
  return existsSync(path) ? parseChecklist(readFileSync(path, "utf8")) : emptyChecklist();
}

const ITEMS = new Map(MANUAL_CHECKLIST.map((i) => [i.id, i]));

/** Turn failed checklist rows and "Other findings" lines into findings. */
export function checklistFindings(parsed: ParsedChecklist): Finding[] {
  const findings: Finding[] = [];
  for (const row of parsed.rows) {
    if (row.status !== "fail") continue;
    const item = ITEMS.get(row.itemId);
    if (!item) continue;
    const where = row.screen ?? "App-wide";
    const issues = row.issues.length ? row.issues : [{ text: "" }];
    for (const issue of issues) {
      const ids = issue.wcag?.length ? issue.wcag : item.wcag;
      findings.push({
        ruleId: `manual:${item.id}`,
        title: issue.text ? truncate(issue.text, 90) : `${item.title} — ${where}`,
        description: issue.text || `Marked as failing in the manual checklist: ${item.title}.`,
        severity: issue.severity ?? item.severity,
        wcag: ids.map((id) => WCAG[id]!),
        nodeId: where,
        platforms: [row.target],
        category: item.category,
        source: "manual",
        evidence: { [row.target === "web" ? "page" : "screen"]: where },
      });
    }
  }
  for (const other of parsed.other) {
    findings.push({
      ruleId: "manual:other",
      title: truncate(other.text, 90),
      description: other.text,
      severity: other.severity ?? "medium",
      wcag: (other.wcag ?? []).map((id) => WCAG[id]!),
      ...(other.screen ? { nodeId: other.screen, evidence: { screen: other.screen } } : {}),
      platforms: other.platforms,
      category: "Semantics",
      source: "manual",
    });
  }
  return findings;
}

/** Every finding: automated runs plus the manual checklist. */
export function allFindings(session: AuditSession, parsed: ParsedChecklist = emptyChecklist()): Finding[] {
  return [...session.automated.flatMap((r) => r.findings), ...checklistFindings(parsed)];
}

/**
 * Per-level WCAG pass rates. Answered checklist rows give a real pass/fail per
 * check; scanner runs contribute their own rates; sources are averaged.
 * Returns undefined when nothing has been tested yet.
 */
export function sessionWcagRollup(session: AuditSession, parsed: ParsedChecklist = emptyChecklist()): Record<WcagLevel, number> | undefined {
  const rank: Record<WcagLevel, number> = { A: 1, AA: 2, AAA: 3 };
  const rollup = {} as Record<WcagLevel, number>;
  let any = false;
  for (const level of ["A", "AA", "AAA"] as WcagLevel[]) {
    const sources: number[] = [];
    const rows = parsed.rows.filter((r) => {
      const item = ITEMS.get(r.itemId);
      return item && (r.status === "pass" || r.status === "fail") && rank[item.level] <= rank[level];
    });
    if (rows.length > 0) sources.push((rows.filter((r) => r.status === "pass").length / rows.length) * 100);
    for (const run of session.automated) if (run.wcag) sources.push(run.wcag[level]);
    if (sources.length > 0) any = true;
    rollup[level] = sources.length === 0 ? 100 : Math.round(sources.reduce((a, b) => a + b, 0) / sources.length);
  }
  return any ? rollup : undefined;
}

export function buildSessionAssessment(session: AuditSession, parsed: ParsedChecklist = emptyChecklist()): Assessment {
  return findingsToAssessment(allFindings(session, parsed), {
    platforms: session.project.targets,
    targetLevel: session.project.targetLevel,
    wcag: sessionWcagRollup(session, parsed),
  });
}

/** Read checklist.md, then write report.md and report.json next to the session. */
export function writeReports(
  cwd: string,
  session: AuditSession,
): { assessment: Assessment; coverage: Coverage; checklist: ParsedChecklist; markdown: string; json: string } {
  const checklist = loadChecklist(cwd);
  const assessment = buildSessionAssessment(session, checklist);
  const coverage = buildCoverage(session, checklist);
  const dir = join(cwd, SESSION_DIR);
  mkdirSync(dir, { recursive: true });
  const markdown = join(dir, "report.md");
  const json = join(dir, "report.json");
  writeFileSync(
    markdown,
    formatMarkdown(assessment).replace("# Accessibility Assessment", `# Accessibility Assessment — ${session.project.name}`) +
      "\n\n" +
      formatCoverageMarkdown(coverage) +
      "\n",
    "utf8",
  );
  writeFileSync(json, formatJson({ ...assessment, coverage } as Assessment) + "\n", "utf8");
  return { assessment, coverage, checklist, markdown, json };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
