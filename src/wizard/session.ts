/**
 * Saved state for an interactive audit (`bt-a11y start`). Everything the wizard
 * collects — setup answers, scanner findings, checklist results, extra
 * findings — lives in `a11y-audit/session.json` in the audited repo, so an
 * audit can be paused and resumed and the report regenerated at any time.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findingsToAssessment } from "../audit.js";
import { checklistFor, MANUAL_CHECKLIST, type AuditTarget } from "../checklist.js";
import { formatJson, formatMarkdown } from "../report.js";
import type { Assessment, Finding, WcagLevel } from "../types.js";

export type ProjectType = "web" | "mobile" | "both";
export type MobileStack = "react-native" | "native" | "flutter" | "unknown";
export type ChecklistStatus = "pass" | "fail" | "na";

export interface ChecklistResult {
  status: ChecklistStatus;
  findings: Finding[];
  testedAt: string;
}

/** One automated or scanner-assisted run (axe, Lighthouse, Accessibility Inspector, …). */
export interface AutomatedRun {
  tool: string;
  target: AuditTarget;
  ranAt: string;
  pages?: number;
  /** Per-level pass rates reported by the tool, when it has them. */
  wcag?: Record<WcagLevel, number>;
  findings: Finding[];
}

export interface AuditSession {
  version: 1;
  createdAt: string;
  updatedAt: string;
  project: {
    name: string;
    type: ProjectType;
    targets: AuditTarget[];
    stack?: MobileStack;
    targetLevel: WcagLevel;
    /** Last set of URLs scanned, offered again on re-runs. */
    urls?: string[];
  };
  automated: AutomatedRun[];
  checklist: Partial<Record<AuditTarget, Record<string, ChecklistResult>>>;
  extraFindings: Finding[];
}

export const SESSION_DIR = "a11y-audit";

export function sessionPath(cwd: string): string {
  return join(cwd, SESSION_DIR, "session.json");
}

export function newSession(project: AuditSession["project"]): AuditSession {
  const now = new Date().toISOString();
  return { version: 1, createdAt: now, updatedAt: now, project, automated: [], checklist: {}, extraFindings: [] };
}

export function loadSession(cwd: string): AuditSession | undefined {
  const path = sessionPath(cwd);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as AuditSession;
}

export function saveSession(cwd: string, session: AuditSession): void {
  mkdirSync(join(cwd, SESSION_DIR), { recursive: true });
  session.updatedAt = new Date().toISOString();
  writeFileSync(sessionPath(cwd), JSON.stringify(session, null, 2) + "\n", "utf8");
}

/** Record a run, replacing any earlier run of the same tool on the same platform. */
export function upsertRun(session: AuditSession, run: AutomatedRun): void {
  session.automated = session.automated.filter((r) => !(r.tool === run.tool && r.target === run.target));
  session.automated.push(run);
}

/** Every finding collected so far, from all sources. */
export function allFindings(session: AuditSession): Finding[] {
  return [
    ...session.automated.flatMap((r) => r.findings),
    ...Object.values(session.checklist).flatMap((results) =>
      Object.values(results ?? {}).flatMap((r) => r.findings),
    ),
    ...session.extraFindings,
  ];
}

export function checklistProgress(
  session: AuditSession,
  target: AuditTarget,
): { done: number; total: number; failed: number } {
  const items = checklistFor(target, session.project.targetLevel);
  const results = session.checklist[target] ?? {};
  const answered = items.filter((i) => results[i.id]);
  return {
    done: answered.length,
    total: items.length,
    failed: answered.filter((i) => results[i.id]!.status === "fail").length,
  };
}

/**
 * Per-level WCAG pass rates. Manual checklist results give a real pass/fail per
 * check; scanner runs contribute their own rates. When both exist, the sources
 * are averaged. Returns undefined when nothing has been tested yet.
 */
export function sessionWcagRollup(session: AuditSession): Record<WcagLevel, number> | undefined {
  const rank: Record<WcagLevel, number> = { A: 1, AA: 2, AAA: 3 };
  const byId = new Map(MANUAL_CHECKLIST.map((i) => [i.id, i]));
  const rollup = {} as Record<WcagLevel, number>;
  let any = false;

  for (const level of ["A", "AA", "AAA"] as WcagLevel[]) {
    const sources: number[] = [];

    let evaluated = 0;
    let passed = 0;
    for (const results of Object.values(session.checklist)) {
      for (const [id, result] of Object.entries(results ?? {})) {
        const item = byId.get(id);
        if (!item || result.status === "na" || rank[item.level] > rank[level]) continue;
        evaluated++;
        if (result.status === "pass") passed++;
      }
    }
    if (evaluated > 0) sources.push((passed / evaluated) * 100);

    for (const run of session.automated) {
      if (run.wcag) sources.push(run.wcag[level]);
    }

    if (sources.length > 0) any = true;
    rollup[level] =
      sources.length === 0 ? 100 : Math.round(sources.reduce((a, b) => a + b, 0) / sources.length);
  }
  return any ? rollup : undefined;
}

export function buildSessionAssessment(session: AuditSession): Assessment {
  return findingsToAssessment(allFindings(session), {
    platforms: session.project.targets,
    targetLevel: session.project.targetLevel,
    wcag: sessionWcagRollup(session),
  });
}

/** Write report.md and report.json next to the session; returns their paths. */
export function writeReports(
  cwd: string,
  session: AuditSession,
): { assessment: Assessment; markdown: string; json: string } {
  const assessment = buildSessionAssessment(session);
  const dir = join(cwd, SESSION_DIR);
  mkdirSync(dir, { recursive: true });
  const markdown = join(dir, "report.md");
  const json = join(dir, "report.json");
  writeFileSync(
    markdown,
    formatMarkdown(assessment).replace(
      "# Accessibility Assessment",
      `# Accessibility Assessment — ${session.project.name}`,
    ) + "\n",
    "utf8",
  );
  writeFileSync(json, formatJson(assessment) + "\n", "utf8");
  return { assessment, markdown, json };
}
