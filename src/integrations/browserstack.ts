/**
 * BrowserStack App Accessibility integration.
 *
 * Pure, like the axe and Lighthouse integrations: it reads the CSV that
 * BrowserStack's App Accessibility report exports ("Export → CSV") and turns
 * its issues into toolkit {@link Finding}s. The import step (which scan was
 * which screen) lives in `wizard/browserstack.ts`.
 *
 * The export is a block of `key,value` metadata rows (device, app, report
 * link), a blank row, then one row per issue. BrowserStack marks an issue it
 * already reported (the same element in a later scan) as `Duplicate`; those are
 * skipped so the totals match BrowserStack's own issue summary.
 */
import type { Finding, Severity, WcagCriterion } from "../types.js";
import { WCAG } from "../wcag.js";

export type BrowserStackPlatform = "ios" | "android";

export interface BrowserStackIssue {
  type: string;
  description: string;
  wcag: WcagCriterion[];
  severity: Severity;
  /** BrowserStack's severity word (Critical, Serious, Moderate, Minor). */
  severityLabel: string;
  elementClass: string;
  scan: number;
  index: number;
  needsReview: boolean;
  duplicate: boolean;
  experimental: boolean;
  /** Parsed "Issue Details" (colors, contrast ratio, measured size…). */
  details: Record<string, unknown>;
  howToFix: string;
  /** Flattened "Element Properties" (identifier, accessibilityLabel, visibleText, frame…). */
  element: Record<string, unknown>;
  issueLink?: string;
  docsLink?: string;
}

export interface BrowserStackReport {
  /** The metadata rows: "Device", "App Package Name", "Report Link", "WCAG Version"… */
  meta: Record<string, string>;
  issues: BrowserStackIssue[];
}

const SEVERITY: Record<string, Severity> = { critical: "critical", serious: "high", moderate: "medium", minor: "low" };

/** RFC 4180 CSV: quoted fields may hold commas, newlines and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Whether a CSV looks like a BrowserStack App Accessibility export. */
export function isBrowserStackCsv(text: string): boolean {
  return /app-accessibility\.browserstack\.com/.test(text) || /^Issue Type,Issue Description,WCAG,Severity/m.test(text);
}

export function parseBrowserStackCsv(text: string): BrowserStackReport {
  const rows = parseCsv(text);
  const header = rows.findIndex((r) => r[0] === "Issue Type" && r.includes("Severity"));
  if (header < 0) throw new Error("Not a BrowserStack App Accessibility CSV (no 'Issue Type' header row).");

  const meta: Record<string, string> = {};
  for (const r of rows.slice(0, header)) if (r[0]?.trim() && r.length >= 2) meta[r[0].trim()] = (r[1] ?? "").trim();

  const cols = rows[header]!.map((h) => h.trim());
  const col = (r: string[], name: string) => (r[cols.indexOf(name)] ?? "").trim();
  const yes = (v: string) => /^(yes|true)$/i.test(v);

  const issues = rows
    .slice(header + 1)
    .filter((r) => r.some((c) => c.trim()))
    .map((r): BrowserStackIssue => {
      const severityLabel = col(r, "Severity");
      return {
        type: col(r, "Issue Type"),
        description: col(r, "Issue Description").replace(/\s*\n\s*/g, " "),
        wcag: criteriaFrom(col(r, "WCAG")),
        severity: SEVERITY[severityLabel.toLowerCase()] ?? "medium",
        severityLabel,
        elementClass: col(r, "Element ID"),
        scan: Number(col(r, "Scan Number")) || 1,
        index: Number(col(r, "Issue Index")) || 0,
        needsReview: yes(col(r, "Needs Review")),
        duplicate: yes(col(r, "Duplicate")),
        experimental: yes(col(r, "Experimental")),
        details: unwrap(parseJson(col(r, "Issue Details"))),
        howToFix: col(r, "How to Fix").replace(/\s+/g, " "),
        element: unwrap(mergeObjects(parseJson(col(r, "Element Properties")))),
        issueLink: col(r, "Issue Link") || undefined,
        docsLink: col(r, "Docs Link") || undefined,
      };
    });
  return { meta, issues };
}

/** "WCAG 2.2-1.3.4 AA" → 1.3.4. Only criteria the toolkit knows are kept. */
function criteriaFrom(value: string): WcagCriterion[] {
  const ids = [...value.matchAll(/\b(\d)\.(\d)\.(\d+)\b/g)].map((m) => `${m[1]}.${m[2]}.${m[3]}`);
  return [...new Set(ids)].map((id) => WCAG[id]).filter((c): c is WcagCriterion => Boolean(c));
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** Element Properties is a list of one-key objects; make it one object. */
function mergeObjects(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return Object.assign({}, ...value.filter((v) => v && typeof v === "object"));
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** BrowserStack double-encodes most values (`"\"16\""`, `"{\"x\":1}"`); decode one more level where it parses. */
function unwrap(obj: unknown): Record<string, unknown> {
  if (!obj || typeof obj !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = typeof v === "string" && /^["{[]/.test(v) ? (parseJson(v) ?? v) : v;
  return out;
}

/**
 * Which platform the scan ran on, from the device name and element classes.
 * Undefined when the export doesn't say (the importer asks).
 */
export function detectPlatform(report: BrowserStackReport): BrowserStackPlatform | undefined {
  const device = `${report.meta["Device"] ?? ""} ${report.meta["OS"] ?? ""} ${report.meta["Platform"] ?? ""}`;
  if (/\b(iphone|ipad|ios)\b/i.test(device)) return "ios";
  if (/\b(android|pixel|galaxy|samsung|oneplus|xiaomi|redmi|motorola|moto|oppo|vivo|nokia|huawei)\b/i.test(device)) return "android";
  const classes = report.issues.map((i) => i.elementClass);
  if (classes.some((c) => /^(android|androidx)\.|^com\.(facebook|google)\./.test(c))) return "android";
  if (classes.some((c) => /^UI[A-Z]/.test(c))) return "ios";
  return undefined;
}

/** Issues that apply to the whole app, not one screen (e.g. the orientation lock in Info.plist). */
export function isAppWideIssue(issue: BrowserStackIssue): boolean {
  return /orientation/i.test(issue.type) || issue.elementClass === "UIWindow";
}

/** What a tester would recognize the element by: its label, visible text, or test ID. */
export function elementLabel(issue: BrowserStackIssue): string | undefined {
  const e = issue.element;
  for (const key of ["accessibilityLabel", "visibleText", "text", "contentDescription", "content-desc", "identifier", "resource-id"]) {
    const v = e[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** The measured specifics, e.g. "#657483 on #EFF0F2 is 4.21:1" or "measures 16×16". */
function specifics(issue: BrowserStackIssue): string | undefined {
  const d = issue.details;
  const fg = d.detectedForegroundColor;
  const bg = d.detectedBackgroundColor;
  const ratio = d.calculatedColorContrast;
  if (typeof fg === "string" && typeof bg === "string") {
    const size = d.fontSize !== undefined ? ` at ${Number(d.fontSize)}pt` : "";
    return `${fg} on ${bg}${typeof ratio === "number" ? ` is ${ratio}:1` : ""}${size}`;
  }
  if (d.calculatedWidth !== undefined && d.calculatedHeight !== undefined) return `measures ${d.calculatedWidth}×${d.calculatedHeight}`;
  if (d.portrait === true && d.landscape === false) return "portrait only";
  if (d.landscape === true && d.portrait === false) return "landscape only";
  return undefined;
}

function categoryFor(type: string): string {
  if (/contrast/i.test(type)) return "Contrast";
  if (/touch|target/i.test(type)) return "Touch Targets";
  if (/orientation|clip|truncat|scal|text size|zoom/i.test(type)) return "Layout & Zoom";
  if (/image|icon/i.test(type)) return "Images/Icons";
  if (/label|name|form|input/i.test(type)) return "Screen Reader";
  if (/focus|keyboard/i.test(type)) return "Keyboard";
  return "Semantics";
}

const slug = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export interface BrowserStackFindingOptions {
  platform: BrowserStackPlatform;
  /** Screen name for each scan number; a scan with none is App-wide. */
  screens?: Record<number, string | undefined>;
  /** The CSV's file name, kept with each finding. */
  file?: string;
}

/** One finding per issue BrowserStack didn't mark as a duplicate. */
export function browserStackFindings(report: BrowserStackReport, options: BrowserStackFindingOptions): Finding[] {
  const reportLink = report.meta["Report Link"] || undefined;
  const device = report.meta["Device"] || undefined;
  return report.issues
    .filter((i) => !i.duplicate)
    .map((issue): Finding => {
      const label = elementLabel(issue);
      // Unmapped issues are app-wide; saying so keeps the element name from being read as a screen.
      const screen = (isAppWideIssue(issue) ? undefined : options.screens?.[issue.scan]) ?? "App-wide";
      const measured = specifics(issue);
      const subject = label ? `"${label}"` : issue.elementClass || "Element";
      const caveats = [
        issue.needsReview ? "BrowserStack flagged this one for review: confirm it on the device." : "",
        issue.experimental ? "Found by an experimental BrowserStack rule." : "",
      ].filter(Boolean);
      return {
        ruleId: `browserstack:${slug(issue.type)}`,
        title: `${issue.type}${label ? ` — ${label}` : ""}`,
        description: [`${subject}${measured ? `: ${measured}` : ""} (BrowserStack scan ${issue.scan}${device ? `, ${device}` : ""}).`, issue.description, ...caveats]
          .filter(Boolean)
          .join(" "),
        severity: issue.severity,
        wcag: issue.wcag,
        nodeId: label ?? (issue.elementClass || undefined),
        platforms: [options.platform],
        category: categoryFor(issue.type),
        source: "browserstack",
        remediation: [issue.howToFix, issue.docsLink ? `Rule details: ${issue.docsLink}` : ""].filter(Boolean).join(" "),
        evidence: {
          screen,
          report: reportLink,
          ...(options.file ? { csv: options.file } : {}),
          device,
          scan: issue.scan,
          issueIndex: issue.index,
          element: issue.elementClass,
          ...(typeof issue.element.identifier === "string" && issue.element.identifier ? { identifier: issue.element.identifier } : {}),
          details: issue.details,
          ...(issue.needsReview ? { needsReview: true } : {}),
          ...(issue.experimental ? { experimental: true } : {}),
          ...(issue.issueLink ? { issueLink: issue.issueLink } : {}),
        },
      };
    });
}

/** Per scan number: how many (non-duplicate) issues, and a few element names to recognize the screen by. */
export function scanSummaries(report: BrowserStackReport): Array<{ scan: number; issues: number; duplicates: number; elements: string[]; appWideOnly: boolean }> {
  const scans = [...new Set(report.issues.map((i) => i.scan))].sort((a, b) => a - b);
  return scans.map((scan) => {
    const all = report.issues.filter((i) => i.scan === scan);
    const elements = [...new Set(all.filter((i) => !isAppWideIssue(i)).map(elementLabel).filter((l): l is string => Boolean(l)))];
    return {
      scan,
      issues: all.filter((i) => !i.duplicate).length,
      duplicates: all.filter((i) => i.duplicate).length,
      elements,
      appWideOnly: all.every(isAppWideIssue),
    };
  });
}

/** The WCAG criteria the export has issues for. */
export function browserStackCriteria(report: BrowserStackReport): string[] {
  return [...new Set(report.issues.flatMap((i) => i.wcag.map((c) => c.id)))];
}
