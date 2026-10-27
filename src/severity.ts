/**
 * What each severity means and where automated severities come from. WCAG
 * itself has no severity scale: it only says pass or fail. Severity is the
 * toolkit's estimate of how much a problem gets in someone's way, and it sets
 * the order of the report, the score deductions, and the remediation phases.
 */
import type { Finding, Severity } from "./types.js";

export const SEVERITY_MEANING: Record<Severity, string> = {
  critical: "Blocks the task: someone can't finish it at all (e.g. font scaling turned off app-wide).",
  high: "A major barrier that's hard to work around (e.g. a button with no name, a field with no label).",
  medium: "A real problem with a workaround, or one that affects fewer people (e.g. a button that doesn't announce its role).",
  low: "Minor friction (e.g. heading-styled text not marked as a heading).",
};

/** Where each kind of finding gets its severity. */
export const SEVERITY_SOURCES: Array<{ key: string; source: string; how: string }> = [
  {
    key: "rn-code-scan",
    source: "Code scan",
    how: "Each rule has a fixed severity, set by the toolkit from how much that problem typically gets in the way. Every finding from a rule has the same severity, wherever it appears.",
  },
  { key: "axe", source: "axe (web)", how: "axe's own impact rating: critical → Critical, serious → High, moderate → Medium, minor → Low." },
  { key: "lighthouse", source: "Lighthouse (web)", how: "A fixed severity for each Lighthouse audit, set by the toolkit." },
  { key: "device", source: "On-device measurement", how: "Touch targets under 24×24 are Medium." },
  { key: "manual", source: "Manual testing", how: "The severity the tester chose. If they didn't pick one, the check's default severity (Medium for Other findings)." },
];

export const SEVERITY_NOTE =
  "WCAG has no severity scale; it only says pass or fail. A criterion fails if it has any finding, whatever the severity. Severity sets the order to fix things in and how much each finding lowers the score.";

/** The sources this audit's findings came from (manual testing is always listed). */
export function severitySourcesFor(findings: Finding[]): Array<{ source: string; how: string }> {
  const used = new Set(findings.map((f) => f.source ?? ""));
  return SEVERITY_SOURCES.filter((x) => x.key === "manual" || used.has(x.key)).map(({ source, how }) => ({ source, how }));
}

export function severityGuideMarkdown(findings: Finding[]): string[] {
  const label = (s: string) => s[0]!.toUpperCase() + s.slice(1);
  return [
    "### How severity is decided",
    "",
    SEVERITY_NOTE,
    "",
    "| Severity | Means |",
    "| --- | --- |",
    ...(Object.entries(SEVERITY_MEANING) as Array<[Severity, string]>).map(([s, m]) => `| ${label(s)} | ${m} |`),
    "",
    "| Finding from | How its severity is set |",
    "| --- | --- |",
    ...severitySourcesFor(findings).map((x) => `| ${x.source} | ${x.how} |`),
    "",
  ];
}
