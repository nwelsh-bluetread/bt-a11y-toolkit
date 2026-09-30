/**
 * Trend analytics over a history of runs.
 *
 * Pure functions that turn a chronological list of {@link RunRecord}s into the
 * patterns worth acting on: the score trend line, which issues keep coming back,
 * how long each category of problem takes to fix, and which files accumulate the
 * most findings.
 *
 * All functions expect runs in chronological order (oldest first) and assume
 * `firstSeen` has been carried forward via
 * {@link import("./history.js").mergeRunHistory}. Nothing here touches storage.
 */
import type { Severity } from "./types.js";
import type { RunRecord, TrackedFinding } from "./history.js";

/** A single point on the overall-score trend line. */
export interface ScorePoint {
  runId: string;
  timestamp: string;
  overallScore: number;
  /** Change from the previous run (0 for the first run). */
  delta: number;
  commitSha?: string;
}

/**
 * The overall-score trend across runs, with per-run deltas — the headline
 * "are we getting better or worse?" line.
 */
export function scoreTrend(runs: RunRecord[]): ScorePoint[] {
  const ordered = sortByTime(runs);
  return ordered.map((run, i) => ({
    runId: run.runId,
    timestamp: run.timestamp,
    overallScore: run.overallScore,
    delta: i === 0 ? 0 : run.overallScore - ordered[i - 1]!.overallScore,
    commitSha: run.commitSha,
  }));
}

/** A recurring issue: fixed at least once, then seen again. */
export interface Recurrence {
  fingerprint: string;
  ruleId: string;
  title: string;
  location?: string;
  /** How many times the issue disappeared and came back. */
  recurrences: number;
  /** Run ids where the issue was present. */
  presentIn: string[];
}

/**
 * Issues that regressed — present, then absent, then present again — across the
 * run history. A high recurrence count points at a systemic source (e.g. a
 * shared component re-introducing the same violation).
 */
export function recurringIssues(runs: RunRecord[]): Recurrence[] {
  const ordered = sortByTime(runs);
  // Build a presence timeline per fingerprint.
  const timeline = new Map<
    string,
    { ruleId: string; title: string; location?: string; present: boolean[]; runIds: string[] }
  >();

  ordered.forEach((run, runIdx) => {
    const present = new Set(run.findings.map((f) => f.fingerprint));
    // Ensure every known fingerprint has a slot for this run.
    for (const f of run.findings) {
      if (!timeline.has(f.fingerprint)) {
        timeline.set(f.fingerprint, {
          ruleId: f.ruleId,
          title: f.title,
          location: f.location,
          present: new Array(ordered.length).fill(false),
          runIds: [],
        });
      }
    }
    for (const [fp, entry] of timeline) {
      entry.present[runIdx] = present.has(fp);
      if (present.has(fp)) entry.runIds.push(run.runId);
    }
  });

  const recurrences: Recurrence[] = [];
  for (const [fp, entry] of timeline) {
    // Count transitions from present -> absent -> present.
    let comebacks = 0;
    let seen = false;
    let wasAbsentAfterSeen = false;
    for (const present of entry.present) {
      if (present) {
        if (wasAbsentAfterSeen) {
          comebacks++;
          wasAbsentAfterSeen = false;
        }
        seen = true;
      } else if (seen) {
        wasAbsentAfterSeen = true;
      }
    }
    if (comebacks > 0) {
      recurrences.push({
        fingerprint: fp,
        ruleId: entry.ruleId,
        title: entry.title,
        location: entry.location,
        recurrences: comebacks,
        presentIn: entry.runIds,
      });
    }
  }

  return recurrences.sort((a, b) => b.recurrences - a.recurrences);
}

/** Mean-time-to-remediation for a group of findings. */
export interface Mttr {
  key: string;
  /** Number of findings that were resolved (disappeared) in the window. */
  resolvedCount: number;
  /** Average time-to-fix in hours. */
  avgHoursToFix: number;
  /** Median time-to-fix in hours. */
  medianHoursToFix: number;
}

const HOUR_MS = 1000 * 60 * 60;

/**
 * Mean-time-to-remediation grouped by category.
 *
 * A finding is "resolved" the first run its fingerprint is absent after having
 * been present; time-to-fix is `lastSeen(before disappearance) - firstSeen`.
 * These are empirical fix times you can feed back into effort estimation.
 */
export function mttrByCategory(runs: RunRecord[]): Mttr[] {
  return mttrBy(runs, (f) => f.category ?? "Uncategorized");
}

/** Mean-time-to-remediation grouped by severity. */
export function mttrBySeverity(runs: RunRecord[]): Mttr[] {
  return mttrBy(runs, (f) => f.severity);
}

function mttrBy(runs: RunRecord[], keyOf: (f: TrackedFinding) => string): Mttr[] {
  const ordered = sortByTime(runs);
  // Track the last time each fingerprint was seen and its firstSeen/key.
  const lastSeen = new Map<string, TrackedFinding>();
  const resolvedHoursByKey = new Map<string, number[]>();

  ordered.forEach((run, runIdx) => {
    const presentNow = new Set(run.findings.map((f) => f.fingerprint));
    for (const f of run.findings) lastSeen.set(f.fingerprint, f);

    if (runIdx === 0) return;
    // Anything previously tracked but absent now counts as resolved this run.
    // Time-to-fix runs from firstSeen to the run that detected the fix.
    const resolvedAt = Date.parse(run.timestamp);
    for (const [fp, f] of [...lastSeen]) {
      if (presentNow.has(fp)) continue;
      const first = Date.parse(f.firstSeen);
      if (Number.isNaN(first) || Number.isNaN(resolvedAt)) {
        lastSeen.delete(fp);
        continue;
      }
      const hours = Math.max(0, (resolvedAt - first) / HOUR_MS);
      const key = keyOf(f);
      const list = resolvedHoursByKey.get(key) ?? [];
      list.push(hours);
      resolvedHoursByKey.set(key, list);
      lastSeen.delete(fp);
    }
  });

  const results: Mttr[] = [];
  for (const [key, hours] of resolvedHoursByKey) {
    results.push({
      key,
      resolvedCount: hours.length,
      avgHoursToFix: round(hours.reduce((a, b) => a + b, 0) / hours.length),
      medianHoursToFix: round(median(hours)),
    });
  }
  return results.sort((a, b) => b.resolvedCount - a.resolvedCount);
}

/** A file/page accumulating findings. */
export interface Hotspot {
  location: string;
  /** Total findings seen at this location across all runs (deduped by fingerprint). */
  distinctIssues: number;
  /** Worst severity ever seen at this location. */
  worstSeverity: Severity;
  ruleIds: string[];
}

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

/**
 * The files/pages that accumulate the most distinct issues across history —
 * where remediation effort is best spent.
 */
export function hotspots(runs: RunRecord[], limit = 10): Hotspot[] {
  const byLocation = new Map<
    string,
    { fingerprints: Set<string>; rules: Set<string>; severities: Set<Severity> }
  >();

  for (const run of runs) {
    for (const f of run.findings) {
      if (!f.location) continue;
      const entry =
        byLocation.get(f.location) ??
        { fingerprints: new Set<string>(), rules: new Set<string>(), severities: new Set<Severity>() };
      entry.fingerprints.add(f.fingerprint);
      entry.rules.add(f.ruleId);
      entry.severities.add(f.severity);
      byLocation.set(f.location, entry);
    }
  }

  return [...byLocation.entries()]
    .map(([location, e]) => ({
      location,
      distinctIssues: e.fingerprints.size,
      worstSeverity: SEVERITY_ORDER.find((s) => e.severities.has(s)) ?? "low",
      ruleIds: [...e.rules].sort(),
    }))
    .sort((a, b) => b.distinctIssues - a.distinctIssues)
    .slice(0, limit);
}

function sortByTime(runs: RunRecord[]): RunRecord[] {
  return [...runs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
