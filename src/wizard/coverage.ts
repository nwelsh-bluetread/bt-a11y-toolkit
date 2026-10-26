/**
 * WCAG 2.2 criteria coverage matrix: where each of the 86 success criteria
 * stands, per platform, combining code/web scans, the manual checklist, and
 * logged findings.
 *
 * Status precedence for a criterion on a platform:
 *   fail          a finding maps to it
 *   pass          every checklist row covering it (every screen) is answered, and none failed it
 *   na            the tester marked every covering row not applicable — the content doesn't exist
 *                 (e.g. no audio or video in the app); `reason` says which
 *   scan-clear    an automated scan checks it and found nothing — still verify manually
 *   not-tested    nothing has looked at it yet
 *   not-applicable  the criterion doesn't apply to this kind of platform (e.g. Bypass Blocks
 *                 is web only); `reason` says so
 */
import { MANUAL_CHECKLIST, type AuditTarget } from "../checklist.js";
import { FEATURE_LABEL } from "../code-scan/screens.js";
import type { WcagLevel } from "../types.js";
import { WCAG, WCAG_PRINCIPLES } from "../wcag.js";
import type { ParsedChecklist } from "./checklist-md.js";
import { checklistFindings, type AuditSession } from "./session.js";

export type CoverageStatus = "fail" | "pass" | "na" | "scan-clear" | "not-tested" | "not-applicable";

export interface CoverageCell {
  status: CoverageStatus;
  findings: number;
  sources: string[];
  /** Screens where the scan failed this criterion but no tester has reviewed them yet. */
  unreviewed: number;
  /** Why it's N/A or doesn't apply, e.g. "No audio/video in the app" or "Web only: doesn't apply to native apps". */
  reason?: string;
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

/** Why a criterion's checks were all marked N/A: the content they need (audio/video, forms…), when the check names it. */
function naReason(itemIds: Set<string>): string {
  const features = [...new Set(MANUAL_CHECKLIST.filter((i) => itemIds.has(i.id)).flatMap((i) => i.when ?? []))];
  return features.length ? `No ${features.map((f) => FEATURE_LABEL[f]).join(" or ")} in the app` : "Marked not applicable by testers";
}

const PLATFORM_NA = { mobile: "Web only: doesn't apply to native apps", web: "App only: doesn't apply to websites" };

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
      const coveringItems = new Set(MANUAL_CHECKLIST.filter((i) => i.wcag.includes(id)).map((i) => i.id));
      const unreviewed = new Set(
        parsed.rows.filter((r) => r.target === target && r.reviewed === false && coveringItems.has(r.itemId)).map((r) => r.screen ?? ""),
      ).size;

      let status: CoverageStatus;
      let reason: string | undefined;
      if (!appliesTo(id, target)) {
        status = "not-applicable";
        reason = PLATFORM_NA[target === "web" ? "web" : "mobile"];
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
          if (status === "na") reason = naReason(itemIds);
        } else {
          status = scanned ? "scan-clear" : "not-tested";
        }
      }
      row.byTarget[target] = { status, findings: failing.length, sources: [...sources], unreviewed, ...(reason ? { reason } : {}) };
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
  na: "➖ N/A: no such content",
  "not-applicable": "🌐 Web only",
  "scan-clear": "🔎 Scan clear — verify",
  "not-tested": "⬜ Not tested",
};

/** One result per criterion across platforms, for summaries and the PDF. */
export type CriterionResult = "pass" | "fail" | "na" | "platform-na" | "not-verified";

export const RESULT_LABEL: Record<CriterionResult, string> = {
  pass: "Pass",
  fail: "Fail",
  na: "N/A",
  "platform-na": "Web only",
  "not-verified": "Not yet verified",
};

/**
 * Combine a criterion's platforms: it fails if it fails anywhere, passes once
 * every platform it applies to passes (or has no such content), is N/A or web
 * only when it is on every platform, and is otherwise not yet verified.
 */
export function criterionResult(row: CoverageRow): { result: CriterionResult; reason?: string; note?: string } {
  const entries = Object.entries(row.byTarget) as Array<[AuditTarget, CoverageCell]>;
  const cells = entries.map(([, c]) => c);
  const on = (status: CoverageStatus) => entries.filter(([, c]) => c.status === status).map(([t]) => TARGET_LABEL[t]);
  const partial = (list: string[]) => (list.length < entries.length ? list.join(", ") : undefined);
  if (cells.some((c) => c.status === "fail")) return { result: "fail", note: partial(on("fail")) && `Fails on ${on("fail").join(", ")}` };
  if (cells.every((c) => c.status === "not-applicable")) return { result: "platform-na", reason: cells[0]?.reason };
  if (cells.every((c) => c.status === "na" || c.status === "not-applicable")) {
    return { result: "na", reason: [...new Set(cells.filter((c) => c.status === "na").map((c) => c.reason))].join("; ") };
  }
  if (cells.every((c) => c.status === "pass" || c.status === "na" || c.status === "not-applicable")) return { result: "pass" };
  return { result: "not-verified", note: on("pass").length ? `Passes on ${on("pass").join(", ")} so far` : undefined };
}

export interface LevelResult {
  level: WcagLevel;
  total: number;
  counts: Record<CriterionResult, number>;
}

/** Criteria at each level (A, AA, … up to the target) by result. Levels are counted on their own, not cumulatively. */
export function levelResults(coverage: Coverage): LevelResult[] {
  return (["A", "AA", "AAA"] as WcagLevel[])
    .filter((level) => RANK[level] <= RANK[coverage.targetLevel])
    .map((level) => {
      const rows = coverage.rows.filter((r) => r.level === level);
      const counts: Record<CriterionResult, number> = { pass: 0, fail: 0, na: 0, "platform-na": 0, "not-verified": 0 };
      for (const r of rows) counts[criterionResult(r).result]++;
      return { level, total: rows.length, counts };
    });
}

/** One-line summary per platform, e.g. "iOS: 8 fail · 30 pass · 12 not tested". */
export function coverageSummaryLines(coverage: Coverage): string[] {
  return coverage.targets.map((t) => {
    const s = coverage.summary[t]!;
    const awaiting = coverage.rows.filter((r) => r.byTarget[t]?.status === "fail" && r.byTarget[t]!.unreviewed > 0).length;
    const parts = [
      s.fail && `${s.fail} fail${awaiting ? ` (${awaiting} found only by the scan, not yet reviewed)` : ""}`,
      s.pass && `${s.pass} pass`,
      s.na && `${s.na} N/A (no such content)`,
      s["scan-clear"] && `${s["scan-clear"]} scan clear (verify)`,
      s["not-tested"] && `${s["not-tested"]} not tested`,
      s["not-applicable"] && `${s["not-applicable"]} ${t === "web" ? "app only" : "web only"}`,
    ].filter(Boolean);
    return `${TARGET_LABEL[t]}: ${parts.join(" · ")}`;
  });
}

/** "Web only" on app platforms, "App only" on websites. */
function statusLabel(status: CoverageStatus, targets: AuditTarget[]): string {
  if (status !== "not-applicable") return STATUS_LABEL[status];
  if (targets.every((t) => t === "web")) return "📱 App only";
  return targets.includes("web") ? "🌐 Web only / 📱 App only" : STATUS_LABEL[status];
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
  lines.push("### By level");
  lines.push("");
  lines.push("Each criterion counted once across platforms: it fails if it fails on any platform, and passes once every platform it applies to passes.");
  lines.push("");
  const order: CriterionResult[] = ["pass", "fail", "na", "platform-na", "not-verified"];
  lines.push(`| Level | ${order.map((r) => RESULT_LABEL[r]).join(" | ")} | Criteria |`);
  lines.push(`| --- | ${order.map(() => "---:").join(" | ")} | ---: |`);
  for (const l of levelResults(coverage)) lines.push(`| ${l.level} | ${order.map((r) => l.counts[r]).join(" | ")} | ${l.total} |`);
  lines.push("");
  lines.push("### By platform");
  lines.push("");
  lines.push(`| Status | ${targets.map((t) => TARGET_LABEL[t]).join(" | ")} |`);
  lines.push(`| --- | ${targets.map(() => "---").join(" | ")} |`);
  for (const status of Object.keys(STATUS_LABEL) as CoverageStatus[]) {
    lines.push(`| ${statusLabel(status, targets)} | ${targets.map((t) => coverage.summary[t]![status]).join(" | ")} |`);
  }
  lines.push("");
  lines.push(
    "> **N/A: no such content** means testers marked the criterion's checks not applicable because the app has nothing it covers (for example, no audio or video). **Web only** means the criterion doesn't apply to native apps (for example, Bypass Blocks), so it isn't tested there. Neither counts for or against the score. **Scan clear — verify** means an automated check covers this criterion and found nothing. Automated checks only see part of each criterion, so it still needs manual confirmation. **Not reviewed** next to a failure counts screens where the scan found the issue but no tester has tested the rest of that screen yet.",
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
        if (cell.status === "na") return `${STATUS_LABEL.na}${cell.reason ? ` (${cell.reason.replace(/ in the app$/, "")})` : ""}`;
        if (cell.status === "not-applicable") return statusLabel(cell.status, [t]);
        if (cell.status !== "fail") return STATUS_LABEL[cell.status];
        return `${STATUS_LABEL.fail} (${cell.findings})${cell.unreviewed ? ` · ${cell.unreviewed} not reviewed` : ""}`;
      });
      lines.push(`| ${r.id} ${r.name} | ${r.level} | ${cells.join(" | ")} | ${r.notes.join("<br>").replace(/\|/g, "\\|")} |`);
    }
  }
  return lines.join("\n");
}
