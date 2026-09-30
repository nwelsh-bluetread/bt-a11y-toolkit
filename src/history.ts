/**
 * Run history & trend tracking.
 *
 * Turns the stateless {@link Assessment} produced each scan into a durable,
 * comparable record so the toolkit can answer questions like "is this the same
 * issue we saw last week?", "what did we fix?", and "what regressed?".
 *
 * The two foundational pieces are:
 *
 *   1. {@link fingerprint} — a deterministic identity for a finding, stable
 *      across runs and across engines (axe / Pa11y / Lighthouse), so the same
 *      problem on the same element always hashes the same.
 *   2. {@link diffRuns} — compares two runs by fingerprint and classifies every
 *      finding as new, fixed, regressed, or persisting.
 *
 * This module is intentionally pure and storage-agnostic: it produces plain
 * serializable records ({@link RunRecord}) that a caller can append to a JSONL
 * ledger, a SQLite table, or an artifact bucket. Nothing here reads or writes
 * files, which keeps it trivially unit-testable.
 */
import { createHash } from "node:crypto";
import type { Assessment, Finding, Severity } from "./types.js";

/** Metadata locating a run in code history. */
export interface RunMeta {
  /** Unique id for the run. Defaults to a timestamp-based id when omitted. */
  runId?: string;
  /** ISO timestamp; defaults to the assessment's `generatedAt`. */
  timestamp?: string;
  /** Git commit SHA the scan ran against, when known. */
  commitSha?: string;
  /** Git branch, when known. */
  branch?: string;
  /** Free-form label, e.g. "nightly", "pr-1234". */
  label?: string;
}

/** A single tracked finding within a {@link RunRecord}. */
export interface TrackedFinding {
  fingerprint: string;
  ruleId: string;
  wcag: string[];
  severity: Severity;
  category?: string;
  source?: string;
  /** File or page the finding was located in, when recorded. */
  location?: string;
  /** Element selector, when recorded. */
  selector?: string;
  title: string;
  firstSeen: string;
  lastSeen: string;
}

/** A durable, append-only record of one scan. */
export interface RunRecord {
  runId: string;
  timestamp: string;
  commitSha?: string;
  branch?: string;
  label?: string;
  overallScore: number;
  counts: Record<Severity, number>;
  findings: TrackedFinding[];
}

/** How one finding changed relative to the previous run. */
export type FindingStatus = "new" | "fixed" | "regressed" | "persisting";

/** The classification of a finding when diffing two runs. */
export interface FindingChange {
  fingerprint: string;
  status: FindingStatus;
  finding: TrackedFinding;
}

/** The result of comparing two runs. */
export interface RunDiff {
  /** Findings present now but not in the previous run (never seen before). */
  new: TrackedFinding[];
  /** Findings present in the previous run but gone now. */
  fixed: TrackedFinding[];
  /**
   * Findings present now that were previously fixed — i.e. they appear now, are
   * absent from the immediately previous run, but were seen in an earlier run.
   * Requires `priorFingerprints` to detect; otherwise these fold into `new`.
   */
  regressed: TrackedFinding[];
  /** Findings present in both runs. */
  persisting: TrackedFinding[];
  /** Overall score delta (now - previous). */
  scoreDelta: number;
  /** Per-finding classification, useful for rendering a changelog. */
  changes: FindingChange[];
}

/** The file/page a finding was located in, however the engine recorded it. */
function locationOf(f: Finding): string | undefined {
  const page = f.evidence?.page;
  if (typeof page === "string" && page.length > 0) return page;
  return undefined;
}

/** A single element selector for a finding, if one was recorded. */
function selectorOf(f: Finding): string | undefined {
  const ev = f.evidence ?? {};
  const elements = Array.isArray(ev.elements)
    ? (ev.elements as Array<{ selector?: string }>)
    : [];
  const selectors = Array.isArray(ev.selectors) ? (ev.selectors as string[]) : [];
  return elements[0]?.selector ?? selectors[0] ?? f.nodeId ?? undefined;
}

/**
 * Normalize a selector to just its target element so trivially different
 * ancestor paths from different engines still fingerprint the same. Mirrors the
 * philosophy of `selectorTail` in the combined integration but yields a stable
 * string rather than a structured object.
 *
 * `div.wrap > nav.crumbs > a.link:nth-child(2)` -> `a.link`
 */
export function normalizeSelector(selector: string | undefined): string {
  if (!selector) return "";
  const segments = selector.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  // Drop pseudo-classes and attribute selectors the engines disagree about.
  const bare = last.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, "").replace(/\[[^\]]*\]/g, "");
  const tag = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(bare)?.[0]?.toLowerCase() ?? "";
  const id = /#([^.#]+)/.exec(bare)?.[1] ?? "";
  const classes = (bare.match(/\.[^.#]+/g) ?? []).map((c) => c.slice(1)).sort();
  // Prefer id when present (most stable), else tag + sorted classes.
  if (id) return `${tag}#${id}`;
  return classes.length > 0 ? `${tag}.${classes.join(".")}` : tag;
}

/**
 * Compute a stable, deterministic fingerprint for a finding.
 *
 * The fingerprint is a hash of the parts that identify "the same problem on the
 * same element": the WCAG criteria, the location (file/page), and the
 * normalized selector. The rule *engine* is deliberately excluded so a finding
 * that axe and Pa11y both report fingerprints identically — corroboration
 * should not fork the identity.
 *
 * Findings with no selector and no location fall back to including the ruleId so
 * distinct rules don't collapse into one bucket.
 */
export function fingerprint(f: Finding): string {
  const wcag = f.wcag.map((c) => c.id).sort().join(",");
  const location = locationOf(f) ?? "";
  const selector = normalizeSelector(selectorOf(f));
  // When there's nothing to locate the element, fall back to the rule id so
  // different rules stay distinct.
  const anchor = selector || location ? "" : stripEngine(f.ruleId);
  const key = [wcag, location, selector, anchor].join("|");
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

/** Strip an engine prefix (`axe:`, `pa11y:`, `lighthouse:`) from a rule id. */
function stripEngine(ruleId: string): string {
  const idx = ruleId.indexOf(":");
  return idx === -1 ? ruleId : ruleId.slice(idx + 1);
}

/** Build a default run id from a timestamp. */
function defaultRunId(timestamp: string): string {
  return `run-${timestamp.replace(/[:.]/g, "-")}`;
}

/**
 * Convert an {@link Assessment} into a durable {@link RunRecord}, computing a
 * fingerprint for every finding. `firstSeen`/`lastSeen` are set to this run's
 * timestamp; {@link mergeRunHistory} carries `firstSeen` forward across runs.
 */
export function recordRun(assessment: Assessment, meta: RunMeta = {}): RunRecord {
  const timestamp = meta.timestamp ?? assessment.generatedAt;
  const runId = meta.runId ?? defaultRunId(timestamp);

  const findings: TrackedFinding[] = assessment.findings.map((f) => {
    const fp = f.fingerprint ?? fingerprint(f);
    return {
      fingerprint: fp,
      ruleId: f.ruleId,
      wcag: f.wcag.map((c) => c.id),
      severity: f.severity,
      category: f.category,
      source: f.source,
      location: locationOf(f),
      selector: selectorOf(f),
      title: f.title,
      firstSeen: f.firstSeen ?? timestamp,
      lastSeen: timestamp,
    };
  });

  return {
    runId,
    timestamp,
    commitSha: meta.commitSha,
    branch: meta.branch,
    label: meta.label,
    overallScore: assessment.overallScore,
    counts: assessment.counts,
    findings,
  };
}

/** Index a run's findings by fingerprint (last write wins on collisions). */
function indexByFingerprint(run: RunRecord): Map<string, TrackedFinding> {
  const map = new Map<string, TrackedFinding>();
  for (const f of run.findings) map.set(f.fingerprint, f);
  return map;
}

/**
 * Compare two runs and classify every finding.
 *
 * `priorFingerprints` (the set of fingerprints seen in any run *before*
 * `previous`) lets the diff distinguish a genuine regression (fixed once, now
 * back) from a brand-new issue. When omitted, regressions fold into `new`.
 */
export function diffRuns(
  previous: RunRecord,
  next: RunRecord,
  priorFingerprints?: Set<string>,
): RunDiff {
  const prevMap = indexByFingerprint(previous);
  const nextMap = indexByFingerprint(next);

  const result: RunDiff = {
    new: [],
    fixed: [],
    regressed: [],
    persisting: [],
    scoreDelta: next.overallScore - previous.overallScore,
    changes: [],
  };

  for (const [fp, finding] of nextMap) {
    if (prevMap.has(fp)) {
      result.persisting.push(finding);
      result.changes.push({ fingerprint: fp, status: "persisting", finding });
    } else if (priorFingerprints?.has(fp)) {
      result.regressed.push(finding);
      result.changes.push({ fingerprint: fp, status: "regressed", finding });
    } else {
      result.new.push(finding);
      result.changes.push({ fingerprint: fp, status: "new", finding });
    }
  }

  for (const [fp, finding] of prevMap) {
    if (!nextMap.has(fp)) {
      result.fixed.push(finding);
      result.changes.push({ fingerprint: fp, status: "fixed", finding });
    }
  }

  return result;
}

/**
 * Carry `firstSeen` forward across a history of runs so each finding's age is
 * accurate. Given runs in chronological order, returns the same runs with every
 * finding's `firstSeen` set to the earliest run its fingerprint appeared in.
 *
 * This is what lets you compute issue age and mean-time-to-remediation later.
 */
export function mergeRunHistory(runs: RunRecord[]): RunRecord[] {
  const firstSeen = new Map<string, string>();
  // Chronological order matters; sort defensively by timestamp.
  const ordered = [...runs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return ordered.map((run) => ({
    ...run,
    findings: run.findings.map((f) => {
      const seen = firstSeen.get(f.fingerprint);
      const first = seen ?? f.firstSeen ?? run.timestamp;
      if (!seen) firstSeen.set(f.fingerprint, first);
      return { ...f, firstSeen: first };
    }),
  }));
}

/**
 * The set of every fingerprint seen across a list of runs — the input
 * `diffRuns` needs to detect regressions.
 */
export function allFingerprints(runs: RunRecord[]): Set<string> {
  const set = new Set<string>();
  for (const run of runs) for (const f of run.findings) set.add(f.fingerprint);
  return set;
}
