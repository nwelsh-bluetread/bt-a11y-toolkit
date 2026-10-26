/**
 * "Fix these first": which components, families of components (all the
 * modals, all the dropdowns), or issue types clear the most failures for the
 * least code change.
 *
 * Each candidate is simulated: drop its scan findings, then recount
 *   checks cleared     checklist lines (screen × platform × check) failing only because of it
 *   criteria fixed     WCAG criteria that would no longer fail on any platform
 *   score gain         change in the overall score
 * Effort is the number of code locations to change. A checklist line a tester
 * failed with their own notes stays failed: that problem isn't in the scan.
 */
import { MANUAL_CHECKLIST, type AuditTarget } from "../checklist.js";
import type { Finding } from "../types.js";
import { findingOnSection, type ParsedChecklist } from "./checklist-md.js";
import { buildCoverage, criterionResult } from "./coverage.js";
import { buildSessionAssessment, type AuditSession } from "./session.js";

export interface QuickWin {
  kind: "component" | "family" | "issue";
  /** "StyledModal", "Modals", or "Font scaling disabled". */
  name: string;
  /** Components in a family, or files an issue type appears in. */
  members: string[];
  files: string[];
  /** Distinct issue titles involved. */
  issues: string[];
  /** Code locations to change: the effort. */
  locations: number;
  findings: number;
  /** Screens that render the affected files. */
  screens: number;
  checksCleared: number;
  criteriaFixed: string[];
  scoreGain: number;
  /** Few code locations for the payoff. */
  quickWin: boolean;
}

export interface QuickWins {
  components: QuickWin[];
  families: QuickWin[];
  issues: QuickWin[];
}

const QUICK_MAX_LOCATIONS = 5;
const fileOf = (f: Finding) => (typeof f.evidence?.file === "string" ? f.evidence.file : undefined);
const linesOf = (f: Finding) => (Array.isArray(f.evidence?.lines) ? (f.evidence.lines as number[]).length : 1) || 1;
const issueTitle = (f: Finding) => f.title.replace(/ \(\d+×\)/, "").split(" — ")[0]!;

/** "src/components/StyledModal.tsx" → "StyledModal"; ".../Dropdown/index.js" → "Dropdown". */
export function componentName(file: string): string {
  const parts = file.split("/");
  const base = parts.at(-1)!.replace(/\.[jt]sx?$/, "");
  return base === "index" && parts.length > 1 ? parts.at(-2)! : base;
}

/** Families by the component's last word: StyledModal, ComingSoonModal → "Modals". */
const FAMILY_WORDS: Array<[RegExp, string]> = [
  [/(Dropdown|Picker|Select)$/, "Dropdowns & pickers"],
  [/Modal$/, "Modals"],
  [/(Button|Btn)$/, "Buttons"],
  [/(Input|TextField|Field)$/, "Inputs"],
  [/(Stepper|Counter)$/, "Steppers"],
  [/(Checkbox|Radio|Toggle|Switch)$/, "Toggles & checkboxes"],
  [/Card$/, "Cards"],
  [/(Header|NavBar|Toolbar)$/, "Headers"],
  [/(Tab|Tabs|TabBar)$/, "Tabs"],
  [/(List|ListItem|Row)$/, "Lists"],
  [/(Carousel|Slider)$/, "Carousels"],
];

/**
 * Rules usually fixed together, which fail the same checks: neither half alone
 * clears anything, so they're also offered as one fix.
 */
const ISSUE_BUNDLES: Array<{ name: string; rules: string[] }> = [
  { name: "Font scaling turned off or capped (allowFontScaling / maxFontSizeMultiplier)", rules: ["rn-font-scaling", "rn-font-scaling-cap"] },
  { name: "Touchables missing an accessible name or role", rules: ["rn-control-name", "rn-control-role"] },
];

export function familyOf(component: string): string | undefined {
  return FAMILY_WORDS.find(([re]) => re.test(component))?.[1];
}

/** For every checklist line failing because of the scan alone (no tester notes), the file-based findings behind it. */
function scanOnlyFailures(session: AuditSession, checklist: ParsedChecklist, fixable: Finding[]): Array<Set<Finding>> {
  const screens = session.screens;
  const items = new Map(MANUAL_CHECKLIST.map((i) => [i.id, i]));
  const rowCauses: Array<Set<Finding>> = [];
  for (const row of checklist.rows) {
    if (row.status !== "fail" || row.issues.length > 0) continue;
    const item = items.get(row.itemId);
    if (!item) continue;
    const screen = row.screen ? screens.find((s) => s.name === row.screen) : undefined;
    if (row.screen && !screen) continue;
    const section = { heading: row.screen ?? "", screen, checks: [] };
    const causes = fixable.filter(
      (f) =>
        f.wcag.some((c) => item.wcag.includes(c.id)) &&
        (!f.platforms?.length || f.platforms.includes(row.target as AuditTarget)) &&
        findingOnSection(f, section, screens),
    );
    if (causes.length) rowCauses.push(new Set(causes));
  }
  return rowCauses;
}

/** Failing checklist lines each file alone is responsible for. */
export function checksClearedByFile(session: AuditSession, checklist: ParsedChecklist, files: string[]): Map<string, number> {
  const fixable = session.automated.flatMap((r) => r.findings).filter((f) => fileOf(f));
  const rows = scanOnlyFailures(session, checklist, fixable);
  return new Map(files.map((file) => [file, rows.filter((causes) => [...causes].every((f) => fileOf(f) === file)).length]));
}

export function buildQuickWins(session: AuditSession, checklist: ParsedChecklist, limit = 8): QuickWins {
  // Code-scan findings tied to a file are the ones a component change can fix.
  const fixable = session.automated.flatMap((r) => r.findings).filter((f) => fileOf(f));
  if (fixable.length === 0) return { components: [], families: [], issues: [] };

  const screens = session.screens;
  const rowCauses = scanOnlyFailures(session, checklist, fixable);

  const baseScore = buildSessionAssessment(session, checklist).overallScore;
  const failing = (s: AuditSession) =>
    new Set(buildCoverage(s, checklist).rows.filter((r) => criterionResult(r).result === "fail").map((r) => r.id));
  const failingNow = failing(session);

  const simulate = (kind: QuickWin["kind"], name: string, group: Finding[], members: string[]): QuickWin => {
    const removed = new Set(group);
    const without: AuditSession = { ...session, automated: session.automated.map((r) => ({ ...r, findings: r.findings.filter((f) => !removed.has(f)) })) };
    const stillFailing = failing(without);
    const files = [...new Set(group.map((f) => fileOf(f)!))];
    const locations = group.reduce((n, f) => n + linesOf(f), 0);
    const checksCleared = rowCauses.filter((causes) => [...causes].every((f) => removed.has(f))).length;
    const criteriaFixed = [...failingNow].filter((id) => !stillFailing.has(id)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return {
      kind,
      name,
      members,
      files,
      issues: [...new Set(group.map(issueTitle))],
      locations,
      findings: group.length,
      // A file no screen imports (App.tsx, navigation) affects the whole app.
      screens: files.some((f) => !screens.some((s) => s.files?.includes(f))) ? screens.length : screens.filter((s) => s.files?.some((f) => files.includes(f))).length,
      checksCleared,
      criteriaFixed,
      scoreGain: buildSessionAssessment(without, checklist).overallScore - baseScore,
      quickWin: locations <= QUICK_MAX_LOCATIONS && (checksCleared > 0 || criteriaFixed.length > 0),
    };
  };

  const byFile = new Map<string, Finding[]>();
  for (const f of fixable) byFile.set(fileOf(f)!, [...(byFile.get(fileOf(f)!) ?? []), f]);
  const components = [...byFile].map(([file, group]) => simulate("component", componentName(file), group, [file]));

  const byFamily = new Map<string, { group: Finding[]; members: Set<string> }>();
  for (const [file, group] of byFile) {
    const family = familyOf(componentName(file));
    if (!family) continue;
    const entry = byFamily.get(family) ?? { group: [], members: new Set() };
    entry.group.push(...group);
    entry.members.add(componentName(file));
    byFamily.set(family, entry);
  }
  const families = [...byFamily]
    .filter(([, e]) => e.members.size > 1)
    .map(([family, e]) => simulate("family", family, e.group, [...e.members]));

  const byIssue = new Map<string, Finding[]>();
  for (const f of fixable) byIssue.set(issueTitle(f), [...(byIssue.get(issueTitle(f)) ?? []), f]);
  const members = (group: Finding[]) => [...new Set(group.map((f) => componentName(fileOf(f)!)))];
  const issues = [...byIssue].map(([title, group]) => simulate("issue", title, group, members(group)));
  for (const bundle of ISSUE_BUNDLES) {
    const group = fixable.filter((f) => bundle.rules.includes(f.ruleId));
    if (new Set(group.map((f) => f.ruleId)).size > 1) issues.push(simulate("issue", bundle.name, group, members(group)));
  }

  return { components: rank(components, limit), families: rank(families, limit), issues: rank(issues, limit) };
}

/** Biggest payoff first (a fixed criterion weighs like five cleared checks), then least code. */
function rank(list: QuickWin[], limit: number): QuickWin[] {
  const impact = (w: QuickWin) => w.checksCleared + 5 * w.criteriaFixed.length;
  return list
    .filter((w) => impact(w) > 0 || w.scoreGain > 0)
    .sort((a, b) => impact(b) - impact(a) || b.scoreGain - a.scoreGain || a.locations - b.locations)
    .slice(0, limit);
}

/** "clears 82 failing checks · 2 criteria stop failing (1.4.4, 4.1.2) · +3 score" */
export function impactText(w: QuickWin): string {
  return [
    w.checksCleared && `clears ${w.checksCleared} failing check${w.checksCleared === 1 ? "" : "s"}`,
    w.criteriaFixed.length && `${w.criteriaFixed.length} WCAG criteri${w.criteriaFixed.length === 1 ? "on stops" : "a stop"} failing (${w.criteriaFixed.join(", ")})`,
    w.scoreGain > 0 && `+${w.scoreGain} score`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatQuickWinsMarkdown(wins: QuickWins): string {
  if (!wins.components.length && !wins.issues.length) return "";
  const cell = (s: string) => s.replace(/\|/g, "\\|");
  const effort = (w: QuickWin) => `${w.locations} place${w.locations === 1 ? "" : "s"}${w.files.length > 1 ? ` in ${w.files.length} files` : ""}`;
  const table = (title: string, intro: string, list: QuickWin[], what: (w: QuickWin) => string) => {
    if (!list.length) return [];
    // Leave out columns with nothing to show (e.g. no criterion stops failing while testers' own failures remain).
    const cols: Array<[string, string, (w: QuickWin) => string]> = [
      ["#", "---:", () => ""],
      ["Fix", "---", (w) => `${what(w)}${w.quickWin ? " ⚡ quick win" : ""}`],
      ["Code changes", "---", effort],
      ["Screens", "---:", (w) => String(w.screens)],
      ["Failing checks cleared", "---:", (w) => String(w.checksCleared)],
      ...(list.some((w) => w.criteriaFixed.length) ? [["WCAG criteria that stop failing", "---", (w: QuickWin) => w.criteriaFixed.join(", ") || "—"] as [string, string, (w: QuickWin) => string]] : []),
      ...(list.some((w) => w.scoreGain > 0) ? [["Score", "---:", (w: QuickWin) => (w.scoreGain > 0 ? `+${w.scoreGain}` : "—")] as [string, string, (w: QuickWin) => string]] : []),
    ];
    return [
      `### ${title}`,
      "",
      intro,
      "",
      `| ${cols.map((c) => c[0]).join(" | ")} |`,
      `| ${cols.map((c) => c[1]).join(" | ")} |`,
      ...list.map((w, i) => `| ${cols.map((c, k) => (k === 0 ? String(i + 1) : c[2](w))).join(" | ")} |`),
      "",
    ];
  };
  return [
    "## Fix these first",
    "",
    "What each fix is worth, worked out by removing its scan findings and recounting. **Failing checks cleared** counts checklist lines (screen × platform × check) that fail only because of it; they still need a quick re-test after the fix. A criterion **stops failing** once nothing else fails it on any platform. ⚡ marks fixes of 5 code changes or fewer.",
    "",
    ...table("Components", "Shared components fix every screen that uses them.", wins.components, (w) => `**${cell(w.name)}** \`${cell(w.files[0]!)}\`: ${cell(w.issues.join("; "))}`),
    ...table("Component families", "The same kind of component, fixed together.", wins.families, (w) => `**All ${cell(w.name.toLowerCase())}** (${cell(w.members.join(", "))}): ${cell(w.issues.join("; "))}`),
    ...table("Issue types", "One pattern fixed everywhere it appears.", wins.issues, (w) => `**${cell(w.name)}** in ${cell(w.members.slice(0, 4).join(", "))}${w.members.length > 4 ? ` +${w.members.length - 4} more` : ""}`),
  ]
    .join("\n")
    .trimEnd();
}

/** The best fixes across components, families, and issue types, for the terminal and the PDF. */
export function topQuickWins(wins: QuickWins, n = 5): QuickWin[] {
  const impact = (w: QuickWin) => w.checksCleared + 5 * w.criteriaFixed.length;
  const within = (a: QuickWin, b: QuickWin) => a.issues.every((i) => b.issues.includes(i)) && a.files.every((f) => b.files.includes(f));
  const picked: QuickWin[] = [];
  for (const w of [...wins.components, ...wins.families, ...wins.issues].sort((a, b) => impact(b) - impact(a) || a.locations - b.locations)) {
    // Skip fixes already covered by a bigger one above (e.g. "no role" inside "no name or role").
    if (picked.some((p) => within(w, p))) continue;
    picked.push(w);
    if (picked.length === n) break;
  }
  return picked;
}

/** "All modals (StyledModal, ComingSoonModal)", "StyledModal", or the issue type. */
export function quickWinTitle(w: QuickWin): string {
  if (w.kind === "family") return `All ${w.name.toLowerCase()} (${w.members.slice(0, 4).join(", ")}${w.members.length > 4 ? ", …" : ""})`;
  if (w.kind === "component") return `${w.name} component`;
  return w.name;
}

export function effortText(w: QuickWin): string {
  return `${w.locations} code change${w.locations === 1 ? "" : "s"}${w.files.length > 1 ? ` in ${w.files.length} files` : ""}`;
}
