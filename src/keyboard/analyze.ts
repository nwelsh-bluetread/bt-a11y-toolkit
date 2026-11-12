/**
 * Turn keyboard runner results into findings.
 *
 * Like the screen reader findings, every one is a lead from one automated run
 * (`evidence.needsReview`): it pre-fills its checklist line as "not reviewed
 * yet" and only reaches the report once a tester confirms it.
 */
import type { Finding, Severity } from "../types.js";
import { wcag } from "../wcag.js";
import type { KbElement, KbResult, KbStep } from "./results.js";

export const SOURCE = "keyboard";

/** Criteria these checks can produce findings for (feeds the coverage matrix as "scanned"). */
export const KEYBOARD_CRITERIA = ["2.1.1", "2.1.2", "2.4.1", "2.4.3", "2.4.7", "2.4.11"];

/** How many element names a grouped finding lists before "and N more". */
const LIST = 6;

function control(c: KbElement): string {
  return c.name ? `${c.role} "${c.name}"` : `${c.role} (no name)`;
}

function list(els: KbElement[]): string {
  const names = els.slice(0, LIST).map(control).join(", ");
  return els.length > LIST ? `${names} and ${els.length - LIST} more` : names;
}

interface Place {
  result: KbResult;
  step?: KbStep;
  file?: string;
}

function make(ruleId: string, severity: Severity, criteria: string[], title: string, description: string, remediation: string, at: Place, node?: KbElement): Finding {
  const page = at.step?.url ?? at.result.url;
  return {
    ruleId,
    title,
    description,
    severity,
    wcag: wcag(...criteria),
    nodeId: node ? control(node) : undefined,
    nodeType: node?.role,
    remediation,
    platforms: ["web"],
    source: SOURCE,
    evidence: {
      page,
      ...(at.result.kind === "workflow" ? { workflow: at.result.name } : {}),
      ...(at.step ? { step: `${at.step.step}. ${at.step.action}` } : {}),
      ...(at.file ? { results: at.file } : {}),
      needsReview: true,
    },
  };
}

/** Checks on a Tab run: focus indicator, obscured focus, order, traps, unreachable controls. */
function tabFindings(at: Place & { step: KbStep }): Finding[] {
  const tab = at.step.tab!;
  const out: Finding[] = [];

  const noRing = tab.stops.filter((s) => s.indicator === "none");
  if (noRing.length) {
    out.push(make(
      "kb-no-focus-indicator", "high", ["2.4.7"],
      noRing.length === 1 ? "No visible focus indicator" : `${noRing.length} controls show no visible focus indicator`,
      `These looked exactly the same focused and not focused, so keyboard users can't see where they are: ${list(noRing)}. Check by tabbing to them; a change outside the element's edges (more than ${8}px) isn't measured.`,
      "Don't remove the outline without a replacement: style :focus-visible with an outline or ring that contrasts with its surroundings.",
      at, noRing[0],
    ));
  }

  const covered = tab.stops.filter((s) => s.obscured);
  if (covered.length) {
    out.push(make(
      "kb-focus-obscured", "medium", ["2.4.11"],
      covered.length === 1 ? "Focused control is hidden behind other content" : `${covered.length} focused controls are hidden behind other content`,
      `When these had focus, something else (a sticky header, cookie banner or overlay) covered them completely: ${list(covered)}.`,
      "Leave room for sticky headers and footers (scroll-padding on the page), and make banners and overlays dismissible or non-overlapping.",
      at, covered[0],
    ));
  }

  const backwards = tab.stops.findIndex((s, i) => i > 0 && s.domIndex < tab.stops[i - 1]!.domIndex);
  if (backwards > 0) {
    const from = tab.stops[backwards - 1]!;
    const to = tab.stops[backwards]!;
    out.push(make(
      "kb-focus-order", "medium", ["2.4.3"],
      "Tab order doesn't follow the reading order",
      `Tabbing went from ${control(from)} back up the page to ${control(to)}. Check the order still makes sense.`,
      "Order elements in the DOM the way they should be read; avoid positive tabindex and CSS that reorders interactive content.",
      at, to,
    ));
  }

  for (const s of tab.stops.filter((x) => x.tabindex !== undefined && x.tabindex > 0)) {
    out.push(make(
      "kb-positive-tabindex", "medium", ["2.4.3"],
      "Positive tabindex changes the focus order",
      `${control(s)} has tabindex="${s.tabindex}", so it's reached before everything else on the page.`,
      "Remove the positive tabindex and order the elements in the DOM instead.",
      at, s,
    ));
  }

  if (tab.stopped === "repeated" && tab.stops.length > 0) {
    const last = tab.stops.at(-1)!;
    out.push(make(
      "kb-keyboard-trap", "high", ["2.1.2"],
      "Focus loops inside part of the page",
      `After ${control(last)}, Tab went back to a control it had already visited instead of moving on through the page (${tab.stops.length} stops). Fine inside an open modal dialog that Escape closes; otherwise keyboard users are trapped.`,
      "Only contain focus inside an open modal dialog, and let Escape close it.",
      at, last,
    ));
  }

  if (tab.unreached.length) {
    out.push(make(
      "kb-unreachable", "high", ["2.1.1"],
      tab.unreached.length === 1 ? "Interactive element can't be reached with Tab" : `${tab.unreached.length} interactive elements can't be reached with Tab`,
      `These are on the page but Tab never landed on them, so keyboard-only users can't operate them: ${list(tab.unreached)}.`,
      "Use native interactive elements (<button>, <a href>), or add tabindex=\"0\" and Enter/Space handlers to custom controls.",
      at, tab.unreached[0],
    ));
  }
  return out;
}

/** A workflow step that activated, opened a dialog, or pressed Escape in one. */
function actionFindings(at: Place & { step: KbStep }): Finding[] {
  const { activated, dialog, escape } = at.step;
  const out: Finding[] = [];
  if (activated && !activated.changed) {
    out.push(make(
      "kb-activate-nothing", "high", ["2.1.1"],
      `Pressing ${activated.key} on it did nothing`,
      `${control(activated.target)} was activated with ${activated.key} and nothing changed (no page change, no content change, focus stayed put). It may only respond to a mouse click. Check by hand: some controls change only something the run can't see.`,
      activated.key === "Space"
        ? "Toggle the control on Space (native checkboxes do), and keep its checked state in sync."
        : "Use a native <button> or <a href>, or handle Enter (and Space for buttons) on the custom control.",
      at, activated.target,
    ));
  }
  if (dialog && !dialog.focusInside) {
    out.push(make(
      "kb-dialog-focus", "high", ["2.4.3"],
      "Focus doesn't move into the dialog it opened",
      `${dialog.opener ? control(dialog.opener) : "A control"} opened a dialog, but focus stayed outside it, so keyboard and screen reader users don't know it's there.`,
      "Move focus into the dialog when it opens (its first control or its heading), and keep it there until it closes.",
      at, dialog.opener,
    ));
  }
  if (escape && !escape.closed) {
    out.push(make(
      "kb-dialog-escape", "medium", ["2.1.2"],
      "Escape doesn't close the dialog",
      "Escape was pressed with a dialog open and it stayed open. Keyboard users expect Escape to close it; if there's no reachable Close button either, they're trapped.",
      "Close the dialog on Escape and return focus to the control that opened it.",
      at, escape.opener,
    ));
  } else if (escape && !escape.focusReturned) {
    out.push(make(
      "kb-dialog-focus-return", "medium", ["2.4.3"],
      "Focus doesn't return after the dialog closes",
      `The dialog closed, but focus didn't go back to ${escape.opener ? control(escape.opener) : "the control that opened it"}, so keyboard users lose their place.`,
      "When the dialog closes, move focus back to the control that opened it.",
      at, escape.opener,
    ));
  }
  return out;
}

function skipLinkFindings(at: Place): Finding[] {
  const { skipLink, hasMain } = at.result;
  if (!skipLink) return [];
  if (skipLink.present && skipLink.works === false) {
    return [make(
      "kb-skip-link-broken", "medium", ["2.4.1"],
      "Skip link doesn't move focus",
      `“${skipLink.name}” is there, but after activating it the next Tab didn't land in its target, so keyboard users still have to Tab through everything before it.`,
      "Point the link at the main content's id and make the target focusable (tabindex=\"-1\" on <main>), or move focus to it in script.",
      at,
    )];
  }
  // Landmarks are another accepted way to bypass blocks, so only flag a page with neither.
  const stopsBeforeMain = at.result.steps[0]?.tab?.stops.findIndex((s) => s.inMain) ?? -1;
  if (!skipLink.present && !hasMain && stopsBeforeMain >= 5) {
    return [make(
      "kb-no-bypass", "medium", ["2.4.1"],
      "No way to skip repeated content",
      `There are ${stopsBeforeMain} Tab stops before the main content, no skip link and no main landmark, so keyboard users Tab through the same links on every page.`,
      "Add a “Skip to main content” link as the first focusable element, and wrap the content in <main>.",
      at,
    )];
  }
  return [];
}

/** Same rule on the same element on the same page → one finding. */
function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = [f.ruleId, f.nodeId ?? f.title, f.evidence?.page].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function analyzeKeyboard(results: Array<{ result: KbResult; file?: string }>): Finding[] {
  const out: Finding[] = [];
  for (const { result, file } of results) {
    if (result.error && result.steps.length === 0) continue;
    for (const step of result.steps) {
      const at = { result, step, file };
      if (step.tab) out.push(...tabFindings(at));
      out.push(...actionFindings(at));
    }
    out.push(...skipLinkFindings({ result, file }));
  }
  return dedupe(out);
}
