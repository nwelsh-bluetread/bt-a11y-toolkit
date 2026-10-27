/**
 * Saved state for a guided audit (`bt-a11y start`), plus report generation.
 *
 * `a11y-audit/session.json` holds the setup answers, the screen list, and the
 * automated scan results. Manual results live in `a11y-audit/checklist.md`,
 * which testers edit by hand; `bt-a11y report` reads both and writes the report.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findingsToAssessment } from "../audit.js";
import { MANUAL_CHECKLIST, type AuditTarget } from "../checklist.js";
import type { CodeSignal } from "../code-scan/react-native.js";
import type { ScreenInfo } from "../code-scan/screens.js";
import { formatJson, formatMarkdown } from "../report.js";
import type { Assessment, Finding, WcagLevel } from "../types.js";
import { WCAG } from "../wcag.js";
import { emptyChecklist, parseChecklist, type ParsedChecklist } from "./checklist-md.js";
import { buildCoverage, conformance, formatConformanceMarkdown, formatCoverageMarkdown, type Coverage } from "./coverage.js";
import { buildQuickWins, checksClearedByFile, formatQuickWinsMarkdown, type QuickWins } from "./quick-wins.js";
import { formatSharedComponentsMarkdown, sharedComponents } from "./shared-components.js";
import { comparePlatforms, formatPlatformMarkdown } from "./platforms.js";

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
  /** Checks the tool fully verified on a screen (e.g. target size measured on a device), so their checklist line is filled in. */
  verified?: Array<{ screen: string; criteria: string[]; summary: string }>;
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
    /** Saved by `bt-a11y target-size`: the Android app to measure and its deep link scheme ("" = no deep links). */
    device?: { androidPackage?: string; scheme?: string };
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

/** The browser GUI for filling in checklist.md, copied next to it. */
export function checklistUiPath(cwd: string): string {
  return join(cwd, SESSION_DIR, "checklist.html");
}

/** Copy the checklist GUI into the audit folder (refreshed every run, so toolkit updates reach it). */
export function installChecklistUi(cwd: string): string {
  const dest = checklistUiPath(cwd);
  mkdirSync(dirname(dest), { recursive: true });
  // Works from src/ under tsx and from dist/.
  copyFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "checklist-ui", "checklist.html"), dest);
  return dest;
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

/** Pass the audit's screen names so headings testers edited still map to their screen. */
export function loadChecklist(cwd: string, screenNames: string[] = []): ParsedChecklist {
  const path = checklistPath(cwd);
  return existsSync(path) ? parseChecklist(readFileSync(path, "utf8"), screenNames) : emptyChecklist();
}

export interface BlockedScreen {
  screen: string;
  platforms: AuditTarget[];
  reasons: string[];
  /** Manual checks on this screen still open, across its blocked platforms. */
  open: number;
}

const PLATFORM_LABEL: Record<AuditTarget, string> = { ios: "iOS", android: "Android", web: "Web" };

/** Screens testers marked blocked, one entry per screen across platforms, in checklist order. */
export function blockedScreens(checklist: ParsedChecklist): BlockedScreen[] {
  const byScreen = new Map<string, BlockedScreen>();
  for (const mark of checklist.screenMarks) {
    if (!mark.blocked) continue;
    const screen = mark.screen ?? "App-wide";
    const entry = byScreen.get(screen) ?? { screen, platforms: [], reasons: [], open: 0 };
    if (!entry.platforms.includes(mark.target)) entry.platforms.push(mark.target);
    if (mark.blocked.reason && !entry.reasons.includes(mark.blocked.reason)) entry.reasons.push(mark.blocked.reason);
    entry.open += checklist.rows.filter((r) => r.target === mark.target && r.screen === mark.screen && r.status === "open").length;
    byScreen.set(screen, entry);
  }
  return [...byScreen.values()];
}

export function formatBlockedMarkdown(blocked: BlockedScreen[]): string {
  if (blocked.length === 0) return "";
  const cell = (s: string) => s.replace(/\|/g, "\\|");
  return [
    `## Blocked screens (${blocked.length})`,
    "",
    "Testers couldn't reach or test these screens, so their manual results are incomplete and any problems on them aren't in this report yet.",
    "",
    "| Screen | Platforms | Reason | Checks not done |",
    "| --- | --- | --- | ---: |",
    ...blocked.map((b) => `| ${cell(b.screen)} | ${b.platforms.map((p) => PLATFORM_LABEL[p]).join(", ")} | ${cell(b.reasons.join("; ")) || "—"} | ${b.open} |`),
  ].join("\n");
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
        // Check titles say what should be true; a failure needs the failure wording.
        title: issue.text ? truncate(issue.text, 90) : `${item.failTitle} — ${where}`,
        description: issue.text || `${item.failTitle}. Marked as failing in the manual checklist (check: ${item.title}).`,
        // A written issue with no severity is Low; a bare [!] with no description keeps the check's default.
        severity: issue.severity ?? (issue.text ? "low" : item.severity),
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
      severity: other.severity ?? "low",
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
): {
  assessment: Assessment;
  coverage: Coverage;
  checklist: ParsedChecklist;
  blocked: BlockedScreen[];
  quickWins: QuickWins;
  markdown: string;
  json: string;
} {
  const checklist = loadChecklist(cwd, session.screens.map((s) => s.name));
  const assessment = buildSessionAssessment(session, checklist);
  const coverage = buildCoverage(session, checklist);
  const blocked = blockedScreens(checklist);
  const quickWins = buildQuickWins(session, checklist);
  const quickWinsMd = formatQuickWinsMarkdown(quickWins);
  const shared = sharedComponents(session.screens, session.automated.flatMap((r) => r.findings));
  const sharedMd = formatSharedComponentsMarkdown(shared, checksClearedByFile(session, checklist, shared.map((c) => c.file)));
  // Compare the mobile platforms (a website, if also audited, is a different product).
  const mobile = session.project.targets.filter((t) => t !== "web");
  const platforms = comparePlatforms(assessment.findings, checklist, coverage, blocked, mobile, session.automated);
  const platformsMd = platforms ? formatPlatformMarkdown(platforms) : "";
  const dir = join(cwd, SESSION_DIR);
  mkdirSync(dir, { recursive: true });
  const markdown = join(dir, "report.md");
  const json = join(dir, "report.json");
  writeFileSync(
    markdown,
    insertBeforeFindings(
      formatMarkdown(assessment)
        .replace("# Accessibility Assessment", `# Accessibility Assessment — ${session.project.name}`)
        .replace(/^- \*\*Overall score:\*\* (\d+)%$/m, (line) => `${line} (issue load, not a pass mark)\n${conformanceLine(coverage)}`),
      // Overview sections go above the long findings list; the coverage matrix stays at the end.
      [formatConformanceMarkdown(coverage), platformsMd, quickWinsMd, sharedMd, blocked.length ? formatBlockedMarkdown(blocked) : ""].filter(Boolean).join("\n\n"),
    ) +
      "\n\n" +
      formatCoverageMarkdown(coverage) +
      "\n",
    "utf8",
  );
  writeFileSync(json, formatJson({ ...assessment, coverage, blockedScreens: blocked, quickWins, sharedComponents: shared, platforms } as Assessment) + "\n", "utf8");
  return { assessment, coverage, checklist, blocked, quickWins, markdown, json };
}

function conformanceLine(coverage: Coverage): string {
  const c = conformance(coverage);
  return `- **WCAG ${c.level} conformance:** ${c.conformant ? "Met" : "Not yet met"}: ${c.pass} of ${c.applicable} applicable criteria pass (all of them must pass)`;
}

function insertBeforeFindings(markdown: string, sections: string): string {
  if (!sections) return markdown;
  const at = markdown.indexOf("\n## Findings\n");
  return at < 0 ? `${markdown}\n\n${sections}` : `${markdown.slice(0, at)}\n${sections}\n${markdown.slice(at)}`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
