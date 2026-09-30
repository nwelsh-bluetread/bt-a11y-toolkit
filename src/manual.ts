/**
 * Manual test checklist — generation & ingest.
 *
 * Closes the loop between the automated scan and the human pass:
 *
 *   1. {@link generateChecklistMarkdown} / {@link generateChecklistCsv} emit a
 *      matrix of the manual WCAG checks (rows) against the pages/screens under
 *      test (columns) for the auditor to fill in.
 *   2. {@link ingestChecklist} reads the filled-in matrix back into
 *      {@link Finding}s tagged `source: "manual"`, so manual results flow into
 *      the same {@link import("./integrations/combined.js").mergeAssessments},
 *      scorecard, trend history, and Jira export as the automated findings.
 *
 * The check catalogue below mirrors the tables in `docs/MANUAL_TESTING.md`. It
 * carries its own criterion metadata so it does not depend on the (curated)
 * WCAG catalogue being complete.
 */
import type { Finding, Platform, Severity, WcagCriterion, WcagLevel } from "./types.js";

/** A single manual check the auditor performs per page. */
export interface ManualCheck {
  /** Stable id used in rule ids and fingerprints, e.g. "sr-name-role-value". */
  id: string;
  /** The human-readable check, as shown in the checklist row. */
  label: string;
  /** WCAG success criteria this check verifies. */
  wcag: WcagCriterion[];
  /** The strictest level this check belongs to (drives level filtering). */
  level: WcagLevel;
  /** Severity assigned to a failure of this check. */
  severity: Severity;
  /** Short "how to test" guidance shown to the auditor. */
  howToTest: string;
  /** Whether this check concerns gesture/pointer operability. */
  gesture?: boolean;
}

function c(id: string, name: string, level: WcagLevel): WcagCriterion {
  return { id, name, level };
}

/**
 * The manual check catalogue, mirroring `docs/MANUAL_TESTING.md`. Ordered A →
 * AA → AAA; {@link manualChecksForLevel} filters cumulatively.
 */
export const MANUAL_CHECKS: ManualCheck[] = [
  // ---- Level A ----
  {
    id: "sr-name-role-value",
    label: "Screen reader announces name, role, and value",
    wcag: [c("4.1.2", "Name, Role, Value", "A")],
    level: "A",
    severity: "critical",
    howToTest: "VoiceOver / TalkBack / NVDA on every control",
  },
  {
    id: "reading-focus-order",
    label: "Reading & focus order is logical",
    wcag: [c("1.3.2", "Meaningful Sequence", "A"), c("2.4.3", "Focus Order", "A")],
    level: "A",
    severity: "high",
    howToTest: "Swipe/Tab through each screen; order matches visual flow",
  },
  {
    id: "keyboard-operable",
    label: "Everything operable by keyboard; no keyboard trap",
    wcag: [c("2.1.1", "Keyboard", "A"), c("2.1.2", "No Keyboard Trap", "A")],
    level: "A",
    severity: "critical",
    howToTest: "Keyboard-only pass (web); external keyboard (mobile)",
  },
  {
    id: "meaningful-alt-text",
    label: "Alt text is meaningful, not just present",
    wcag: [c("1.1.1", "Non-text Content", "A")],
    level: "A",
    severity: "high",
    howToTest: "Listen to how images/icons are announced",
  },
  {
    id: "not-color-alone",
    label: "Information not conveyed by color alone",
    wcag: [c("1.4.1", "Use of Color", "A")],
    level: "A",
    severity: "high",
    howToTest: "Check errors, required fields, statuses, chart series",
  },
  {
    id: "errors-described",
    label: "Errors are identified and described in text",
    wcag: [c("3.3.1", "Error Identification", "A")],
    level: "A",
    severity: "high",
    howToTest: "Trigger validation; confirm error is announced & associated",
  },
  {
    id: "input-labels",
    label: "Labels/instructions present for inputs",
    wcag: [c("3.3.2", "Labels or Instructions", "A")],
    level: "A",
    severity: "critical",
    howToTest: "Confirm each field has a spoken label",
  },
  {
    id: "media-captions",
    label: "Captions for prerecorded video/audio",
    wcag: [c("1.2.2", "Captions (Prerecorded)", "A")],
    level: "A",
    severity: "high",
    howToTest: "Play media; verify captions",
  },
  {
    id: "not-shape-position-sound",
    label: "Meaning doesn't rely on shape/position/sound alone",
    wcag: [c("1.3.3", "Sensory Characteristics", "A")],
    level: "A",
    severity: "medium",
    howToTest: '"Tap the round button" style instructions have text equivalents',
  },
  {
    id: "gesture-alternative",
    label: "Every gesture has a non-gesture (single-pointer) equivalent",
    wcag: [c("2.5.1", "Pointer Gestures", "A")],
    level: "A",
    severity: "high",
    howToTest: "Multipoint/path gestures (swipe, pinch, drag) have a simple tap/click path",
    gesture: true,
  },
  {
    id: "no-accidental-activation",
    label: "Actions don't fire on down-event; can be aborted",
    wcag: [c("2.5.2", "Pointer Cancellation", "A")],
    level: "A",
    severity: "medium",
    howToTest: "Press, drag off the control, release — action should not fire",
    gesture: true,
  },
  // ---- Level AA ----
  {
    id: "visible-focus",
    label: "Visible focus indicator on every control",
    wcag: [c("2.4.7", "Focus Visible", "AA")],
    level: "AA",
    severity: "high",
    howToTest: "Tab/navigate; confirm focus is always visible",
  },
  {
    id: "text-contrast",
    label: "Text contrast 4.5:1 (3:1 large); UI/graphics 3:1",
    wcag: [c("1.4.3", "Contrast (Minimum)", "AA"), c("1.4.11", "Non-text Contrast", "AA")],
    level: "AA",
    severity: "high",
    howToTest: "Check hover, focus, disabled, over images/gradients",
  },
  {
    id: "reflow-320",
    label: "Reflow at 320px width, no horizontal scroll",
    wcag: [c("1.4.10", "Reflow", "AA")],
    level: "AA",
    severity: "high",
    howToTest: "Zoom/narrow viewport; content stacks, nothing clipped",
  },
  {
    id: "resize-200",
    label: "Text resizes to 200% without loss",
    wcag: [c("1.4.4", "Resize Text", "AA")],
    level: "AA",
    severity: "medium",
    howToTest: "Increase system/browser text size",
  },
  {
    id: "text-spacing",
    label: "Text spacing overrides don't break layout",
    wcag: [c("1.4.12", "Text Spacing", "AA")],
    level: "AA",
    severity: "medium",
    howToTest: "Apply spacing bookmarklet / OS setting",
  },
  {
    id: "status-messages",
    label: "Status messages announced without stealing focus",
    wcag: [c("4.1.3", "Status Messages", "AA")],
    level: "AA",
    severity: "medium",
    howToTest: "Trigger toasts/loading/results; confirm polite announcement",
  },
  {
    id: "descriptive-headings-labels",
    label: "Headings & labels are descriptive",
    wcag: [c("2.4.6", "Headings and Labels", "AA")],
    level: "AA",
    severity: "medium",
    howToTest: "Review heading text and control labels for clarity",
  },
  {
    id: "orientation",
    label: "Orientation not locked (unless essential)",
    wcag: [c("1.3.4", "Orientation", "AA")],
    level: "AA",
    severity: "medium",
    howToTest: "Rotate device portrait ⇄ landscape",
  },
  {
    id: "touch-target-24",
    label: "Touch target minimum 24×24",
    wcag: [c("2.5.8", "Target Size (Minimum)", "AA")],
    level: "AA",
    severity: "medium",
    howToTest: "Measure rendered target; both dimensions ≥ 24px; adjacent controls don't misfire",
    gesture: true,
  },
  {
    id: "link-purpose",
    label: "Link/button purpose clear in context",
    wcag: [c("2.4.4", "Link Purpose (In Context)", "A")],
    level: "AA",
    severity: "medium",
    howToTest: '"Read more" etc. makes sense to a screen reader user',
  },
  {
    id: "consistent-nav",
    label: "Consistent navigation & identification",
    wcag: [c("3.2.3", "Consistent Navigation", "AA"), c("3.2.4", "Consistent Identification", "AA")],
    level: "AA",
    severity: "medium",
    howToTest: "Nav and components behave the same across screens",
  },
  {
    id: "error-suggestions",
    label: "Error suggestions provided when known",
    wcag: [c("3.3.3", "Error Suggestion", "AA")],
    level: "AA",
    severity: "medium",
    howToTest: "Validation tells the user how to fix it",
  },
  // ---- Level AAA ----
  {
    id: "enhanced-contrast",
    label: "Enhanced contrast 7:1 (4.5:1 large)",
    wcag: [c("1.4.6", "Contrast (Enhanced)", "AAA")],
    level: "AAA",
    severity: "medium",
    howToTest: "Re-measure text contrast to the higher bar",
  },
  {
    id: "touch-target-44",
    label: "Touch target 44×44 (enhanced)",
    wcag: [c("2.5.5", "Target Size (Enhanced)", "AAA")],
    level: "AAA",
    severity: "medium",
    howToTest: "Measure rendered size; both dimensions ≥ 44px",
    gesture: true,
  },
  {
    id: "motion-disableable",
    label: "Motion from interaction can be disabled",
    wcag: [c("2.3.3", "Animation from Interactions", "AAA")],
    level: "AAA",
    severity: "low",
    howToTest: "Respect reduced-motion; no unavoidable animation",
    gesture: true,
  },
  {
    id: "no-timing-loss",
    label: "No timing / re-authentication data loss",
    wcag: [c("2.2.3", "No Timing", "AAA"), c("2.2.5", "Re-authenticating", "AAA")],
    level: "AAA",
    severity: "medium",
    howToTest: "Remove or extend time limits",
  },
  {
    id: "context-help",
    label: "Context-sensitive help available",
    wcag: [c("3.3.5", "Help", "AAA")],
    level: "AAA",
    severity: "low",
    howToTest: "Help text/affordances present where needed",
  },
];

const LEVEL_RANK: Record<WcagLevel, number> = { A: 1, AA: 2, AAA: 3 };

/**
 * The manual checks relevant to a target level, cumulatively (AA includes A,
 * AAA includes A + AA) — matching how WCAG conformance stacks.
 */
export function manualChecksForLevel(level: WcagLevel): ManualCheck[] {
  return MANUAL_CHECKS.filter((check) => LEVEL_RANK[check.level] <= LEVEL_RANK[level]);
}

/** Options for generating a manual checklist matrix. */
export interface ChecklistOptions {
  /** The pages/screens under test — these become the matrix columns. */
  pages: string[];
  /** Target WCAG level. Defaults to "AA". */
  level?: WcagLevel;
  /**
   * Confirmed gestures/interactions in scope. When provided, a gesture
   * sub-table is appended reminding the auditor to verify each gesture per page.
   */
  gestures?: string[];
  /** Include the "How to test" column. Defaults to true. */
  includeHowToTest?: boolean;
}

/** Escape a cell value for a Markdown table (pipes break columns). */
function mdCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

/**
 * Render a manual test checklist as Markdown: manual checks down the rows, the
 * pages/screens across the columns, one empty cell per page to fill in with
 * `pass` / `fail` / `n/a`.
 */
export function generateChecklistMarkdown(options: ChecklistOptions): string {
  const level = options.level ?? "AA";
  const checks = manualChecksForLevel(level);
  const pages = options.pages;
  const includeHow = options.includeHowToTest ?? true;
  const lines: string[] = [];

  lines.push(`# Manual Accessibility Checklist`);
  lines.push("");
  lines.push(`- **Target WCAG level:** ${level}`);
  lines.push(`- **Pages/screens:** ${pages.length}`);
  lines.push("");
  lines.push(
    "Fill each cell with `pass`, `fail`, or `n/a`. Leave blank if not yet tested. " +
      "A `fail` becomes a finding when the completed file is ingested.",
  );
  lines.push("");

  const leadHeaders = includeHow
    ? ["Manual check", "WCAG", "How to test"]
    : ["Manual check", "WCAG"];
  const header = [...leadHeaders, ...pages.map(mdCell)];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);

  for (const check of checks) {
    const wcagIds = check.wcag.map((w) => w.id).join(" / ");
    const lead = includeHow
      ? [mdCell(check.label), wcagIds, mdCell(check.howToTest)]
      : [mdCell(check.label), wcagIds];
    const cells = pages.map(() => " ");
    lines.push(`| ${[...lead, ...cells].join(" | ")} |`);
  }
  lines.push("");

  if (options.gestures && options.gestures.length > 0) {
    lines.push(`## Gestures / interactions`);
    lines.push("");
    lines.push(
      "For each gesture, confirm a non-gesture equivalent exists and works per page " +
        "(WCAG 2.5.1). Fill with `pass` / `fail` / `n/a`.",
    );
    lines.push("");
    const gHeader = ["Gesture", ...pages.map(mdCell)];
    lines.push(`| ${gHeader.join(" | ")} |`);
    lines.push(`| ${gHeader.map(() => "---").join(" | ")} |`);
    for (const gesture of options.gestures) {
      const cells = pages.map(() => " ");
      lines.push(`| ${[mdCell(gesture), ...cells].join(" | ")} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Escape a CSV field. */
function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * Render the same checklist as CSV (spreadsheet-friendly). One row per check,
 * with `WCAG`, `Check`, `How to test`, then one column per page.
 */
export function generateChecklistCsv(options: ChecklistOptions): string {
  const level = options.level ?? "AA";
  const checks = manualChecksForLevel(level);
  const pages = options.pages;
  const rows: string[] = [];
  rows.push(["Check", "WCAG", "How to test", ...pages].map(csvField).join(","));
  for (const check of checks) {
    const wcagIds = check.wcag.map((w) => w.id).join(" / ");
    rows.push(
      [check.label, wcagIds, check.howToTest, ...pages.map(() => "")].map(csvField).join(","),
    );
  }
  return rows.join("\n");
}

/** How a single filled cell is interpreted. */
export type CellVerdict = "pass" | "fail" | "n/a" | "untested";

/** Normalize a raw cell string to a verdict. */
export function parseVerdict(raw: string): CellVerdict {
  const v = raw.trim().toLowerCase();
  if (v === "" || v === "-" || v === "—") return "untested";
  if (["fail", "failed", "x", "✗", "✕", "no", "n", "false"].includes(v)) return "fail";
  if (["pass", "passed", "✓", "✔", "yes", "y", "ok", "true"].includes(v)) return "pass";
  if (["n/a", "na", "n.a.", "not applicable", "skip"].includes(v)) return "n/a";
  // Anything else non-empty is treated as a note that implies a fail so the
  // auditor's comment is not silently dropped.
  return "fail";
}

/** Split a Markdown table row into trimmed cells. */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.replace(/\\\|/g, "|").trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, "")));
}

/** Look up a manual check by its label or a contained WCAG id. */
function matchCheck(label: string, wcag: string): ManualCheck | undefined {
  const normalizedLabel = label.replace(/\*\*/g, "").trim().toLowerCase();
  const byLabel = MANUAL_CHECKS.find(
    (check) => check.label.toLowerCase() === normalizedLabel,
  );
  if (byLabel) return byLabel;
  // Fall back to the first WCAG id in the cell.
  const firstId = /(\d+\.\d+\.\d+)/.exec(wcag)?.[1];
  if (firstId) {
    return MANUAL_CHECKS.find((check) => check.wcag.some((w) => w.id === firstId));
  }
  return undefined;
}

/** The tally and findings produced from a completed checklist. */
export interface IngestResult {
  findings: Finding[];
  counts: Record<CellVerdict, number>;
  /** `page -> verdict counts`, useful for a per-page coverage summary. */
  byPage: Record<string, Record<CellVerdict, number>>;
}

function emptyCounts(): Record<CellVerdict, number> {
  return { pass: 0, fail: 0, "n/a": 0, untested: 0 };
}

/**
 * Parse a completed Markdown checklist (as produced by
 * {@link generateChecklistMarkdown}) back into {@link Finding}s.
 *
 * Every `fail` cell becomes a finding tagged `source: "manual"`, with the page
 * as `evidence.page` and the mapped WCAG criteria, so it merges and trends
 * exactly like an automated finding. Pass / n/a / untested cells are tallied for
 * a coverage summary but produce no findings.
 */
export function ingestChecklist(
  markdown: string,
  options: { platform?: Platform } = {},
): IngestResult {
  const platform = options.platform ?? "web";
  const lines = markdown.split("\n");
  const findings: Finding[] = [];
  const counts = emptyCounts();
  const byPage: Record<string, Record<CellVerdict, number>> = {};

  // Track the active table's page columns; reset when a new header is seen.
  let pageColumns: { name: string; index: number }[] = [];
  let leadCount = 0;
  let inGestureTable = false;

  for (const line of lines) {
    if (!line.trim().startsWith("|")) {
      // A non-table line ends the current table context.
      pageColumns = [];
      continue;
    }
    const cells = splitRow(line);
    if (isSeparatorRow(cells)) continue;

    const lower = cells.map((h) => h.toLowerCase());
    const isCheckHeader = lower[0] === "manual check" && lower.includes("wcag");
    const isGestureHeader = lower[0] === "gesture";

    if (isCheckHeader || isGestureHeader) {
      inGestureTable = isGestureHeader;
      // Lead columns are everything up to the first page column. For the check
      // table that's "Manual check", "WCAG", optionally "How to test".
      leadCount = isGestureHeader
        ? 1
        : lower.includes("how to test")
          ? 3
          : 2;
      pageColumns = cells
        .slice(leadCount)
        .map((name, i) => ({ name, index: leadCount + i }));
      continue;
    }

    if (pageColumns.length === 0) continue; // A table we don't recognize.

    const label = cells[0] ?? "";
    const wcagCell = inGestureTable ? "" : cells[1] ?? "";
    const check = inGestureTable ? undefined : matchCheck(label, wcagCell);

    for (const col of pageColumns) {
      const verdict = parseVerdict(cells[col.index] ?? "");
      counts[verdict]++;
      const pageCounts = byPage[col.name] ?? emptyCounts();
      pageCounts[verdict]++;
      byPage[col.name] = pageCounts;

      if (verdict !== "fail") continue;

      if (inGestureTable) {
        findings.push({
          ruleId: `manual:gesture:${slug(label)}`,
          title: `Gesture not accessible: ${label}`,
          description: `The "${label}" gesture has no accessible (single-pointer) alternative on ${col.name}.`,
          severity: "high",
          wcag: [c("2.5.1", "Pointer Gestures", "A")],
          source: "manual",
          category: "Keyboard",
          platforms: [platform],
          evidence: { page: col.name, gesture: label, verdict },
        });
        continue;
      }

      if (!check) continue; // Unknown check row; skip rather than guess.
      findings.push({
        ruleId: `manual:${check.id}`,
        title: check.label,
        description: `Manual check failed on ${col.name}: ${check.howToTest}`,
        severity: check.severity,
        wcag: check.wcag,
        source: "manual",
        category: categoryForCheck(check),
        platforms: [platform],
        remediation: check.howToTest,
        evidence: { page: col.name, check: check.id, verdict },
      });
    }
  }

  return { findings, counts, byPage };
}

/** Best-effort scorecard category for a manual check, aligned with the engines. */
function categoryForCheck(check: ManualCheck): string {
  const id = check.wcag[0]?.id ?? "";
  if (id.startsWith("1.4")) return "Contrast";
  if (id.startsWith("1.1") || id.startsWith("1.2")) return "Images/Icons";
  if (id.startsWith("2.1") || id.startsWith("2.5")) return "Keyboard";
  if (id.startsWith("2.4")) return "Navigation";
  if (id.startsWith("3.3")) return "Forms";
  if (id.startsWith("4.1")) return "Screen Reader";
  return "Semantics";
}

/** Turn a label into a slug for a rule id. */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
