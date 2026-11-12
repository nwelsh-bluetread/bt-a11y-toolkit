/**
 * Add screen reader transcripts to a guided audit: their findings become one
 * automated run (replacing the previous screen reader run), so they pre-fill
 * the checklist as "not reviewed yet". Used by `bt-a11y sr findings` and by the
 * guided audit when VoiceOver is part of it.
 */
import type { AuditSession } from "../wizard/session.js";
import { upsertRun } from "../wizard/session.js";
import { SCREEN_READER_CRITERIA, SOURCE } from "./analyze.js";
import { alignPages, loadTranscripts, sameUrl, type LoadedTranscripts } from "./load.js";

export interface ScreenReaderMerge {
  loaded: LoadedTranscripts;
  /** Findings added to the audit. */
  findings: number;
  /** Pages the workflows visited that aren't audit pages (their findings go under app-wide). */
  outside: string[];
}

/** Undefined when the folder has no transcripts. */
export function addScreenReaderRun(session: AuditSession, dir: string, cwd: string): ScreenReaderMerge | undefined {
  const loaded = loadTranscripts(dir, cwd);
  if (loaded.transcripts.length === 0) return undefined;
  const urls = session.project.urls ?? [];
  const findings = alignPages(loaded.findings, urls);
  upsertRun(session, {
    tool: SOURCE,
    targets: ["web"],
    ranAt: new Date().toISOString(),
    pages: loaded.pages.length,
    checked: SCREEN_READER_CRITERIA,
    findings,
  });
  return { loaded, findings: findings.length, outside: loaded.pages.filter((p) => !urls.some((u) => sameUrl(u, p))) };
}
