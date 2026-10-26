/**
 * iOS vs Android (or any two or more platforms in the audit): how each one is
 * doing, which problems show up on both, which on only one, and which WCAG
 * criteria fail on one platform but not the other.
 *
 * Problems are matched across platforms by what failed where: the check (or
 * rule) and the screen. Code-scan findings come from shared React Native code,
 * so they count for both platforms.
 */
import { MANUAL_CHECKLIST, type AuditTarget } from "../checklist.js";
import type { Finding, Severity } from "../types.js";
import type { ParsedChecklist } from "./checklist-md.js";
import type { Coverage, CoverageStatus } from "./coverage.js";
import type { AutomatedRun, BlockedScreen } from "./session.js";

export const PLATFORM_LABEL: Record<AuditTarget, string> = { ios: "iOS", android: "Android", web: "Web" };
const RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

export interface PlatformSummary {
  target: AuditTarget;
  findings: Record<Severity, number> & { total: number };
  /** Checklist lines testers answered (scan pre-fills not yet reviewed don't count). */
  checks: { answered: number; total: number; failed: number };
  criteria: Record<CoverageStatus, number>;
  blocked: number;
}

export interface PlatformIssue {
  title: string;
  severity: Severity;
  wcag: string[];
  screens: string[];
  on: AuditTarget[];
}

export interface PlatformComparison {
  targets: AuditTarget[];
  summaries: PlatformSummary[];
  /** Problems found on every platform vs on some. */
  shared: number;
  only: Partial<Record<AuditTarget, PlatformIssue[]>>;
  /** Criteria that fail on some platforms and not others. */
  criteria: Array<{ id: string; name: string; level: string; byTarget: Partial<Record<AuditTarget, CoverageStatus>> }>;
  /** Platforms a tool measured alone (e.g. target size on Android), so its findings aren't a real difference. */
  measuredOnly: Array<{ tool: string; targets: AuditTarget[] }>;
}

const screenOf = (f: Finding) =>
  typeof f.evidence?.screen === "string" ? f.evidence.screen : typeof f.evidence?.page === "string" && !f.evidence?.file ? f.evidence.page : (f.nodeId ?? "App-wide");
const CHECK_TITLE = new Map(MANUAL_CHECKLIST.map((i) => [`manual:${i.id}`, i.title]));
/** The check's name for checklist failures (the tester's own words vary by platform), otherwise the finding's issue. */
const titleOf = (f: Finding) => CHECK_TITLE.get(f.ruleId) ?? f.title.replace(/ \(\d+×\)/, "").split(" — ")[0]!;

const settledDiff = (r: { byTarget: Partial<Record<AuditTarget, CoverageStatus>> }) => Object.values(r.byTarget).some((s) => s === "pass" || s === "na");

export function comparePlatforms(
  findings: Finding[],
  checklist: ParsedChecklist,
  coverage: Coverage,
  blocked: BlockedScreen[],
  targets: AuditTarget[],
  runs: AutomatedRun[] = [],
): PlatformComparison | undefined {
  if (targets.length < 2) return undefined;

  const summaries = targets.map((target): PlatformSummary => {
    const mine = findings.filter((f) => !f.platforms?.length || f.platforms.includes(target));
    const counts = Object.fromEntries(SEVERITIES.map((s) => [s, mine.filter((f) => f.severity === s).length])) as Record<Severity, number>;
    const rows = checklist.rows.filter((r) => r.target === target);
    return {
      target,
      findings: { ...counts, total: mine.length },
      checks: {
        answered: rows.filter((r) => r.status !== "open" && r.reviewed !== false).length,
        total: rows.length,
        failed: rows.filter((r) => r.status === "fail" && r.reviewed !== false).length,
      },
      criteria: coverage.summary[target] ?? { fail: 0, pass: 0, na: 0, "scan-clear": 0, "not-tested": 0, "not-applicable": 0 },
      blocked: blocked.filter((b) => b.platforms.includes(target)).length,
    };
  });

  // Same check (or rule) failing on the same screen = the same problem.
  const problems = new Map<string, { title: string; severity: Severity; wcag: Set<string>; screen: string; on: Set<AuditTarget> }>();
  for (const f of findings) {
    const on = f.platforms?.length ? targets.filter((t) => f.platforms!.includes(t)) : targets;
    const screen = screenOf(f);
    const key = `${f.ruleId}|${f.ruleId === "manual:other" ? f.title : ""}|${screen}`;
    const p = problems.get(key) ?? { title: titleOf(f), severity: f.severity, wcag: new Set<string>(), screen, on: new Set<AuditTarget>() };
    if (RANK[f.severity] < RANK[p.severity]) p.severity = f.severity;
    f.wcag.forEach((c) => p.wcag.add(c.id));
    on.forEach((t) => p.on.add(t));
    problems.set(key, p);
  }
  const all = [...problems.values()];
  const shared = all.filter((p) => p.on.size === targets.length).length;

  const only: PlatformComparison["only"] = {};
  for (const target of targets) {
    // Group one platform's own problems by issue, listing the screens.
    const byTitle = new Map<string, PlatformIssue>();
    for (const p of all.filter((x) => x.on.size === 1 && x.on.has(target))) {
      const issue = byTitle.get(p.title) ?? { title: p.title, severity: p.severity, wcag: [], screens: [], on: [target] };
      if (RANK[p.severity] < RANK[issue.severity]) issue.severity = p.severity;
      p.wcag.forEach((c) => !issue.wcag.includes(c) && issue.wcag.push(c));
      if (!issue.screens.includes(p.screen)) issue.screens.push(p.screen);
      byTitle.set(p.title, issue);
    }
    only[target] = [...byTitle.values()].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.screens.length - a.screens.length);
  }

  const criteria = coverage.rows
    .filter((r) => {
      const cells = targets.map((t) => r.byTarget[t]?.status);
      return cells.includes("fail") && cells.some((c) => c !== "fail" && c !== "not-applicable");
    })
    .map((r) => ({ id: r.id, name: r.name, level: r.level, byTarget: Object.fromEntries(targets.map((t) => [t, r.byTarget[t]?.status])) as PlatformComparison["criteria"][number]["byTarget"] }))
    // Real differences (passes or N/A on one platform, fails on another) before ones still waiting on testing.
    .sort((a, b) => Number(settledDiff(b)) - Number(settledDiff(a)));

  const TOOL_NAME: Record<string, string> = { "device-target-size": "On-device touch target measurement" };
  const measuredOnly = runs
    .filter((r) => r.findings.length && r.targets.length < targets.length && r.targets.every((t) => targets.includes(t)))
    .map((r) => ({ tool: TOOL_NAME[r.tool] ?? r.tool, targets: r.targets }));
  return { targets, summaries, shared, only, criteria, measuredOnly };
}

const STATUS_WORD: Record<CoverageStatus, string> = {
  fail: "❌ Fail",
  pass: "✅ Pass",
  na: "➖ N/A",
  "scan-clear": "🔎 Scan clear",
  "not-tested": "⬜ Not tested yet",
  "not-applicable": "🌐 Web only",
};

/** "· iOS only", "· iOS + Android" — for finding headings when the audit covers several platforms. */
export function platformTag(f: Finding, targets: AuditTarget[]): string {
  if (targets.length < 2) return "";
  const on = f.platforms?.length ? targets.filter((t) => f.platforms!.includes(t)) : targets;
  if (on.length === 0) return "";
  return on.length === targets.length ? ` · ${on.map((t) => PLATFORM_LABEL[t]).join(" + ")}` : ` · ${on.map((t) => PLATFORM_LABEL[t]).join(" + ")} only`;
}

export function formatPlatformMarkdown(c: PlatformComparison, limit = 10): string {
  const names = c.targets.map((t) => PLATFORM_LABEL[t]);
  const title = names.join(" vs ");
  const cell = (s: string) => s.replace(/\|/g, "\\|");
  const row = (label: string, value: (s: PlatformSummary) => string | number) => `| ${label} | ${c.summaries.map((s) => value(s)).join(" | ")} |`;
  const lines = [
    `## ${title}`,
    "",
    "Each platform is tested separately: the screen reader, voice control, keyboard, and text-size settings all differ between them. Problems found by the code scan come from shared code, so they count for every platform.",
    "",
    `| | ${names.join(" | ")} |`,
    `| --- | ${names.map(() => "---:").join(" | ")} |`,
    row("Issues found", (s) => s.findings.total),
    row("Critical / high", (s) => `${s.findings.critical} / ${s.findings.high}`),
    row("Medium / low", (s) => `${s.findings.medium} / ${s.findings.low}`),
    row("Checklist checks done", (s) => `${s.checks.answered} of ${s.checks.total}`),
    row("Checks failed", (s) => s.checks.failed),
    row("WCAG criteria failing", (s) => s.criteria.fail),
    row("WCAG criteria passing", (s) => s.criteria.pass),
    row("Not tested yet", (s) => s.criteria["not-tested"] + s.criteria["scan-clear"]),
    ...(c.summaries.some((s) => s.blocked) ? [row("Blocked screens", (s) => s.blocked)] : []),
    "",
    `**${c.shared}** problem${c.shared === 1 ? " was" : "s were"} found on ${c.targets.length === 2 ? "both platforms" : "every platform"}; ${c.targets.map((t) => `**${c.only[t]?.reduce((n, i) => n + i.screens.length, 0) ?? 0}** only on ${PLATFORM_LABEL[t]}`).join(", ")}.`,
  ];
  for (const t of c.targets) {
    const list = c.only[t] ?? [];
    if (!list.length) continue;
    lines.push(
      "",
      `### Only on ${PLATFORM_LABEL[t]}`,
      "",
      "| Issue | Severity | WCAG | Screens |",
      "| --- | --- | --- | --- |",
      ...list.slice(0, limit).map((i) => `| ${cell(i.title)} | ${i.severity[0]!.toUpperCase()}${i.severity.slice(1)} | ${i.wcag.join(", ")} | ${cell(i.screens.slice(0, 6).join(", "))}${i.screens.length > 6 ? ` +${i.screens.length - 6} more` : ""} |`),
      ...(list.length > limit ? ["", `+ ${list.length - limit} more in the findings below (look for "${PLATFORM_LABEL[t]} only").`] : []),
    );
  }
  if (c.criteria.length) {
    lines.push(
      "",
      "### WCAG criteria that differ by platform",
      "",
      `| Criterion | Level | ${names.join(" | ")} |`,
      `| --- | --- | ${names.map(() => "---").join(" | ")} |`,
      ...c.criteria.map((r) => `| ${r.id} ${cell(r.name)} | ${r.level} | ${c.targets.map((t) => (r.byTarget[t] ? STATUS_WORD[r.byTarget[t]!] : "—")).join(" | ")} |`),
    );
  }
  if (c.measuredOnly.length) {
    lines.push("", ...c.measuredOnly.map((m) => `> ${m.tool} ran on ${m.targets.map((t) => PLATFORM_LABEL[t]).join(" and ")} only, so its findings aren't a difference between platforms.`));
  }
  return lines.join("\n");
}
