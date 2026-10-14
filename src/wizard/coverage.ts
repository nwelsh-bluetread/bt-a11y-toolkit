/**
 * WCAG 2.2 criteria coverage matrix: where each of the 86 success criteria
 * stands, per platform, combining code/web scans, the manual checklist, and
 * logged findings.
 *
 * Status precedence for a criterion on a platform:
 *   fail          a finding maps to it
 *   pass          every checklist row covering it (every screen) is answered, and none failed it
 *   na            the tester marked every covering row not applicable
 *   scan-clear    an automated scan checks it and found nothing — still verify manually
 *   not-tested    nothing has looked at it yet
 *   not-applicable  the criterion doesn't apply to this kind of platform (e.g. Bypass Blocks on mobile)
 */
import { MANUAL_CHECKLIST, type AuditTarget } from "../checklist.js";
import type { WcagLevel } from "../types.js";
import { WCAG, WCAG_PRINCIPLES } from "../wcag.js";
import type { ParsedChecklist } from "./checklist-md.js";
import { checklistFindings, type AuditSession } from "./session.js";

export type CoverageStatus = "fail" | "pass" | "na" | "scan-clear" | "not-tested" | "not-applicable";

export interface CoverageCell {
  status: CoverageStatus;
  findings: number;
  sources: string[];
}

export interface CoverageRow {
  id: string;
  name: string;
  level: WcagLevel;
  principle: string;
  byTarget: Partial<Record<AuditTarget, CoverageCell>>;
  /** Things a tester should look at for this criterion (from code signals). */
  notes: string[];
}

export interface Coverage {
  targetLevel: WcagLevel;
  targets: AuditTarget[];
  rows: CoverageRow[];
  /** Criteria above the target level, not assessed. */
  outOfScope: number;
  summary: Partial<Record<AuditTarget, Record<CoverageStatus, number>>>;
}

const RANK: Record<WcagLevel, number> = { A: 1, AA: 2, AAA: 3 };

/** Whether any part of the toolkit can check a criterion on this kind of platform. */
function appliesTo(id: string, target: AuditTarget): boolean {
  const kind = target === "web" ? "web" : "mobile";
  const items = MANUAL_CHECKLIST.filter((i) => i.wcag.includes(id));
  return items.length === 0 || items.some((i) => i.appliesTo.includes(kind));
}

export function buildCoverage(session: AuditSession, parsed: ParsedChecklist): Coverage {
  const { targetLevel, targets } = session.project;
  const ids = Object.keys(WCAG).filter((id) => RANK[WCAG[id]!.level] <= RANK[targetLevel]);
  const allFindings = [...session.automated.flatMap((r) => r.findings), ...checklistFindings(parsed)];

  const rows: CoverageRow[] = ids.map((id) => {
    const c = WCAG[id]!;
    const row: CoverageRow = {
      id,
      name: c.name,
      level: c.level,
      principle: WCAG_PRINCIPLES[id[0]!] ?? "",
      byTarget: {},
      notes: [],
    };

    for (const target of targets) {
      const failing = allFindings.filter(
        (f) => f.wcag.some((w) => w.id === id) && (!f.platforms?.length || f.platforms.includes(target)),
      );
      const sources = new Set(failing.map((f) => f.source ?? "manual"));

      let status: CoverageStatus;
      if (!appliesTo(id, target)) {
        status = "not-applicable";
      } else if (failing.length > 0) {
        status = "fail";
      } else {
        const itemIds = new Set(MANUAL_CHECKLIST.filter((i) => i.wcag.includes(id)).map((i) => i.id));
        const rows = parsed.rows.filter((r) => r.target === target && itemIds.has(r.itemId));
        const scanned = session.automated.some((r) => r.targets.includes(target) && r.checked?.includes(id));
        if (scanned) sources.add("scan");
        if (rows.length > 0 && rows.every((r) => r.status !== "open")) {
          sources.add("manual");
          status = rows.every((r) => r.status === "na") ? "na" : "pass";
        } else {
          status = scanned ? "scan-clear" : "not-tested";
        }
      }
      row.byTarget[target] = { status, findings: failing.length, sources: [...sources] };
    }

    for (const run of session.automated) {
      for (const s of run.signals ?? []) {
        if (!s.criteria.includes(id)) continue;
        const where = s.locations.length ? ` (${s.locations.length} place${s.locations.length === 1 ? "" : "s"}, e.g. ${s.locations[0]!.file}:${s.locations[0]!.line})` : "";
        const note = `${s.message}${where}`;
        if (!row.notes.includes(note)) row.notes.push(note);
      }
    }
    return row;
  });

  const summary: Coverage["summary"] = {};
  for (const target of targets) {
    const counts = { fail: 0, pass: 0, na: 0, "scan-clear": 0, "not-tested": 0, "not-applicable": 0 };
    for (const row of rows) counts[row.byTarget[target]!.status]++;
    summary[target] = counts;
  }

  return { targetLevel, targets, rows, outOfScope: Object.keys(WCAG).length - ids.length, summary };
}

const TARGET_LABEL: Record<AuditTarget, string> = { web: "Website", ios: "iOS", android: "Android" };

const STATUS_LABEL: Record<CoverageStatus, string> = {
  fail: "❌ Fail",
  pass: "✅ Pass",
  na: "➖ N/A",
  "scan-clear": "🔎 Scan clear — verify",
  "not-tested": "⬜ Not tested",
  "not-applicable": "— Doesn't apply",
};

/** One-line summary per platform, e.g. "iOS: 8 fail · 30 pass · 12 not tested". */
export function coverageSummaryLines(coverage: Coverage): string[] {
  return coverage.targets.map((t) => {
    const s = coverage.summary[t]!;
    const parts = [
      s.fail && `${s.fail} fail`,
      s.pass && `${s.pass} pass`,
      s.na && `${s.na} N/A`,
      s["scan-clear"] && `${s["scan-clear"]} scan clear (verify)`,
      s["not-tested"] && `${s["not-tested"]} not tested`,
      s["not-applicable"] && `${s["not-applicable"]} don't apply`,
    ].filter(Boolean);
    return `${TARGET_LABEL[t]}: ${parts.join(" · ")}`;
  });
}

export function formatCoverageMarkdown(coverage: Coverage): string {
  const { targets, rows, targetLevel, outOfScope } = coverage;
  const lines: string[] = [];
  lines.push("## WCAG 2.2 criteria coverage");
  lines.push("");
  lines.push(
    `Target level **${targetLevel}**: ${rows.length} of 86 success criteria in scope` +
      (outOfScope ? ` (${outOfScope} higher-level criteria not assessed).` : "."),
  );
  lines.push("");
  lines.push(`| Status | ${targets.map((t) => TARGET_LABEL[t]).join(" | ")} |`);
  lines.push(`| --- | ${targets.map(() => "---").join(" | ")} |`);
  for (const status of Object.keys(STATUS_LABEL) as CoverageStatus[]) {
    lines.push(`| ${STATUS_LABEL[status]} | ${targets.map((t) => coverage.summary[t]![status]).join(" | ")} |`);
  }
  lines.push("");
  lines.push(
    "> **Scan clear — verify** means an automated check covers this criterion and found nothing. Automated checks only see part of each criterion, so it still needs manual confirmation.",
  );

  for (const principle of Object.values(WCAG_PRINCIPLES)) {
    const group = rows.filter((r) => r.principle === principle);
    if (group.length === 0) continue;
    lines.push("");
    lines.push(`### ${principle}`);
    lines.push("");
    lines.push(`| Criterion | Level | ${targets.map((t) => TARGET_LABEL[t]).join(" | ")} | Notes |`);
    lines.push(`| --- | --- | ${targets.map(() => "---").join(" | ")} | --- |`);
    for (const r of group) {
      const cells = targets.map((t) => {
        const cell = r.byTarget[t]!;
        return cell.status === "fail" ? `${STATUS_LABEL.fail} (${cell.findings})` : STATUS_LABEL[cell.status];
      });
      lines.push(`| ${r.id} ${r.name} | ${r.level} | ${cells.join(" | ")} | ${r.notes.join("<br>").replace(/\|/g, "\\|")} |`);
    }
  }
  return lines.join("\n");
}
