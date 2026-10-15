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
  /** Per-level pass rates reported by the tool, when it has them (informational; the report uses the coverage matrix). */
  wcag?: Partial<Record<WcagLevel, number>>;
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
    // A [!] the scan pre-filled, with nothing added: the scan's own finding already covers it.
    if (row.flagged && row.issues.length === 0) continue;
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
 * Per-level WCAG pass rates, from the criteria coverage matrix so every number
 * in the report agrees: of the criteria at or below each level that have been
 * verified, the share with no findings. A criterion fails if any finding (code
 * scan, web scan, checklist, Other findings) maps to it on any platform; it
 * passes only once every applicable platform is verified with no failures.
 * Unverified criteria ("scan clear", "not tested") are left out, and levels
 * above the audit's target aren't assessed.
 */
export function sessionWcagRollup(session: AuditSession, parsed: ParsedChecklist = emptyChecklist()): Partial<Record<WcagLevel, number>> {
  const rank: Record<WcagLevel, number> = { A: 1, AA: 2, AAA: 3 };
  const coverage = buildCoverage(session, parsed);
  const rollup: Partial<Record<WcagLevel, number>> = {};
  for (const level of ["A", "AA", "AAA"] as WcagLevel[]) {
    if (rank[level] > rank[session.project.targetLevel]) continue;
    let pass = 0;
    let fail = 0;
    for (const row of coverage.rows.filter((r) => rank[r.level] <= rank[level])) {
      const cells = Object.values(row.byTarget);
      if (cells.some((c) => c.status === "fail")) fail++;
      else if (cells.some((c) => c.status === "pass") && !cells.some((c) => c.status === "not-tested" || c.status === "scan-clear")) pass++;
    }
    if (pass + fail > 0) rollup[level] = Math.round((pass / (pass + fail)) * 100);
  }
  return rollup;
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
