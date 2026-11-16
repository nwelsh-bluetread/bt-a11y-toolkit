/**
 * Read saved screen reader transcripts (and any AI reviews next to them) from
 * a folder and turn them into findings.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Finding } from "../types.js";
import { analyzeTranscript, reviewFindings } from "./analyze.js";
import type { Transcript, TranscriptReview } from "./transcript.js";


export interface LoadedTranscripts {
  transcripts: Array<{ file: string; transcript: Transcript; findings: number; reviewed: boolean }>;
  findings: Finding[];
  /** Pages the workflows visited. */
  pages: string[];
}

function isTranscript(x: unknown): x is Transcript {
  const t = x as Partial<Transcript>;
  return Boolean(t && t.version === 1 && typeof t.workflow === "string" && Array.isArray(t.steps));
}

export function loadTranscripts(dir: string, cwd = process.cwd()): LoadedTranscripts {
  const out: LoadedTranscripts = { transcripts: [], findings: [], pages: [] };
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".review.json")).sort()) {
    const path = join(dir, name);
    const data: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isTranscript(data)) continue;
    const file = relative(cwd, path);
    const findings = analyzeTranscript(data, file);
    const reviewPath = path.replace(/\.json$/, ".review.json");
    const reviewed = existsSync(reviewPath);
    if (reviewed) findings.push(...reviewFindings(data, JSON.parse(readFileSync(reviewPath, "utf8")) as TranscriptReview, file));
    out.transcripts.push({ file, transcript: data, findings: findings.length, reviewed });
    out.findings.push(...findings);
    for (const step of data.steps) if (step.url && !out.pages.includes(step.url)) out.pages.push(step.url);
  }
  return out;
}

/** Compare URLs ignoring a trailing slash and the #fragment. */
export function sameUrl(a: string, b: string): boolean {
  const norm = (u: string) => u.split("#")[0]!.replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/**
 * The audit URL a tested page belongs to: the same URL, or the same host and path
 * on another port (a dev server on :5173 for an audit of :4173). Undefined when
 * none, or when the path matches more than one audit page.
 */
export function matchAuditUrl(page: string, auditUrls: string[]): string | undefined {
  const exact = auditUrls.find((u) => sameUrl(u, page));
  if (exact) return exact;
  const parts = (u: string) => {
    try {
      const x = new URL(u);
      return { host: x.hostname.toLowerCase(), path: `${x.pathname.replace(/\/+$/, "") || "/"}${x.search}`.toLowerCase() };
    } catch {
      return undefined;
    }
  };
  const p = parts(page);
  if (!p) return undefined;
  const same = auditUrls.filter((u) => {
    const a = parts(u);
    return a && a.host === p.host && a.path === p.path;
  });
  return same.length === 1 ? same[0] : undefined;
}

/** Point each finding's page at the audit's own spelling of that URL, so it lands on the right checklist screen. */
export function alignPages(findings: Finding[], auditUrls: string[]): Finding[] {
  return findings.map((f) => {
    const page = typeof f.evidence?.page === "string" ? f.evidence.page : undefined;
    const match = page ? matchAuditUrl(page, auditUrls) : undefined;
    return match && match !== page ? { ...f, evidence: { ...f.evidence, page: match } } : f;
  });
}
