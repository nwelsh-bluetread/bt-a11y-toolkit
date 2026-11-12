/**
 * What the testers decided about each scan finding, read from checklist.md.
 *
 * A scan finding pre-fills the checklist lines it falls under (same screen or
 * page, a check covering one of its WCAG criteria). The report then follows the
 * tester's answer on those lines:
 *
 *   any line Fail (reviewed)       confirmed: the finding stays in the report
 *   every line Pass or N/A         dismissed: dropped from the report
 *   otherwise (not reviewed yet)   kept, except findings marked needsReview
 *                                  (screen reader runs): held back until a
 *                                  tester confirms them
 *
 * A finding no checklist line covers stays in the report: there's nothing to
 * review it against (counted in `unreviewable` when it needed review). The
 * checklist itself is always built from every finding.
 */
import type { AuditTarget } from "../checklist.js";
import type { Finding } from "../types.js";
import { findingOnSection, planChecklist, type ChecklistRow, type ParsedChecklist } from "./checklist-md.js";
import type { AuditSession } from "./session.js";

export interface ReviewedFindings {
  /** The session with only the scan findings that belong in the report. */
  session: AuditSession;
  /** Findings a tester dismissed (every line they pre-filled marked Pass or N/A). */
  dismissed: number;
  /** Findings that need review and haven't had it yet, by tool. */
  held: Record<string, number>;
  /** Findings that needed review but no checklist line covers them, so they're reported as found, by tool. */
  unreviewable: Record<string, number>;
}

type Decision = "keep" | "dismissed" | "held" | "unreviewable";

export function applyReviews(session: AuditSession, checklist: ParsedChecklist): ReviewedFindings {
  const groups = planChecklist(session.screens, session.project.targets, session.project.targetLevel);
  const rows = new Map(checklist.rows.map((r) => [`${r.target}|${r.itemId}|${r.screen ?? ""}`, r]));
  const out: ReviewedFindings = { session, dismissed: 0, held: {}, unreviewable: {} };

  const decide = (f: Finding, runTargets: AuditTarget[]): Decision => {
    const targets = runTargets.filter((t) => !f.platforms?.length || f.platforms.includes(t));
    const lines: ChecklistRow[] = [];
    for (const group of groups) {
      for (const target of group.targets.filter((t) => targets.includes(t))) {
        for (const section of group.sections) {
          if (!findingOnSection(f, section, session.screens)) continue;
          for (const { item } of section.checks) {
            if (!item.wcag.some((c) => f.wcag.some((w) => w.id === c))) continue;
            const row = rows.get(`${target}|${item.id}|${section.screen?.name ?? ""}`);
            if (row) lines.push(row);
          }
        }
      }
    }
    if (lines.length === 0) return f.evidence?.needsReview === true ? "unreviewable" : "keep";
    if (lines.some((r) => r.status === "fail" && r.reviewed !== false)) return "keep";
    if (lines.every((r) => r.status === "pass" || r.status === "na")) return "dismissed";
    return f.evidence?.needsReview === true ? "held" : "keep";
  };

  const automated = session.automated.map((run) => ({
    ...run,
    findings: run.findings.filter((f) => {
      const d = decide(f, run.targets);
      if (d === "dismissed") out.dismissed++;
      if (d === "held") out.held[run.tool] = (out.held[run.tool] ?? 0) + 1;
      if (d === "unreviewable") out.unreviewable[run.tool] = (out.unreviewable[run.tool] ?? 0) + 1;
      return d === "keep" || d === "unreviewable";
    }),
  }));
  out.session = { ...session, automated };
  return out;
}
