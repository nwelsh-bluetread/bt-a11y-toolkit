/**
 * The manual checklist as a Markdown file testers fill in.
 *
 *   plan    which checks go on which screen (tailored to what each screen contains)
 *   render  write a11y-audit/checklist.md, carrying over answers from a previous file
 *   parse   read a filled-in file back into results and findings
 *
 * It's organized to minimize switching tools: platform → testing pass (screen
 * reader, keyboard, visual, …) → check → the screens to test it on. Testers set
 * up once per pass (e.g. turn VoiceOver on) and work down every screen.
 *
 *   # iOS
 *   ## 1. Screen reader
 *   > Setup: Turn on VoiceOver …
 *   ### Every input has a label or instructions · 3.3.2 · `input-labels`
 *   How to test: …
 *   - [x] Login                                          ← pass
 *   - [!] Signup: Email field reads "edit box" (high)    ← fail + issue (+ optional severity)
 *     - Password field has no label too (medium)        ← more issues on the same screen
 *   - [-] Settings                                       ← not applicable
 *   - [ ] App-wide                                       ← not checked yet
 *
 * The parser also reads the earlier screen-first layout ("## Screen: Login" with
 * "- [x] iOS" lines), so older files keep their answers when regenerated.
 */
import {
  checklistFor,
  howToFor,
  MANUAL_CHECKLIST,
  modeSetup,
  TEST_MODES,
  type AuditTarget,
  type ChecklistItem,
  type ScreenFeature,
} from "../checklist.js";
import { FEATURE_LABEL, type ScreenInfo } from "../code-scan/screens.js";
import type { Finding, Severity, WcagLevel } from "../types.js";
import { WCAG } from "../wcag.js";
import type { AutomatedRun } from "./session.js";

export type CheckStatus = "pass" | "fail" | "na" | "open";

export interface PlannedCheck {
  item: ChecklistItem;
  /** App-wide copy of a feature-specific check that no screen was detected to need. */
  ifPresent?: ScreenFeature[];
}

export interface PlannedSection {
  /** Heading text, e.g. "Screen: Login" or "App-wide (check once)". Also the key for carrying answers over. */
  heading: string;
  screen?: ScreenInfo;
  checks: PlannedCheck[];
}

export interface PlannedGroup {
  kind: "mobile" | "web";
  title: string;
  targets: AuditTarget[];
  sections: PlannedSection[];
}

const TARGET_LABEL: Record<AuditTarget, string> = { web: "Web", ios: "iOS", android: "Android" };
const LABEL_TARGET: Record<string, AuditTarget> = { web: "web", ios: "ios", android: "android" };
export const APP_WIDE = "App-wide (check once)";

export function screenHeading(screen: ScreenInfo): string {
  return `${screen.kind === "web" ? "Page" : "Screen"}: ${screen.name}`;
}

/** Decide which checks go on each screen and which are done once app-wide. */
export function planChecklist(screens: ScreenInfo[], targets: AuditTarget[], level: WcagLevel): PlannedGroup[] {
  const groups: PlannedGroup[] = [];
  const mobileTargets = targets.filter((t) => t !== "web");
  const kinds: Array<{ kind: "mobile" | "web"; targets: AuditTarget[]; title: string }> = [];
  if (mobileTargets.length) kinds.push({ kind: "mobile", targets: mobileTargets, title: `Mobile app — ${mobileTargets.map((t) => TARGET_LABEL[t]).join(" + ")}` });
  if (targets.includes("web")) kinds.push({ kind: "web", targets: ["web"], title: "Website" });

  for (const { kind, targets: groupTargets, title } of kinds) {
    const items = checklistFor(groupTargets[0]!, level);
    const groupScreens = screens.filter((s) => s.kind === kind);
    const has = (s: ScreenInfo, features: ScreenFeature[]) => features.some((f) => s.features?.includes(f));

    const sections: PlannedSection[] = groupScreens.map((screen) => ({
      heading: screenHeading(screen),
      screen,
      checks: items.filter((i) => i.scope === "screen" && (!i.when || has(screen, i.when))).map((item) => ({ item })),
    }));

    const appWide: PlannedCheck[] = [];
    for (const item of items) {
      if (item.scope === "app") appWide.push({ item });
      else if (item.when && !groupScreens.some((s) => has(s, item.when!))) appWide.push({ item, ifPresent: item.when });
    }
    sections.push({ heading: APP_WIDE, checks: appWide });
    groups.push({ kind, title, targets: groupTargets, sections });
  }
  return groups;
}

// ── Render ───────────────────────────────────────────────────────────────────

export interface RenderInput {
  projectName: string;
  targetLevel: WcagLevel;
  groups: PlannedGroup[];
  runs: AutomatedRun[];
  /** A previously parsed checklist whose answers should be kept. */
  previous?: ParsedChecklist;
  /** Context docs saved with the audit (paths relative to the audit folder). */
  contextFiles?: string[];
}

const TARGET_TITLE: Record<AuditTarget, string> = { web: "Website", ios: "iOS", android: "Android" };
const APP_WIDE_LABEL = "App-wide";

export function renderChecklist({ projectName, targetLevel, groups, runs, previous, contextFiles }: RenderInput): string {
  const kept = new Map<string, ChecklistRow>();
  for (const row of previous?.rows ?? []) kept.set(answerKey(row.target, row.itemId, row.screen), row);

  const out: string[] = [];
  out.push(`# Accessibility checklist — ${projectName}`);
  out.push("");
  out.push(`WCAG ${targetLevel} · generated by bt-a11y on ${new Date().toISOString().slice(0, 10)}`);
  out.push("");
  out.push(
    "**How it's organized.** One part per platform, then one section per testing pass (screen reader, keyboard, visual…). Do the setup at the top of a section once, then work down its checks: each check lists the screens to test it on.",
  );
  out.push("");
  out.push("- `[x]` pass · `[!]` fail · `[-]` not applicable · `[ ]` not checked yet");
  out.push('- For a failure, describe it after the screen name, with an optional severity: `- [!] Login: Email field is read as "text field" (high)`');
  out.push("- Put more issues on the same screen on indented lines below it: `  - Password field has no label either (medium)`");
  out.push("- To narrow a failure to specific criteria, add them in brackets: `[2.5.1]`. Add a screenshot path anywhere in the text.");
  out.push("");
  out.push(
    "⚑ lines are what the automated scans found or flagged. Where a scan found an issue, the line starts as `[!]` — that finding is already in the report, so leave it as is (or add your own notes after the screen name). `⚑ Verify:` lines are things to check by hand. When you're done, run **`npx bt-a11y report`**.",
  );
  if (contextFiles?.length) {
    out.push("");
    out.push(`**Context:** ${contextFiles.map((f) => `[${f}](${f})`).join(", ")}. Use it to find each screen; deep links and "reached from" below come from it.`);
  }
  out.push(...screenIndex(groups, runs));

  for (const group of groups) {
    const allScreens = group.sections.flatMap((s) => (s.screen ? [s.screen] : []));
    const order = new Map(MANUAL_CHECKLIST.map((i, n) => [i.id, n]));
    // Every check used anywhere in this group, with the sections (screens / app-wide) it's done on.
    const checks = new Map<string, { item: ChecklistItem; on: Array<{ section: PlannedSection; ifPresent?: ScreenFeature[] }> }>();
    for (const section of group.sections) {
      for (const { item, ifPresent } of section.checks) {
        const entry = checks.get(item.id) ?? { item, on: [] };
        entry.on.push({ section, ifPresent });
        checks.set(item.id, entry);
      }
    }
    const sorted = [...checks.values()].sort((a, b) => order.get(a.item.id)! - order.get(b.item.id)!);

    for (const target of group.targets) {
      out.push("");
      out.push(`# ${TARGET_TITLE[target]}`);
      if (target !== "web") {
        out.push("");
        out.push(
          `> Optional: before starting, run ${target === "ios" ? "Accessibility Inspector" : "Accessibility Scanner"} on each screen and log real issues under the matching check.`,
        );
      }
      let n = 0;
      for (const mode of TEST_MODES) {
        const inMode = sorted.filter((c) => c.item.mode === mode.id);
        if (inMode.length === 0) continue;
        out.push("");
        out.push(`## ${++n}. ${mode.title}`);
        out.push("");
        out.push(`> Setup: ${modeSetup(mode.id, target)}`);
        for (const { item, on } of inMode) {
          const ifPresent = on.find((o) => o.ifPresent)?.ifPresent;
          const note = ifPresent ? ` *(no ${ifPresent.map((f) => FEATURE_LABEL[f]).join("/")} found in code — mark N/A if the app has none)*` : "";
          out.push("");
          out.push(`### ${item.title} · ${item.wcag.join(", ")} · \`${item.id}\`${note}`);
          out.push("");
          out.push(`How to test: ${howToFor(item, target)}`);
          out.push("");
          for (const { section } of on) {
            const screen = section.screen?.name;
            const row = kept.get(answerKey(target, item.id, screen));
            const notes = scanNotes(item, section, runs, allScreens, [target]);
            // A scan finding here means the check already fails on this screen: start it as [!].
            const scanFailed = notes.some((n) => !n.startsWith(VERIFY_NOTE));
            out.push(...(row ? serializeRow(row, screen ?? APP_WIDE_LABEL) : [`- [${scanFailed ? "!" : " "}] ${screen ?? APP_WIDE_LABEL}`]));
            for (const note of notes) out.push(`  ${note}`);
          }
        }
      }
    }
  }

  out.push("");
  out.push("# Other findings");
  out.push("");
  out.push("Issues that don't fit a check above — one per line: `- [!] platforms · screen · WCAG · description (severity)`");
  out.push("");
  out.push("<!-- Example: - [!] iOS, Android · Login · 1.4.3 · Disabled button text is unreadable (medium) -->");
  if (previous?.otherRaw.trim()) {
    out.push("");
    out.push(previous.otherRaw.trimEnd());
  }
  out.push("");
  return out.join("\n");
}

/** Write a parsed answer back as checklist lines under a (possibly new) label. */
function serializeRow(row: ChecklistRow, label: string): string[] {
  const mark = { pass: "x", fail: "!", na: "-", open: " " }[row.status];
  const text = (i: ChecklistIssue) => `${i.text}${i.wcag?.length ? ` [${i.wcag.join(", ")}]` : ""}${i.severity ? ` (${i.severity})` : ""}`.trim();
  const [first, ...rest] = row.issues;
  return [`- [${mark}] ${label}${first ? `: ${text(first)}` : ""}`, ...rest.map((i) => `  - ${text(i)}`)];
}

function answerKey(target: AuditTarget, itemId: string, screen: string | undefined): string {
  return `${target}|${itemId}|${screen ?? ""}`;
}

/** The screens in scope, grouped, with where to find each one and what the scans found there. */
function screenIndex(groups: PlannedGroup[], runs: AutomatedRun[]): string[] {
  const lines: string[] = [];
  for (const group of groups) {
    const sections = group.sections.filter((s) => s.screen);
    if (sections.length === 0) continue;
    const allScreens = sections.map((s) => s.screen!);
    lines.push("", `## ${group.kind === "web" ? "Pages" : "Screens"} in scope (${sections.length})`);
    let current: string | undefined;
    for (const section of sections) {
      const s = section.screen!;
      if (s.group && s.group !== current) {
        lines.push("", `**${s.group}**`, "");
        current = s.group;
      } else if (!current && section === sections[0]) {
        lines.push("");
      }
      const meta = sectionMeta(section, runs, allScreens);
      lines.push(`- **${s.name}**${meta ? ` — ${meta}` : ""}`);
      for (const note of unmatchedFindings(section, runs, allScreens, group.targets)) lines.push(`  - ${note} *(no check covers this)*`);
    }
  }
  return lines;
}

function sectionMeta(section: PlannedSection, runs: AutomatedRun[], screens: ScreenInfo[]): string | undefined {
  const s = section.screen;
  const parts: string[] = [];
  if (s?.deepLink) parts.push(`deep link \`${s.deepLink}\``);
  if (s?.reachedFrom?.length) parts.push(`reached from: ${s.reachedFrom.slice(0, 4).join(", ")}${s.reachedFrom.length > 4 ? ", …" : ""}`);
  if (s?.file) parts.push(`\`${s.file}\``);
  if (s?.url) parts.push(s.url);
  if (s?.features?.length) parts.push(`contains: ${s.features.map((f) => FEATURE_LABEL[f]).join(", ")}`);
  const findings = runs.flatMap((r) => r.findings).filter((f) => findingOnSection(f, section, screens));
  if (findings.length) parts.push(`⚑ ${findings.length} automated finding${findings.length === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : undefined;
}

/** Whether an automated finding belongs to a section (a screen that renders its file / its page, or app-wide). */
export function findingOnSection(f: Finding, section: PlannedSection, screens: ScreenInfo[]): boolean {
  const file = typeof f.evidence?.file === "string" ? f.evidence.file : undefined;
  const page = typeof f.evidence?.page === "string" ? f.evidence.page : undefined;
  if (section.screen) {
    if (section.screen.kind === "web") return Boolean(page && page === section.screen.url);
    return Boolean(file && section.screen.files?.includes(file));
  }
  // App-wide: findings no screen claims.
  if (file) return !screens.some((s) => s.files?.includes(file));
  if (page) return !screens.some((s) => s.url === page);
  return true;
}

/** Findings on a section whose criteria none of its checks cover — listed so nothing goes missing. */
function unmatchedFindings(section: PlannedSection, runs: AutomatedRun[], screens: ScreenInfo[], targets: AuditTarget[]): string[] {
  const covered = new Set(section.checks.flatMap((c) => c.item.wcag));
  const lines: string[] = [];
  for (const run of runs) {
    if (!run.targets.some((t) => targets.includes(t))) continue;
    for (const f of run.findings) {
      if (!findingOnSection(f, section, screens) || f.wcag.some((c) => covered.has(c.id))) continue;
      lines.push(`⚑ ${run.tool}: ${f.title.split(" — ")[0]}${locationOf(f)} — ${f.wcag.map((c) => c.id).join(", ") || "no WCAG mapping"}`);
    }
  }
  return lines;
}

function locationOf(f: Finding): string {
  const file = typeof f.evidence?.file === "string" ? f.evidence.file : undefined;
  const lineNos = Array.isArray(f.evidence?.lines) ? (f.evidence.lines as number[]) : [];
  const page = typeof f.evidence?.page === "string" ? f.evidence.page : undefined;
  const loc = file ? `${file}${lineNos.length ? `:${lineNos.slice(0, 8).join(", ")}` : ""}` : (page ?? f.nodeId);
  return loc ? ` (${loc})` : "";
}

/** Prefix for "check this by hand" notes, as opposed to ⚑ lines for actual scan findings. */
const VERIFY_NOTE = "⚑ Verify:";

function scanNotes(item: ChecklistItem, section: PlannedSection, runs: AutomatedRun[], screens: ScreenInfo[], targets: AuditTarget[]): string[] {
  const lines: string[] = [];
  for (const run of runs) {
    if (!run.targets.some((t) => targets.includes(t))) continue;
    const found = run.findings.filter((f) => f.wcag.some((c) => item.wcag.includes(c.id)) && findingOnSection(f, section, screens));
    for (const f of found.slice(0, 5)) {
      lines.push(`⚑ ${run.tool}: ${f.title.split(" — ")[0]}${locationOf(f)}`);
    }
    if (found.length > 5) lines.push(`⚑ ${run.tool}: …and ${found.length - 5} more (see report)`);

    for (const sig of run.signals ?? []) {
      if (!sig.criteria.some((c) => item.wcag.includes(c))) continue;
      const locs = section.screen
        ? sig.locations.filter((l) => section.screen!.files?.includes(l.file))
        : sig.locations.filter((l) => !screens.some((s) => s.files?.includes(l.file)));
      if (section.screen && locs.length === 0) continue;
      if (!section.screen && sig.locations.length > 0 && locs.length === 0) continue;
      const where = locs.slice(0, 3).map((l) => `${l.file}:${l.line}`).join(", ");
      lines.push(`${VERIFY_NOTE} ${sig.message}${where ? ` (${where}${locs.length > 3 ? ", …" : ""})` : ""}`);
    }
  }
  return lines;
}

// ── Parse ────────────────────────────────────────────────────────────────────

export interface ChecklistIssue {
  text: string;
  severity?: Severity;
  /** Criteria the tester narrowed the issue to with [x.y.z]. */
  wcag?: string[];
}

export interface ChecklistRow {
  group: "mobile" | "web";
  /** Section heading: a testing pass ("1. Screen reader"), or a screen in the earlier layout ("Screen: Login"). */
  section: string;
  /** Screen/page name, or undefined for app-wide checks. */
  screen?: string;
  itemId: string;
  target: AuditTarget;
  status: CheckStatus;
  issues: ChecklistIssue[];
  /** The raw lines, so answers survive regenerating the file. */
  lines: string[];
  /** An automated scan found an issue for this check on this screen (a ⚑ line under it). */
  flagged?: boolean;
}

export interface OtherFinding extends ChecklistIssue {
  platforms: AuditTarget[];
  screen?: string;
}

export interface ParsedChecklist {
  rows: ChecklistRow[];
  other: OtherFinding[];
  /** Raw text of the "Other findings" section below the instructions, kept on regenerate. */
  otherRaw: string;
  warnings: string[];
}

export function emptyChecklist(): ParsedChecklist {
  return { rows: [], other: [], otherRaw: "", warnings: [] };
}

export function parseChecklist(md: string): ParsedChecklist {
  const result = emptyChecklist();
  let group: "mobile" | "web" | "other" | undefined;
  /** The platform of the current "# iOS" / "# Android" / "# Website" part (new layout). */
  let partTarget: AuditTarget | undefined;
  let section = "";
  let itemId: string | undefined;
  let lastRow: ChecklistRow | undefined;
  let inComment = false;
  const otherLines: string[] = [];
  let otherIntroDone = false;

  md.split(/\r?\n/).forEach((line, index) => {
    const lineNo = index + 1;
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      return;
    }
    if (line.trim().startsWith("<!--")) {
      if (!line.includes("-->")) inComment = true;
      return;
    }

    if (/^# /.test(line)) {
      partTarget = /^# iOS\b/.test(line) ? "ios" : /^# Android\b/.test(line) ? "android" : /^# Website\b/.test(line) ? "web" : undefined;
      group = /^# (Mobile app|iOS|Android)\b/.test(line) ? "mobile" : /^# Website/.test(line) ? "web" : /^# Other findings/.test(line) ? "other" : undefined;
      section = "";
      itemId = undefined;
      lastRow = undefined;
      return;
    }

    if (group === "other") {
      if (!otherIntroDone) {
        if (/^- /.test(line)) otherIntroDone = true;
        else return;
      }
      otherLines.push(line);
      const m = /^- (?:\[(.)\]\s*)?(.+)$/.exec(line);
      if (m) {
        const other = parseOther(m[2]!);
        if (other) result.other.push(other);
        else result.warnings.push(`Line ${lineNo}: couldn't read this "Other findings" line — use "platforms · screen · WCAG · description (severity)".`);
      }
      return;
    }
    if (!group) return;

    const h2 = /^## (.+)$/.exec(line);
    if (h2) {
      section = h2[1]!.trim();
      itemId = undefined;
      lastRow = undefined;
      return;
    }
    const h3 = /^### .*`([a-z0-9-]+)`/.exec(line);
    if (h3) {
      itemId = h3[1];
      lastRow = undefined;
      return;
    }
    if (!itemId) return;

    const mark = /^- \[(.)\]\s*(.+)$/.exec(line);
    if (mark) {
      // Earlier layout: sections are screens and lines are platforms ("## Screen: Login" / "- [x] iOS").
      const legacy = /^(Screen|Page):\s/.test(section) || section === APP_WIDE;
      let target: AuditTarget | undefined;
      let screen: string | undefined;
      let rest: string;
      if (legacy) {
        const m = /^(iOS|Android|Web)\b\s*[:—–-]?\s*(.*)$/i.exec(mark[2]!);
        if (!m) return;
        target = LABEL_TARGET[m[1]!.toLowerCase()];
        screen = section === APP_WIDE ? undefined : section.replace(/^(Screen|Page):\s*/, "");
        rest = m[2]!;
      } else {
        if (!partTarget) return;
        target = partTarget;
        const sep = mark[2]!.indexOf(": ");
        const label = (sep >= 0 ? mark[2]!.slice(0, sep) : mark[2]!).trim();
        screen = label === APP_WIDE_LABEL ? undefined : label;
        rest = sep >= 0 ? mark[2]!.slice(sep + 2) : "";
      }
      const status = statusFor(mark[1]!);
      if (!status) result.warnings.push(`Line ${lineNo}: unknown mark "[${mark[1]}]" — use [x], [!], [-], or [ ].`);
      lastRow = {
        group,
        section,
        screen,
        itemId,
        target: target!,
        status: status ?? "open",
        issues: rest.trim() ? [parseIssue(rest.trim())] : [],
        lines: [line],
      };
      result.rows.push(lastRow);
      return;
    }

    if (lastRow && /^\s{2,}⚑ /.test(line)) {
      if (!line.trim().startsWith(VERIFY_NOTE)) lastRow.flagged = true;
      return;
    }
    const extra = /^\s{2,}- (.+)$/.exec(line);
    if (extra && lastRow) {
      lastRow.issues.push(parseIssue(extra[1]!.trim()));
      lastRow.lines.push(line);
    }
  });

  for (const row of result.rows) {
    if (row.issues.length > 0 && row.status === "open") row.status = "fail";
    if (row.issues.length > 0 && row.status !== "fail") {
      result.warnings.push(`${TARGET_LABEL[row.target]} › ${row.screen ?? APP_WIDE_LABEL} › ${row.itemId}: has issue text but isn't marked [!] — ignoring the text.`);
      row.issues = [];
    }
  }
  const contradictions = result.rows.filter((r) => r.status === "pass" && r.flagged);
  if (contradictions.length) {
    const list = contradictions.slice(0, 8).map((r) => `${TARGET_LABEL[r.target]} › ${r.screen ?? APP_WIDE_LABEL} › ${r.itemId}`);
    result.warnings.push(
      `${contradictions.length} line(s) are marked [x] pass, but an automated scan found an issue there (⚑), so the scan finding still counts against them: ${list.join("; ")}${contradictions.length > 8 ? "; …" : ""}. Change them to [!] unless you've confirmed the scan is wrong.`,
    );
  }
  result.otherRaw = otherLines.join("\n");
  return result;
}

function statusFor(mark: string): CheckStatus | undefined {
  if (mark === "x" || mark === "X") return "pass";
  if (mark === "!") return "fail";
  if (mark === "-") return "na";
  if (mark === " ") return "open";
  return undefined;
}

function parseIssue(text: string): ChecklistIssue {
  const issue: ChecklistIssue = { text };
  const sev = /\((critical|high|medium|low)\)\s*$/i.exec(text);
  if (sev) {
    issue.severity = sev[1]!.toLowerCase() as Severity;
    issue.text = text.slice(0, sev.index).trim();
  }
  const crit = /\[(\d+\.\d+\.\d+(?:\s*,\s*\d+\.\d+\.\d+)*)\]/.exec(issue.text);
  if (crit) {
    issue.wcag = crit[1]!.split(/\s*,\s*/).filter((id) => WCAG[id]);
    issue.text = issue.text.replace(crit[0], "").replace(/\s{2,}/g, " ").trim();
  }
  return issue;
}

function parseOther(body: string): OtherFinding | undefined {
  const parts = body.split(/\s+·\s+/);
  if (parts.length < 2) return undefined;
  const platforms = parts[0]!
    .split(/\s*,\s*/)
    .map((p) => LABEL_TARGET[p.trim().toLowerCase()])
    .filter((t): t is AuditTarget => Boolean(t));
  if (platforms.length === 0) return undefined;
  const issue = parseIssue(parts[parts.length - 1]!);
  const other: OtherFinding = { ...issue, platforms };
  for (const part of parts.slice(1, -1)) {
    if (/^\d+\.\d+\.\d+(\s*,\s*\d+\.\d+\.\d+)*$/.test(part.trim())) {
      other.wcag = part.split(/\s*,\s*/).map((s) => s.trim()).filter((id) => WCAG[id]);
    } else {
      other.screen = part.trim();
    }
  }
  return other;
}

