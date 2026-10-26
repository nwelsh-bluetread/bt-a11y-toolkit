/**
 * Shared components with issues: files rendered by several screens (a
 * Checkbox, StyledText, a modal) that the code scan found problems in. The
 * scan flags them on every screen that uses them, so they're listed once:
 * testers log each problem once, and the report shows one fix per component.
 */
import type { ScreenInfo } from "../code-scan/screens.js";
import type { Finding, Severity } from "../types.js";
import { componentName } from "./quick-wins.js";

export interface SharedIssue {
  ruleId: string;
  title: string;
  severity: Severity;
  wcag: string[];
  lines: number[];
  remediation?: string;
}

export interface SharedComponent {
  name: string;
  file: string;
  /** Screens that render it, in screen order. */
  screens: string[];
  issues: SharedIssue[];
  worst: Severity;
}

const RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_WORD: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

/** Components rendered by at least `minScreens` screens that have scan findings, most widely used first. */
export function sharedComponents(screens: ScreenInfo[], findings: Finding[], minScreens = 2): SharedComponent[] {
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    const file = typeof f.evidence?.file === "string" ? f.evidence.file : undefined;
    if (file) byFile.set(file, [...(byFile.get(file) ?? []), f]);
  }
  const list: SharedComponent[] = [];
  for (const [file, group] of byFile) {
    const on = screens.filter((s) => s.kind === "mobile" && s.files?.includes(file)).map((s) => s.name);
    if (on.length < minScreens) continue;
    const issues = new Map<string, SharedIssue>();
    for (const f of group) {
      const title = f.title.replace(/ \(\d+×\)/, "").split(" — ")[0]!;
      const issue = issues.get(title) ?? { ruleId: f.ruleId, title, severity: f.severity, wcag: [], lines: [], remediation: f.remediation };
      if (RANK[f.severity] < RANK[issue.severity]) issue.severity = f.severity;
      for (const c of f.wcag) if (!issue.wcag.includes(c.id)) issue.wcag.push(c.id);
      for (const l of Array.isArray(f.evidence?.lines) ? (f.evidence.lines as number[]) : []) if (!issue.lines.includes(l)) issue.lines.push(l);
      issues.set(title, issue);
    }
    const sorted = [...issues.values()].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
    list.push({ name: componentName(file), file, screens: on, issues: sorted, worst: sorted[0]!.severity });
  }
  return list.sort((a, b) => b.screens.length - a.screens.length || RANK[a.worst] - RANK[b.worst] || a.name.localeCompare(b.name));
}

/** "High · Touchable has no accessible name (line 183)" */
export function issueText(i: SharedIssue): string {
  const lines = i.lines.length ? ` (line${i.lines.length > 1 ? "s" : ""} ${i.lines.slice(0, 4).join(", ")}${i.lines.length > 4 ? ", …" : ""})` : "";
  return `${SEVERITY_WORD[i.severity]} · ${i.title}${lines}`;
}

const cell = (s: string) => s.replace(/\|/g, "\\|");

/** The table at the top of checklist.md, so testers log each shared problem once. */
export function sharedComponentsChecklistLines(list: SharedComponent[]): string[] {
  if (!list.length) return [];
  return [
    "",
    `## Shared components with issues (${list.length})`,
    "",
    "These are used on several screens, so the scan flags them (⚑) on every one. Log a problem with one of them once, under the screen where you found it, naming the component (e.g. *close button has no name (StyledModal)*). Only fail another screen for it if you actually see or hear it there.",
    "",
    "| Component | Used on | Scan found | WCAG |",
    "| --- | --- | --- | --- |",
    ...list.map(
      (c) =>
        `| \`${cell(c.name)}\` (${cell(c.file)}) | ${c.screens.length} screens | ${cell(c.issues.map(issueText).join("<br>"))} | ${[...new Set(c.issues.flatMap((i) => i.wcag))].join(", ")} |`,
    ),
  ];
}

/** report.md section. `cleared` gives the failing checks each component alone clears, when known. */
export function formatSharedComponentsMarkdown(list: SharedComponent[], cleared: Map<string, number> = new Map()): string {
  if (!list.length) return "";
  return [
    `## Shared component issues (${list.length})`,
    "",
    "Components rendered on two or more screens that the code scan found problems in. Fixing one fixes it on every screen that uses it. **Clears on its own** counts failing checks that only this component causes; 0 usually means other components fail the same checks too (see *Fix these first* for fixes that clear them together).",
    "",
    "| Component | Used on | Issues | WCAG | Clears on its own |",
    "| --- | ---: | --- | --- | ---: |",
    ...list.map(
      (c) =>
        `| **${cell(c.name)}**<br>\`${cell(c.file)}\` | ${c.screens.length} screens | ${cell(c.issues.map(issueText).join("<br>"))} | ${[...new Set(c.issues.flatMap((i) => i.wcag))].join(", ")} | ${cleared.get(c.file) ?? "—"} |`,
    ),
  ].join("\n");
}
