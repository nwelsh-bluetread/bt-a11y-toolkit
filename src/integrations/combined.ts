/**
 * Multi-source assessment merging.
 *
 * Combines {@link Assessment}s produced by different engines (e.g. Lighthouse
 * and axe-core) into a single consolidated report. Findings that describe the
 * same problem on the same element from different tools are de-duplicated, while
 * keeping a record of which sources reported each issue.
 */
import type {
  Assessment,
  CategoryScore,
  Finding,
  Severity,
  WcagLevel,
} from "../types.js";
import {
  computeOverallScore,
  computeTopIssues,
  countBySeverity,
} from "../audit.js";

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

function worstSeverity(findings: Finding[]): Severity {
  for (const sev of SEVERITY_ORDER) {
    if (findings.some((f) => f.severity === sev)) return sev;
  }
  return "low";
}

/**
 * A key that identifies "the same problem on the same element" when two tools
 * report the *identical* selector. This is the cheap exact-match pass; engines
 * that describe the same element differently are paired up by
 * {@link isSameElement} afterwards.
 */
function dedupeKey(f: Finding): string {
  const selector = primarySelector(f) ?? "";
  return `${groupKey(f)}|${selector}`;
}

/**
 * Identifies "the same kind of problem on the same page" — the bucket within
 * which two findings are candidates for cross-engine pairing.
 */
function groupKey(f: Finding): string {
  const wcag = f.wcag.map((c) => c.id).sort().join(",");
  const page = (f.evidence?.page as string | undefined) ?? "";
  return `${page}|${f.category ?? ""}|${wcag}`;
}

/** The selector a finding points at, however the engine recorded it. */
function primarySelector(f: Finding): string | undefined {
  const ev = f.evidence ?? {};
  const elements = Array.isArray(ev.elements)
    ? (ev.elements as Array<{ selector?: string }>)
    : [];
  const selectors = Array.isArray(ev.selectors) ? (ev.selectors as string[]) : [];
  return elements[0]?.selector ?? selectors[0] ?? f.nodeId;
}

/** The HTML snippet a finding recorded, however the engine recorded it. */
function primaryHtml(f: Finding): string | undefined {
  const ev = f.evidence ?? {};
  const elements = Array.isArray(ev.elements) ? (ev.elements as Array<{ html?: string }>) : [];
  return elements[0]?.html ?? (typeof ev.html === "string" ? ev.html : undefined);
}

/** The right-most simple selector, reduced to the parts engines agree on. */
interface SelectorTail {
  tag?: string;
  id?: string;
  classes: Set<string>;
}

/**
 * Reduce a selector to its target element.
 *
 * Lighthouse reports a full ancestor path (`div.wrap > nav.crumbs > a.link`)
 * while axe reports the shortest unique selector (`.link`), so only the tail is
 * comparable. Pseudo-classes and attribute selectors are dropped because the
 * engines disagree about those too (`h3` vs `h3:nth-child(6)`).
 */
export function selectorTail(selector: string): SelectorTail {
  const segments = selector.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  const bare = last.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, "").replace(/\[[^\]]*\]/g, "");
  return {
    tag: /^[a-zA-Z][a-zA-Z0-9-]*/.exec(bare)?.[0]?.toLowerCase(),
    id: /#([^.#]+)/.exec(bare)?.[1],
    classes: new Set((bare.match(/\.[^.#]+/g) ?? []).map((c) => c.slice(1))),
  };
}

/**
 * Normalize an HTML snippet for comparison. Both engines truncate snippets, but
 * at different lengths and with different trailing junk (`…` vs `…">`), so only
 * a common prefix can be compared.
 */
function normalizeHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const oneLine = html.replace(/\s+/g, " ").trim().replace(/…"?>?$/, "");
  return oneLine.length > 0 ? oneLine : undefined;
}

/**
 * Shortest HTML prefix we trust as identity evidence. Anything shorter (`<h3>`,
 * `<img>`) describes a whole class of elements rather than one.
 */
const MIN_HTML_PREFIX = 12;

/**
 * Whether two findings from different engines describe the same element.
 *
 * Checked in order of confidence: a shared DOM id, then a shared class, then a
 * common HTML prefix, and finally — for elements with no distinguishing classes
 * or id at all — a matching tag name.
 */
export function isSameElement(a: Finding, b: Finding): boolean {
  const selA = primarySelector(a);
  const selB = primarySelector(b);
  const tailA = selA ? selectorTail(selA) : undefined;
  const tailB = selB ? selectorTail(selB) : undefined;

  if (tailA?.id && tailB?.id && tailA.id === tailB.id) return true;
  if (tailA && tailB) {
    for (const cls of tailA.classes) if (tailB.classes.has(cls)) return true;
  }

  const htmlA = normalizeHtml(primaryHtml(a));
  const htmlB = normalizeHtml(primaryHtml(b));
  if (htmlA && htmlB) {
    const [shorter, longer] = htmlA.length <= htmlB.length ? [htmlA, htmlB] : [htmlB, htmlA];
    if (shorter.length >= MIN_HTML_PREFIX && longer.startsWith(shorter)) return true;
  }

  if (tailA && tailB && tailA.tag && tailA.tag === tailB.tag) {
    const anonymous =
      tailA.classes.size === 0 && tailB.classes.size === 0 && !tailA.id && !tailB.id;
    if (anonymous) return true;
  }

  return false;
}

/** Pick the higher-severity finding as the primary of a duplicate pair. */
function moreSevere(a: Finding, b: Finding): Finding {
  return SEVERITY_ORDER.indexOf(a.severity) <= SEVERITY_ORDER.indexOf(b.severity) ? a : b;
}

function elementCount(ev: Record<string, unknown> | undefined): number {
  if (!ev) return 0;
  if (Array.isArray(ev.elements)) return ev.elements.length;
  if (Array.isArray(ev.selectors)) return ev.selectors.length;
  return 0;
}

/**
 * Combine the evidence of two duplicate findings, keeping the richest detail
 * from each engine rather than letting the later one overwrite it: axe carries
 * `failureSummary` with measured values, Lighthouse often enumerates more
 * affected elements.
 */
function mergeEvidence(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(a ?? {}), ...(b ?? {}) };

  // Keep whichever engine enumerated more elements.
  const [richer, poorer] = elementCount(a) >= elementCount(b) ? [a, b] : [b, a];
  if (richer?.elements) merged.elements = richer.elements;
  if (richer?.selectors) merged.selectors = richer.selectors;

  const affected = Math.max(
    typeof a?.affectedElements === "number" ? a.affectedElements : 0,
    typeof b?.affectedElements === "number" ? b.affectedElements : 0,
    elementCount(a),
    elementCount(b),
  );
  if (affected > 0) merged.affectedElements = affected;

  // Prefer the longer HTML snippet and any available failure summary.
  const htmlA = typeof a?.html === "string" ? a.html : undefined;
  const htmlB = typeof b?.html === "string" ? b.html : undefined;
  const html = (htmlA?.length ?? 0) >= (htmlB?.length ?? 0) ? htmlA : htmlB;
  if (html) merged.html = html;

  const summary =
    (typeof a?.failureSummary === "string" ? a.failureSummary : undefined) ??
    (typeof b?.failureSummary === "string" ? b.failureSummary : undefined);
  if (summary) merged.failureSummary = summary;
  else if (poorer) delete merged.failureSummary;

  return merged;
}

/** A surviving finding plus every source that reported it. */
interface MergeEntry {
  finding: Finding;
  sources: Set<string>;
}

/** Fold `finding` into an existing entry, keeping the best of both. */
function absorb(entry: MergeEntry, finding: Finding, sources?: Set<string>): void {
  for (const s of sources ?? [sourceOf(finding)]) entry.sources.add(s);
  entry.finding = {
    ...moreSevere(entry.finding, finding),
    evidence: mergeEvidence(entry.finding.evidence, finding.evidence),
  };
}

/** Extract the tool name a finding came from (`lighthouse`, `axe`, ...). */
function sourceOf(f: Finding): string {
  return f.source ?? "toolkit";
}

/**
 * Merge multiple assessments into one. Findings are de-duplicated across
 * sources; each surviving finding records every tool that reported it in
 * `evidence.sources`. Category and WCAG rollups are recomputed from the merged
 * finding set, and the overall score is the average of the input scores.
 */
export function mergeAssessments(
  assessments: Assessment[],
  options: { targetLevel?: WcagLevel } = {},
): Assessment {
  if (assessments.length === 0) {
    throw new Error("mergeAssessments requires at least one assessment.");
  }
  const targetLevel = options.targetLevel ?? assessments[0]!.targetLevel;

  // Pass 1 — collapse findings that report the identical selector.
  const exact = new Map<string, MergeEntry>();
  const candidates: MergeEntry[] = [];
  for (const assessment of assessments) {
    for (const finding of assessment.findings) {
      const key = dedupeKey(finding);
      const existing = exact.get(key);
      if (existing) {
        absorb(existing, finding);
        continue;
      }
      const entry: MergeEntry = { finding, sources: new Set([sourceOf(finding)]) };
      exact.set(key, entry);
      candidates.push(entry);
    }
  }

  // Pass 2 — pair up what different engines described differently. Only findings
  // in the same page/category/criteria bucket, reported by engines that have not
  // already been merged together, are considered.
  const buckets = new Map<string, MergeEntry[]>();
  const survivors: MergeEntry[] = [];
  for (const entry of candidates) {
    const bucket = buckets.get(groupKey(entry.finding)) ?? [];
    const match = bucket.find(
      (other) =>
        ![...entry.sources].some((s) => other.sources.has(s)) &&
        isSameElement(other.finding, entry.finding),
    );
    if (match) {
      absorb(match, entry.finding, entry.sources);
      continue;
    }
    bucket.push(entry);
    buckets.set(groupKey(entry.finding), bucket);
    survivors.push(entry);
  }

  const findings: Finding[] = survivors.map(({ finding, sources }) => ({
    ...finding,
    source: [...sources].sort().join("+"),
    evidence: { ...finding.evidence, sources: [...sources].sort() },
  }));

  // WCAG rollup: average each level across the input assessments.
  const wcag = { A: 0, AA: 0, AAA: 0 } as Record<WcagLevel, number>;
  for (const level of ["A", "AA", "AAA"] as WcagLevel[]) {
    const sum = assessments.reduce((acc, a) => acc + a.wcag[level], 0);
    wcag[level] = Math.round(sum / assessments.length);
  }

  // Category rollup recomputed from the merged findings.
  const byCategory = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = f.category ?? "Semantics";
    const list = byCategory.get(key) ?? [];
    list.push(f);
    byCategory.set(key, list);
  }
  const categories: CategoryScore[] = [...byCategory.entries()]
    .map(([category, list]) => ({
      category,
      score: Math.max(0, 100 - list.length * 15),
      severity: worstSeverity(list),
      findingCount: list.length,
    }))
    .sort((a, b) => a.score - b.score);

  // Overall score: average the source scores (each already 0-100).
  const overallScore =
    assessments.length > 0
      ? Math.round(
          assessments.reduce((acc, a) => acc + a.overallScore, 0) / assessments.length,
        )
      : computeOverallScore(findings, 100);

  return {
    generatedAt: new Date().toISOString(),
    platform: assessments[0]!.platform,
    targetLevel,
    overallScore,
    counts: countBySeverity(findings),
    wcag,
    categories,
    topIssues: computeTopIssues(findings),
    findings,
  };
}
