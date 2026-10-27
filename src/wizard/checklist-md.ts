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
 *     Note: only on the second visit                    ← a note: kept, not counted as an issue
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
  passSetup,
  TEST_MODES,
  TEST_PASSES,
  type AuditTarget,
  type ChecklistItem,
  type ScreenFeature,
} from "../checklist.js";
import { FEATURE_LABEL, type ScreenInfo } from "../code-scan/screens.js";
import type { Finding, Severity, WcagLevel } from "../types.js";
import { WCAG } from "../wcag.js";
import type { AutomatedRun } from "./session.js";
import { sharedComponents, sharedComponentsChecklistLines } from "./shared-components.js";

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
  const marks = new Map((previous?.screenMarks ?? []).map((m) => [`${m.target}|${m.screen ?? ""}`, m]));

  const out: string[] = [];
  out.push(`# Accessibility checklist — ${projectName}`);
  out.push("");
  out.push(`WCAG ${targetLevel} · generated by bt-a11y on ${new Date().toISOString().slice(0, 10)}`);
  out.push("");
  out.push(
    "**How it's organized.** One part per platform (iOS, then Android). Do the setup at the top once, read the list of checks, then go **screen by screen**: on each screen, do every check, grouped by tool in this order — screen reader, voice & switch control, visual, touch, cognitive, media, keyboard — then move to the next screen.",
  );
  out.push("");
  out.push("- `[x]` pass · `[!]` fail · `[-]` not applicable · `[ ]` not checked yet");
  out.push('- For a failure, describe it after the check, with an optional severity (Low if you leave it out): ``- [!] **1.6** Every input has a label… · `input-labels`: Email field is read as "text field" (high)``');
  out.push("- Put more issues for the same check on indented lines below it: `  - Password field has no label either (medium)`");
  out.push("- For a note that isn't an issue, indent it and start with `Note:` (`  Note: only happens on the second visit`). Notes are kept but not counted.");
  out.push("- To narrow a failure to specific criteria, add them in brackets: `[2.5.1]`. Add a screenshot path anywhere in the text.");
  out.push("- Can't reach a screen? Add `> **Blocked:** why` under its heading. It's listed under Blocked screens in the report. For other notes about a screen, add `> **Note:** …` (don't rename the heading: answers are matched to screens by it).");
  out.push("");
  out.push(
    `⚑ lines are what the automated scans found or flagged. Their severity (High, Medium, …) is fixed per scan rule, not judged for this screen; see "How severity is decided" in report.md. Where a scan found an issue, the line starts as \`[!] … ${UNREVIEWED_HINT}\` — the scan's finding is already in the report, but **the screen still needs testing**: the scan only sees what's literally in the code. Test the rest of the screen, add anything else you find after a colon, then **delete "${UNREVIEWED_HINT}"**. \`⚑ Verify\` lines are things to check by hand. Full details of every scan finding (all files, why it matters, how to fix) are in [scan-details.md](scan-details.md). When you're done, run **\`npx bt-a11y report\`**.`,
  );
  if (contextFiles?.length) {
    out.push("");
    out.push(`**Context:** ${contextFiles.map((f) => `[${f}](${f})`).join(", ")}. Use it to find each screen; deep links and "reached from" below come from it.`);
  }
  out.push(...screenIndex(groups, runs));
  const mobileScreens = groups.filter((g) => g.kind === "mobile").flatMap((g) => g.sections.flatMap((s) => (s.screen ? [s.screen] : [])));
  out.push(...sharedComponentsChecklistLines(sharedComponents(mobileScreens, runs.flatMap((r) => r.findings))));

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
      for (const testPass of TEST_PASSES) {
        // Checks in this pass, ordered by type (screen reader first, …) then by the master list.
        const modeRank = new Map(testPass.modes.map((m, i) => [m, i]));
        const inPass = sorted
          .filter((c) => modeRank.has(c.item.mode))
          .sort((a, b) => modeRank.get(a.item.mode)! - modeRank.get(b.item.mode)! || order.get(a.item.id)! - order.get(b.item.id)!);
        if (inPass.length === 0) continue;
        const pass = ++n;
        // Checks are labeled by the WCAG success criteria they cover, e.g. "1.3.2, 2.4.3".
        const number = new Map(inPass.map((c) => [c.item.id, c.item.wcag.join(", ")]));
        // In the pass's order (keyboard last), not the master list's.
        const modesHere = testPass.modes
          .map((id) => TEST_MODES.find((m) => m.id === id)!)
          .filter((m) => inPass.some((c) => c.item.mode === m.id));
        const subheadings = modesHere.length > 1;
        out.push("");
        out.push(TEST_PASSES.length > 1 ? `## ${pass}. ${testPass.title}` : `## ${testPass.title}`);
        out.push("");
        out.push(`> **Setup:** ${passSetup(testPass, target)}`);

        // How to test each check, once per pass; the screens below just list them.
        out.push("");
        out.push("**Checks in this pass — how to test each:**");
        for (const mode of modesHere) {
          out.push("");
          if (subheadings) {
            out.push(`*${mode.title}*`);
            out.push("");
          }
          for (const { item, on } of inPass.filter((c) => c.item.mode === mode.id)) {
            const ifPresent = on.find((o) => o.ifPresent)?.ifPresent;
            const criteria = item.wcag.map((id) => `${WCAG[id]?.name ?? id} (${WCAG[id]?.level ?? "?"})`).join(" · ");
            const only = ifPresent ? ` *Only applies if the app has ${ifPresent.map((f) => FEATURE_LABEL[f]).join(" or ")}; none were found in the code, so mark N/A if there are none.*` : "";
            out.push(`- **${number.get(item.id)}** ${item.title} — *${criteria}.* ${howToFor(item, target)}${only}`);
          }
        }

        // Then screen by screen: every check in this pass on one screen before moving to the next.
        for (const section of group.sections) {
          const here = inPass.filter((c) => c.on.some((o) => o.section === section));
          if (here.length === 0) continue;
          out.push("");
          out.push(`### ${section.screen?.name ?? APP_WIDE}`);
          const where = section.screen ? findIt(section.screen, allScreens) : undefined;
          if (where) {
            out.push("");
            out.push(where);
          }
          const mark = marks.get(`${target}|${section.screen?.name ?? ""}`);
          if (mark?.blocked) out.push("", `> **Blocked:**${mark.blocked.reason ? ` ${mark.blocked.reason}` : ""}`);
          if (mark?.note) out.push("", `> **Note:** ${mark.note}`);
          for (const mode of modesHere) {
            const checks = here.filter((c) => c.item.mode === mode.id);
            if (checks.length === 0) continue;
            out.push("");
            if (subheadings) {
              out.push(`#### ${mode.title}`);
              out.push("");
            }
            for (const { item } of checks) {
              const screen = section.screen?.name;
              // Untouched pre-fills and device results aren't a tester's answers — rebuild them from the current runs.
              const previousRow = kept.get(answerKey(target, item.id, screen));
              const measured = screen ? verifiedOn(runs, target, screen, item) : undefined;
              // A measurement fills in lines nobody has answered yet; a tester's answer always wins.
              const unanswered = previousRow?.reviewed === false || previousRow?.auto || (measured && previousRow?.status === "open");
              const row = unanswered ? undefined : previousRow;
              const notes = scanNotes(item, section, runs, allScreens, [target]);
              // A scan finding here means the check already fails on this screen: start it as [!], marked as not reviewed.
              const scanFailed = notes.some((x) => !x.startsWith(VERIFY_NOTE));
              const label = `**${number.get(item.id)}** ${item.title} · \`${item.id}\``;
              out.push(
                ...(row
                  ? serializeRow(row, label)
                  : measured
                    ? [`- [${measured.failed ? "!" : "x"}] ${label} ${AUTO_HINT} (${measured.summary})`]
                    : [scanFailed ? `- [!] ${label} ${UNREVIEWED_HINT}` : `- [ ] ${label}`]),
              );
              for (const note of notes) out.push(`  ${note}`);
            }
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
  const [first, ...rest] = row.issues;
  return [
    `- [${mark}] ${label}${first ? `: ${issueText(first)}` : ""}`,
    ...rest.map((i) => `  - ${issueText(i)}`),
    ...(row.notes ?? []).map((n) => `  Note: ${n}`),
  ];
}

function answerKey(target: AuditTarget, itemId: string, screen: string | undefined): string {
  return `${target}|${itemId}|${screen ?? ""}`;
}

/**
 * How to get to a screen, shown under its heading: "deep link `home/orders` ·
 * path: Tab bar → OrderNowDashboard → AllOrders · also from: Side menu".
 */
function findIt(s: ScreenInfo, screens: ScreenInfo[]): string | undefined {
  const parts: string[] = [];
  if (s.deepLink) parts.push(`deep link \`${s.deepLink}\``);
  const path = navPath(s, screens);
  if (path) {
    parts.push(`path: ${path.join(" → ")}`);
    const via = path[path.length - 2]!;
    const others = (s.reachedFrom ?? []).filter((r) => stripCondition(r) !== via && r !== via);
    if (others.length) parts.push(`also from: ${others.slice(0, 3).join(", ")}${others.length > 3 ? ", …" : ""}`);
  } else if (s.reachedFrom?.length) {
    parts.push(`reached from ${s.reachedFrom.slice(0, 3).join(", ")}${s.reachedFrom.length > 3 ? ", …" : ""}`);
  }
  if (s.url) parts.push(s.url);
  return parts.length ? `*${parts.join(" · ")}*` : undefined;
}

/** "Loading (LoginValidationStatus) (has patientKey)" → "Loading". */
const stripCondition = (label: string) => label.replace(/(\s*\([^)]*\))+$/, "").trim();

/**
 * The shortest route to a screen from an entry point, following "reached from"
 * links backwards. Entry points are labels that aren't screens ("App launch",
 * "Tab bar", "Side menu"); among equally short routes, one from app launch wins.
 */
export function navPath(target: ScreenInfo, screens: ScreenInfo[]): string[] | undefined {
  const byName = new Map(screens.map((x) => [normName(x.name), x]));
  const seen = new Set([target.name]);
  let level: Array<{ screen: ScreenInfo; path: string[] }> = [{ screen: target, path: [target.name] }];
  while (level.length) {
    const found: string[][] = [];
    const next: typeof level = [];
    for (const { screen, path } of level) {
      for (const label of screen.reachedFrom ?? []) {
        const from = byName.get(normName(stripCondition(label)));
        if (!from) found.push([label, ...path]);
        else if (!seen.has(from.name)) {
          seen.add(from.name);
          next.push({ screen: from, path: [from.name, ...path] });
        }
      }
    }
    if (found.length) return found.find((p) => /launch|start/i.test(p[0]!)) ?? found[0];
    level = next;
  }
  return undefined;
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
      for (const note of unmatchedFindings(section, runs, allScreens, group.targets)) lines.push(`  - ${note}`);
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
  // Found on a running app: tied to the screen by name, not by source file.
  const onScreen = typeof f.evidence?.screen === "string" && !file ? f.evidence.screen : undefined;
  if (section.screen) {
    if (section.screen.kind === "web") return Boolean(page && page === section.screen.url);
    if (onScreen) return onScreen === section.screen.name;
    return Boolean(file && section.screen.files?.includes(file));
  }
  // App-wide: findings no screen claims.
  if (onScreen) return !screens.some((s) => s.name === onScreen);
  if (file) return !screens.some((s) => s.files?.includes(file));
  if (page) return !screens.some((s) => s.url === page);
  return true;
}

/** Findings on a section whose criteria none of its checks cover — listed so nothing goes missing. */
function unmatchedFindings(section: PlannedSection, runs: AutomatedRun[], screens: ScreenInfo[], targets: AuditTarget[]): string[] {
  const covered = new Set(section.checks.flatMap((c) => c.item.wcag));
  const found = runs
    .filter((run) => run.targets.some((t) => targets.includes(t)))
    .flatMap((run) => run.findings)
    .filter((f) => findingOnSection(f, section, screens) && !f.wcag.some((c) => covered.has(c.id)));
  return compactFindings(found, section).map((line) => `${line} (${criteriaOf(found, line)}; no check covers this)`);
}

function criteriaOf(findings: Finding[], line: string): string {
  const f = findings.find((x) => line.includes(issueTitle(x)));
  return f?.wcag.map((c) => c.id).join(", ") || "no WCAG mapping";
}

const SEVERITY_WORD: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const MAX_PLACES = 5;

/** The issue itself, without the " — path" and "(n×)" that per-file titles carry. */
function issueTitle(f: Finding): string {
  return f.title.replace(/ \(\d+×\)/, "").split(" — ")[0]!;
}

/** A short, recognizable file reference: "Button.js:18", or "Button/index.js:18" for generic names. */
function shortPlace(f: Finding, section: PlannedSection): string | undefined {
  const file = typeof f.evidence?.file === "string" ? f.evidence.file : undefined;
  if (file) {
    const parts = file.split("/");
    const base = /^index\.[jt]sx?$/.test(parts.at(-1)!) && parts.length > 1 ? parts.slice(-2).join("/") : parts.at(-1)!;
    const lines = Array.isArray(f.evidence?.lines) ? (f.evidence.lines as number[]) : [];
    return `${base}${lines.length ? `:${lines.slice(0, 3).join(",")}${lines.length > 3 ? ",…" : ""}` : ""}`;
  }
  // Web findings: the page is the section itself, so show the element instead.
  const page = typeof f.evidence?.page === "string" ? f.evidence.page : undefined;
  if (f.nodeId && f.nodeId !== page && f.nodeId !== section.screen?.name) return f.nodeId;
  return undefined;
}

/** One line per issue: severity, what's wrong, and where (capped, with "+N more"). */
function compactFindings(findings: Finding[], section: PlannedSection): string[] {
  const byIssue = new Map<string, { severity: Severity; places: string[] }>();
  for (const f of findings) {
    const key = issueTitle(f);
    const entry = byIssue.get(key) ?? { severity: f.severity, places: [] };
    if (SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[entry.severity]) entry.severity = f.severity;
    const place = shortPlace(f, section);
    if (place && !entry.places.includes(place)) entry.places.push(place);
    byIssue.set(key, entry);
  }
  return [...byIssue]
    .sort((a, b) => SEVERITY_ORDER[a[1].severity] - SEVERITY_ORDER[b[1].severity])
    .map(([title, { severity, places }]) => {
      const shown = places.slice(0, MAX_PLACES).join(", ");
      const more = places.length > MAX_PLACES ? ` +${places.length - MAX_PLACES} more` : "";
      return `⚑ ${SEVERITY_WORD[severity]} · ${title}${shown ? ` — ${shown}${more}` : ""}`;
    });
}

/** Short wording for "check this by hand" signals, keyed by signal id. */
const VERIFY_SHORT: Record<string, string> = {
  gestures: "Gesture or drag: needs a single-tap alternative",
  media: "Video player: check captions, audio description, autoplay",
  "looping-animation": "Looping animation: needs a way to pause",
  modals: "Modal: check focus moves in and back",
  webview: "WebView: audit its web content separately",
  timeout: "Long timer: check users can extend time limits",
  "no-announcements": "No announcements found in code: check status messages are read out",
};

/** Starts lines a tool filled in by measuring the running app; rebuilt on every run until a tester edits the line. */
export const AUTO_HINT = "— measured on device";
const AUTO_RE = /\s*— measured on device(?: \([^)]*\))?\s*$/;

/** A run that fully verified this check on this screen and platform, and whether it found failures there. */
function verifiedOn(runs: AutomatedRun[], target: AuditTarget, screen: string, item: ChecklistItem): { summary: string; failed: boolean } | undefined {
  for (const run of runs) {
    if (!run.targets.includes(target)) continue;
    const v = run.verified?.find((x) => x.screen === screen && x.criteria.some((c) => item.wcag.includes(c)));
    if (!v) continue;
    const failed = run.findings.some((f) => f.evidence?.screen === screen && f.wcag.some((c) => item.wcag.includes(c.id)));
    return { summary: v.summary, failed };
  }
  return undefined;
}

/** Appended to lines the scan pre-filled as failing, until a tester has reviewed the screen. */
export const UNREVIEWED_HINT = "— scan found issues · not reviewed yet";
const UNREVIEWED_RE = /\s*—?\s*(scan found issues\s*·\s*)?not reviewed yet\s*/i;

/** Prefix for "check this by hand" notes, as opposed to ⚑ lines for actual scan findings. */
const VERIFY_NOTE = "⚑ Verify";

function scanNotes(item: ChecklistItem, section: PlannedSection, runs: AutomatedRun[], screens: ScreenInfo[], targets: AuditTarget[]): string[] {
  const relevant = runs.filter((run) => run.targets.some((t) => targets.includes(t)));
  const found = relevant.flatMap((run) => run.findings).filter((f) => f.wcag.some((c) => item.wcag.includes(c.id)) && findingOnSection(f, section, screens));
  const lines = compactFindings(found, section);

  for (const sig of relevant.flatMap((run) => run.signals ?? [])) {
    if (!sig.criteria.some((c) => item.wcag.includes(c))) continue;
    const locs = section.screen
      ? sig.locations.filter((l) => section.screen!.files?.includes(l.file))
      : sig.locations.filter((l) => !screens.some((s) => s.files?.includes(l.file)));
    if (section.screen && locs.length === 0) continue;
    if (!section.screen && sig.locations.length > 0 && locs.length === 0) continue;
    const where = locs.slice(0, 3).map((l) => `${l.file.split("/").at(-1)}:${l.line}`).join(", ");
    const text = VERIFY_SHORT[sig.id] ?? sig.message.replace(/\.$/, "");
    lines.push(`${VERIFY_NOTE} · ${text}${where ? ` — ${where}${locs.length > 3 ? ` +${locs.length - 3} more` : ""}` : ""}`);
  }
  return lines;
}

/**
 * a11y-audit/scan-details.md: everything the automated scans found, per screen,
 * with full file paths and line numbers, severity, WCAG criteria, why it
 * matters, and how to fix it. The checklist only shows a one-line summary.
 */
export function renderScanDetails({ projectName, groups, runs }: Pick<RenderInput, "projectName" | "groups" | "runs">): string {
  const out = [`# Automated scan details — ${projectName}`, "", "Everything the automated scans found, by screen. The checklist shows a one-line summary of each; the full list is also in report.md.", ""];
  for (const group of groups) {
    const screens = group.sections.filter((s) => s.screen).map((s) => s.screen!);
    for (const section of group.sections) {
      const found = runs
        .filter((run) => run.targets.some((t) => group.targets.includes(t)))
        .flatMap((run) => run.findings)
        .filter((f) => findingOnSection(f, section, screens))
        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
      if (found.length === 0) continue;
      out.push(`## ${section.screen?.name ?? APP_WIDE_LABEL}`, "");
      const byIssue = new Map<string, Finding[]>();
      for (const f of found) byIssue.set(issueTitle(f), [...(byIssue.get(issueTitle(f)) ?? []), f]);
      for (const [title, list] of byIssue) {
        const f = list[0]!;
        out.push(`### ${SEVERITY_WORD[f.severity]} · ${title}`, "");
        out.push(`- **WCAG:** ${f.wcag.map((c) => `${c.id} ${c.name} (${c.level})`).join(", ") || "—"}`);
        out.push(`- **Where:**`);
        for (const x of list) {
          const file = typeof x.evidence?.file === "string" ? x.evidence.file : undefined;
          const lines = Array.isArray(x.evidence?.lines) ? (x.evidence.lines as number[]) : [];
          const page = typeof x.evidence?.page === "string" ? x.evidence.page : undefined;
          out.push(`  - ${file ? `\`${file}\`${lines.length ? ` line${lines.length > 1 ? "s" : ""} ${lines.join(", ")}` : ""}` : (x.nodeId ?? page ?? "—")}`);
        }
        out.push(`- **Why it matters:** ${f.description || title}`);
        if (f.remediation) out.push(`- **Fix:** ${f.remediation}`);
        out.push(`- **Source:** ${f.source ?? "scan"} · \`${f.ruleId}\``, "");
      }
    }
  }
  return out.join("\n");
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
  /** Tester notes under the check ("  Note: …"): kept on regenerate, not counted as issues. */
  notes?: string[];
  /** The raw lines, so answers survive regenerating the file. */
  lines: string[];
  /** An automated scan found an issue for this check on this screen (a ⚑ line under it). */
  flagged?: boolean;
  /** False for a scan pre-fill nobody has reviewed yet (still has the "not reviewed yet" note). */
  reviewed?: false;
  /** Filled in by measuring the running app ("— measured on device"); a tester hasn't edited it. */
  auto?: true;
}

export interface OtherFinding extends ChecklistIssue {
  platforms: AuditTarget[];
  screen?: string;
}

/** What a tester noted about a whole screen on one platform: blocked, or a free-form note. */
export interface ScreenMark {
  target: AuditTarget;
  /** Screen/page name, or undefined for app-wide. */
  screen?: string;
  /** The screen couldn't be tested; `reason` may be empty. */
  blocked?: { reason: string };
  note?: string;
}

export interface ParsedChecklist {
  rows: ChecklistRow[];
  /** Blocked screens and screen notes ("> **Blocked:** …", "> **Note:** …", or a "- BLOCKED" heading). */
  screenMarks: ScreenMark[];
  other: OtherFinding[];
  /** Raw text of the "Other findings" section below the instructions, kept on regenerate. */
  otherRaw: string;
  warnings: string[];
}

export function emptyChecklist(): ParsedChecklist {
  return { rows: [], screenMarks: [], other: [], otherRaw: "", warnings: [] };
}

/**
 * Read a filled-in checklist. Pass the audit's screen names so headings testers
 * edited ("PAPQuestions (step 1)", "QRREGISTER - BLOCKED", "VALIDATE_INFORMATION")
 * still map to their screen; the extra text becomes a screen note.
 */
export function parseChecklist(md: string, knownScreens: string[] = []): ParsedChecklist {
  const result = emptyChecklist();
  const marks = new Map<string, ScreenMark>();
  const addMark = (target: AuditTarget, screen: string | undefined, add: { blocked?: { reason: string }; note?: string }) => {
    if (!add.blocked && !add.note) return;
    const key = `${target}|${screen ?? ""}`;
    const mark = marks.get(key) ?? { target, ...(screen ? { screen } : {}) };
    if (add.blocked) mark.blocked = { reason: [mark.blocked?.reason, add.blocked.reason].filter(Boolean).join("; ") };
    if (add.note && !mark.note?.includes(add.note)) mark.note = [mark.note, add.note].filter(Boolean).join("; ");
    marks.set(key, mark);
  };
  let group: "mobile" | "web" | "other" | undefined;
  /** The platform of the current "# iOS" / "# Android" / "# Website" part (new layout). */
  let partTarget: AuditTarget | undefined;
  /** Current "### Login" heading in the screen-by-screen layout. */
  let screenHeading: string | undefined;
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
      screenHeading = undefined;
      lastRow = undefined;
      return;
    }
    if (/^### /.test(line)) {
      const id = /^### .*`([a-z0-9-]+)`/.exec(line)?.[1];
      // "### 1.1 **Check** · `id`" is a check heading (lines are screens);
      // "### Login" is a screen heading inside a pass (lines are checks).
      itemId = id;
      screenHeading = undefined;
      if (!id) {
        const heading = parseScreenHeading(line.slice(4).trim().replace(/^\*\*(.+)\*\*$/, "$1"), knownScreens);
        screenHeading = heading.screen;
        if (partTarget) addMark(partTarget, isAppWideHeading(heading.screen) ? undefined : heading.screen, heading);
      }
      lastRow = undefined;
      return;
    }
    if (!itemId && screenHeading === undefined) return;

    const screenLine = screenHeading !== undefined && partTarget ? /^>\s*\*\*(Blocked|Note):?\*\*:?\s*(.*)$/i.exec(line) : null;
    if (screenLine) {
      const text = screenLine[2]!.trim();
      addMark(partTarget!, isAppWideHeading(screenHeading!) ? undefined : screenHeading, screenLine[1]!.toLowerCase() === "blocked" ? { blocked: { reason: text } } : { note: text });
      return;
    }

    const mark = /^- \[(.)\]\s*(.+)$/.exec(line);
    if (mark) {
      // Earlier layout: sections are screens and lines are platforms ("## Screen: Login" / "- [x] iOS").
      const legacy = /^(Screen|Page):\s/.test(section) || section === APP_WIDE;
      let target: AuditTarget | undefined;
      let screen: string | undefined;
      let rest: string;
      let hinted = false;
      let auto = false;
      let lineItem = itemId;
      if (screenHeading !== undefined && !legacy) {
        // Screen-by-screen: "- [ ] **1.1** Title · `id`: issue".
        if (!partTarget) return;
        target = partTarget;
        let body = mark[2]!;
        if (UNREVIEWED_RE.test(body)) {
          hinted = true;
          body = body.replace(UNREVIEWED_RE, " ");
        }
        if (AUTO_RE.test(body)) {
          auto = true;
          body = body.replace(AUTO_RE, "");
        }
        const id = /`([a-z0-9-]+)`/.exec(body);
        if (!id) return;
        lineItem = id[1];
        screen = isAppWideHeading(screenHeading) ? undefined : screenHeading;
        rest = body.slice(id.index + id[0].length).replace(/^\s*:\s*/, "");
      } else if (legacy) {
        const m = /^(iOS|Android|Web)\b\s*[:—–-]?\s*(.*)$/i.exec(mark[2]!);
        if (!m) return;
        target = LABEL_TARGET[m[1]!.toLowerCase()];
        screen = section === APP_WIDE ? undefined : section.replace(/^(Screen|Page):\s*/, "");
        rest = m[2]!;
      } else {
        if (!partTarget) return;
        target = partTarget;
        let body = mark[2]!;
        if (UNREVIEWED_RE.test(body)) {
          hinted = true;
          body = body.replace(UNREVIEWED_RE, "");
        }
        const sep = body.indexOf(": ");
        const label = (sep >= 0 ? body.slice(0, sep) : body).trim().replace(/^\*\*(.+)\*\*$/, "$1");
        screen = label === APP_WIDE_LABEL ? undefined : label;
        rest = sep >= 0 ? body.slice(sep + 2) : "";
      }
      const status = statusFor(mark[1]!);
      const first = rest.trim() ? classifyIssueText(rest) : undefined;
      if (!status) result.warnings.push(`Line ${lineNo}: unknown mark "[${mark[1]}]" — use [x], [!], [-], or [ ].`);
      lastRow = {
        group,
        section,
        screen,
        itemId: lineItem!,
        target: target!,
        status: status ?? "open",
        issues: first && "issue" in first ? [first.issue] : [],
        ...(first && "note" in first ? { notes: [first.note] } : {}),
        lines: [line],
        ...(hinted ? { reviewed: false } : {}),
        ...(auto ? { auto: true as const } : {}),
      };
      result.rows.push(lastRow);
      return;
    }

    if (lastRow && /^\s{2,}⚑ /.test(line)) {
      if (!line.trim().startsWith(VERIFY_NOTE)) lastRow.flagged = true;
      return;
    }
    // "  - issue", or indented text testers wrote without the dash ("  High - Header doesn't work", "  Note: …").
    const extra = /^\s{2,}(?:- (.+)|([^-⚑>|<\s].*))$/.exec(line);
    if (extra && lastRow) {
      const c = classifyIssueText(extra[1] ?? extra[2]!);
      if ("issue" in c) lastRow.issues.push(c.issue);
      else (lastRow.notes ??= []).push(c.note);
      lastRow.lines.push(line);
    }
  });

  for (const row of result.rows) {
    // A pre-fill counts as reviewed once the tester removes the hint, adds notes, or changes the mark.
    if (row.reviewed === false && (row.status !== "fail" || row.issues.length > 0)) delete row.reviewed;
    if (row.issues.length > 0 && row.status === "open") row.status = "fail";
    if (row.issues.length > 0 && row.status !== "fail") {
      result.warnings.push(`${TARGET_LABEL[row.target]} › ${row.screen ?? APP_WIDE_LABEL} › ${row.itemId}: has issue text but isn't marked [!] — kept as a note, not counted.`);
      row.notes = [...row.issues.map(issueText), ...(row.notes ?? [])];
      row.issues = [];
    }
  }
  const untested = result.rows.filter((r) => r.status === "fail" && r.notes?.some((n) => CANT_TEST_RE.test(n)));
  if (untested.length) {
    const list = untested.slice(0, 8).map((r) => `${TARGET_LABEL[r.target]} › ${r.screen ?? APP_WIDE_LABEL} › ${r.itemId}`);
    result.warnings.push(
      `${untested.length} line(s) are marked [!] fail but say they couldn't be tested, so they count as failures: ${list.join("; ")}${untested.length > 8 ? "; …" : ""}. Leave them [ ] until they're tested, or mark the screen Blocked.`,
    );
  }
  const contradictions = result.rows.filter((r) => r.status === "pass" && r.flagged);
  if (contradictions.length) {
    const list = contradictions.slice(0, 8).map((r) => `${TARGET_LABEL[r.target]} › ${r.screen ?? APP_WIDE_LABEL} › ${r.itemId}`);
    result.warnings.push(
      `${contradictions.length} line(s) are marked [x] pass, but an automated scan found an issue there (⚑), so the scan finding still counts against them: ${list.join("; ")}${contradictions.length > 8 ? "; …" : ""}. Change them to [!] unless you've confirmed the scan is wrong.`,
    );
  }
  result.otherRaw = otherLines.join("\n");
  result.screenMarks = [...marks.values()];
  return result;
}

function isAppWideHeading(heading: string): boolean {
  return heading === APP_WIDE || heading === APP_WIDE_LABEL;
}

const BLOCKED_RE = /\s*[-–—:]?\s*\bBLOCKED\b[\s:–—-]*(.*)$/i;
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** "QRREGISTER - BLOCKED", "PAPQuestions (step 1)" → the screen, whether it's blocked, and the tester's extra text. */
export function parseScreenHeading(heading: string, knownScreens: string[] = []): { screen: string; blocked?: { reason: string }; note?: string } {
  let name = heading.trim();
  let blocked: { reason: string } | undefined;
  const b = BLOCKED_RE.exec(name);
  if (b) {
    blocked = { reason: b[1]!.trim() };
    name = name.slice(0, b.index).trim();
  }
  const match = resolveScreenName(name, knownScreens);
  const note = match?.rest.replace(/^[\s:–—-]+/, "").replace(/^\((.*)\)$/, "$1").trim();
  return { screen: match?.screen ?? name, ...(blocked ? { blocked } : {}), ...(note ? { note } : {}) };
}

function resolveScreenName(heading: string, known: string[]): { screen: string; rest: string } | undefined {
  if (!normName(heading)) return undefined;
  const exact = known.find((k) => k === heading) ?? known.find((k) => normName(k) === normName(heading));
  if (exact) return { screen: exact, rest: "" };
  // A known name followed by the tester's own text: "CreateOrder: every resupply screen".
  let best: string | undefined;
  for (const k of known) {
    if (heading.toLowerCase().startsWith(k.toLowerCase()) && !/[a-z0-9]/i.test(heading[k.length] ?? "") && k.length > (best?.length ?? 0)) best = k;
  }
  if (best) return { screen: best, rest: heading.slice(best.length) };
  // A route-style first word: "VALIDATE_INFORMATION (Validation)" → ValidateInformation.
  const m = /^([^\s:(]+)(.*)$/.exec(heading);
  const k = m ? known.find((x) => normName(x) === normName(m[1]!)) : undefined;
  return k ? { screen: k, rest: m![2]! } : undefined;
}

function statusFor(mark: string): CheckStatus | undefined {
  if (mark === "x" || mark === "X") return "pass";
  if (mark === "!") return "fail";
  if (mark === "-") return "na";
  if (mark === " ") return "open";
  return undefined;
}

const SEVERITY_PREFIX_RE = /^(critical|high|medium|low)\s*(?::|\s[-–—]|[-–—]\s)\s*/i;
const NOTE_PREFIX_RE = /^(?:note|n\/?a)\s*(?::|\s[-–—]|[-–—]\s)\s*/i;
const CANT_TEST_RE = /\b(?:can[’']?t|cannot|couldn[’']?t|unable to)\s+test\b/i;

/**
 * Text a tester wrote on or under a check: an issue ("High - Header doesn't work",
 * "Close has no name (high)"), or a note ("Note: …", "na - …", "Can't test without zoom").
 */
export function classifyIssueText(raw: string): { issue: ChecklistIssue } | { note: string } {
  const text = raw.trim();
  const note = NOTE_PREFIX_RE.exec(text);
  if (note) return { note: text.slice(note[0].length).trim() || text };
  if (CANT_TEST_RE.test(text)) return { note: text };
  const sev = SEVERITY_PREFIX_RE.exec(text);
  if (!sev) return { issue: parseIssue(text) };
  const issue = parseIssue(text.slice(sev[0].length).trim());
  return { issue: { ...issue, severity: issue.severity ?? (sev[1]!.toLowerCase() as Severity) } };
}

const issueText = (i: ChecklistIssue) => `${i.text}${i.wcag?.length ? ` [${i.wcag.join(", ")}]` : ""}${i.severity ? ` (${i.severity})` : ""}`.trim();

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

