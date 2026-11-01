/**
 * Import a BrowserStack App Accessibility CSV into the guided audit.
 *
 * BrowserStack numbers its scans (one per screen it captured) but doesn't name
 * the screens, so the tester picks the screen for each scan. The issues become
 * an automated run (`browserstack-ios` / `browserstack-android`): they pre-fill
 * the matching checklist lines on that screen, and flow into report.md and the
 * summary PDF like any other scan. Importing another export adds to the run;
 * re-importing the same report replaces its earlier issues.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve as resolvePath } from "node:path";
import {
  browserStackCriteria,
  browserStackFindings,
  detectPlatform,
  isBrowserStackCsv,
  parseBrowserStackCsv,
  scanSummaries,
  type BrowserStackPlatform,
} from "../integrations/browserstack.js";
import type { Prompter } from "./prompts.js";
import { SESSION_DIR, upsertRun, type AuditSession } from "./session.js";

export interface BrowserStackImportDeps {
  prompter: Prompter;
  cwd: string;
  out: (text: string) => void;
}

const PLATFORM_LABEL: Record<BrowserStackPlatform, string> = { ios: "iOS", android: "Android" };
export const BROWSERSTACK_DIR = "browserstack";

export const browserStackTool = (platform: BrowserStackPlatform) => `browserstack-${platform}`;

/** BrowserStack CSVs in the project folder or a11y-audit/ that haven't been imported yet. */
export function findBrowserStackCsvs(cwd: string): string[] {
  const imported = new Set(existsSync(join(cwd, SESSION_DIR, BROWSERSTACK_DIR)) ? readdirSync(join(cwd, SESSION_DIR, BROWSERSTACK_DIR)) : []);
  const found: string[] = [];
  for (const dir of [".", SESSION_DIR]) {
    const abs = join(cwd, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) {
      if (!/\.csv$/i.test(f) || imported.has(f)) continue;
      try {
        if (isBrowserStackCsv(readFileSync(join(abs, f), "utf8").slice(0, 4000))) found.push(dir === "." ? f : `${dir}/${f}`);
      } catch {
        // Unreadable — not ours.
      }
    }
  }
  return found;
}

/** Ask for BrowserStack CSVs (Enter skips), then import each one. Returns how many were imported. */
export async function browserStackStep(deps: BrowserStackImportDeps, session: AuditSession): Promise<number> {
  const { prompter: p, cwd, out } = deps;
  const suggested = findBrowserStackCsvs(cwd);
  const raw = await p.input("BrowserStack App Accessibility CSV export? (paths, comma-separated; Enter to skip)", {
    default: suggested.join(", ") || undefined,
    validate: (v) => {
      for (const f of splitPaths(v)) {
        const abs = resolve(cwd, f);
        if (!existsSync(abs)) return `Not found: ${f}`;
        if (!isBrowserStackCsv(readFileSync(abs, "utf8"))) return `Not a BrowserStack App Accessibility CSV: ${f}`;
      }
      return true;
    },
  });
  let imported = 0;
  for (const f of splitPaths(raw)) {
    try {
      await importBrowserStackCsv(deps, session, resolve(cwd, f));
      imported++;
    } catch (err) {
      out(`✗ ${basename(f)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return imported;
}

/** Parse one export, map its scans to screens, and save its issues as a run on the session (not written to disk). */
export async function importBrowserStackCsv(deps: BrowserStackImportDeps, session: AuditSession, path: string): Promise<{ platform: BrowserStackPlatform; findings: number }> {
  const { prompter: p, cwd, out } = deps;
  const report = parseBrowserStackCsv(readFileSync(path, "utf8"));
  const file = basename(path);
  const mobile = session.project.targets.filter((t): t is BrowserStackPlatform => t === "ios" || t === "android");
  if (mobile.length === 0) throw new Error("This audit doesn't include a mobile app, and BrowserStack App Accessibility scans apps.");

  let platform = detectPlatform(report);
  if (!platform || !mobile.includes(platform)) {
    if (platform) throw new Error(`The scan ran on ${PLATFORM_LABEL[platform]} (${report.meta["Device"] ?? "device"}), which this audit doesn't include.`);
    platform =
      mobile.length === 1
        ? mobile[0]!
        : await p.select<BrowserStackPlatform>(`Which platform was ${file} scanned on?`, mobile.map((t) => ({ name: PLATFORM_LABEL[t], value: t })));
  }

  const reportKey = report.meta["Report Link"] || file;
  const tool = browserStackTool(platform);
  const earlier = session.automated.find((r) => r.tool === tool);
  const fromThisReport = (f: { evidence?: Record<string, unknown> }) => (f.evidence?.report ?? f.evidence?.csv) === reportKey || f.evidence?.csv === file;

  // ── Which screen was each scan? ──
  const screens = session.screens.filter((s) => s.kind === "mobile");
  const mapping: Record<number, string | undefined> = {};
  const summaries = scanSummaries(report);
  out(`\nBrowserStack ${PLATFORM_LABEL[platform]} scan: ${report.meta["App Package Name"] ?? file}${report.meta["Device"] ? ` on ${report.meta["Device"]}` : ""} · ${summaries.length} scan${summaries.length === 1 ? "" : "s"}`);
  for (const s of summaries) {
    if (s.issues === 0 || s.appWideOnly || screens.length === 0) continue;
    const previous = earlier?.findings.find((f) => fromThisReport(f) && f.evidence?.scan === s.scan && f.evidence?.screen !== "App-wide")?.evidence?.screen;
    const hint = s.elements.length ? ` · elements: ${s.elements.slice(0, 4).join(", ")}${s.elements.length > 4 ? ", …" : ""}` : "";
    mapping[s.scan] =
      (await p.select<string>(
        `Which screen is BrowserStack scan ${s.scan}? (${s.issues} issue${s.issues === 1 ? "" : "s"}${hint})`,
        [{ name: "App-wide / not sure", value: "" }, ...screens.map((sc) => ({ name: sc.group ? `${sc.name} · ${sc.group}` : sc.name, value: sc.name }))],
        { default: typeof previous === "string" ? previous : "" },
      )) || undefined;
  }

  // ── Save: keep issues from other exports, replace this one's ──
  const findings = browserStackFindings(report, { platform, screens: mapping, file });
  upsertRun(session, {
    tool,
    targets: [platform],
    ranAt: new Date().toISOString(),
    checked: [...new Set([...(earlier?.checked ?? []), ...browserStackCriteria(report)])],
    findings: [...(earlier?.findings ?? []).filter((f) => !fromThisReport(f)), ...findings],
  });

  // Keep a copy with the audit.
  const dir = join(cwd, SESSION_DIR, BROWSERSTACK_DIR);
  mkdirSync(dir, { recursive: true });
  if (resolvePath(path) !== resolvePath(dir, file)) copyFileSync(path, join(dir, file));

  const skipped = report.issues.length - findings.length;
  const review = findings.filter((f) => f.evidence?.needsReview).length;
  out(
    `✓ Imported ${findings.length} BrowserStack issue${findings.length === 1 ? "" : "s"} (${PLATFORM_LABEL[platform]})` +
      (skipped ? ` · ${skipped} duplicate${skipped === 1 ? "" : "s"} skipped` : "") +
      (review ? ` · ${review} flagged for review` : ""),
  );
  return { platform, findings: findings.length };
}

/** A path from the prompt: relative to the project folder, ~ for home. */
function resolve(cwd: string, path: string): string {
  return resolvePath(cwd, path.replace(/^~(?=\/|$)/, homedir()));
}

function splitPaths(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}
