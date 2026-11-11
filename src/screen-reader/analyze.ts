/**
 * Turn screen reader transcripts into findings.
 *
 * Every finding here is a lead, not a verdict: it is built from what VoiceOver
 * said and where focus went during one scripted run, so each one carries
 * `evidence.needsReview` and lands on the checklist as "not reviewed yet" for
 * an auditor to confirm or dismiss.
 */
import { WCAG, wcag } from "../wcag.js";
import type { Finding, Severity } from "../types.js";
import type { FocusedControl, Transcript, TranscriptReview, TranscriptStep } from "./transcript.js";

export const SOURCE = "voiceover";

/** Criteria these checks can produce findings for. */
export const SCREEN_READER_CRITERIA = ["1.1.1", "1.3.1", "2.1.1", "2.1.2", "2.4.3", "2.4.4", "3.3.2", "4.1.2", "4.1.3"];

const FORM_ROLES = new Set(["textbox", "searchbox", "combobox", "listbox", "spinbutton", "slider", "checkbox", "radio", "switch"]);
const STATEFUL_ROLES = new Set(["checkbox", "radio", "switch", "menuitemcheckbox", "menuitemradio"]);
const STATE_WORDS = /\b(checked|unchecked|not checked|selected|not selected|on|off|mixed|pressed)\b/i;
const GENERIC_LINK = /^(click here|here|read more|more|learn more|see more|details|more info|link|this|go|continue)$/i;
const IMAGE_FILE = /\b[\w-]+\.(png|jpe?g|gif|svg|webp|avif)\b/i;
const UNLABELED_IMAGE = /\bunlabell?ed (image|graphic)\b/i;
/** Steps after which content usually changes, so a missing announcement is a status-message problem. */
const DYNAMIC_STEPS = new Set(["activate", "press", "type", "wait", "goto"]);

interface Place {
  transcript: Transcript;
  step: TranscriptStep;
  /** File the transcript was read from, for the auditor to open. */
  file?: string;
}

function control(c: FocusedControl): string {
  return c.name ? `${c.role} "${c.name}"` : `${c.role} (no name)`;
}

function make(
  ruleId: string,
  severity: Severity,
  criteria: string[],
  title: string,
  description: string,
  remediation: string,
  at: Place,
  extra: { node?: FocusedControl; spoken?: string } = {},
): Finding {
  return {
    ruleId,
    title,
    description,
    severity,
    wcag: wcag(...criteria),
    nodeId: extra.node ? control(extra.node) : undefined,
    nodeType: extra.node?.role,
    remediation,
    platforms: ["web"],
    source: SOURCE,
    evidence: {
      page: at.step.url,
      workflow: at.transcript.workflow,
      step: `${at.step.step}. ${at.step.action}`,
      ...(extra.spoken !== undefined ? { spoken: extra.spoken || "(silent)" } : {}),
      ...(at.file ? { transcript: at.file } : {}),
      needsReview: true,
    },
  };
}

/** Checks on each control focus landed on. */
function focusFindings(at: Place): Finding[] {
  const out: Finding[] = [];
  for (const o of at.step.output) {
    const c = o.focus;
    if (!c) continue;
    const said = `VoiceOver said: “${o.spoken || "(nothing)"}”.`;

    if (!c.name) {
      const form = FORM_ROLES.has(c.role);
      out.push(make(
        "sr-no-name", "high", form ? ["4.1.2", "3.3.2"] : c.role === "link" ? ["4.1.2", "2.4.4"] : ["4.1.2"],
        form ? "Form field has no accessible name" : `${c.role[0]!.toUpperCase()}${c.role.slice(1)} has no accessible name`,
        `Focus reached a ${c.role} with no accessible name, so screen reader users hear only its role. ${said}`,
        form ? "Associate a visible <label> with the field (or aria-labelledby pointing at visible text)." : "Give it a name: visible text content, aria-label, or alt text on an image inside it.",
        at, { node: c, spoken: o.spoken },
      ));
    } else if (!o.spoken.trim()) {
      out.push(make(
        "sr-silent-focus", "medium", ["4.1.2"],
        "Nothing announced when the control received focus",
        `Focus moved to ${control(c)} but VoiceOver said nothing. This can be a timing glitch in the run; confirm by tabbing to it manually.`,
        "Make sure the control is exposed to assistive tech (not aria-hidden, not a custom element without a role).",
        at, { node: c, spoken: o.spoken },
      ));
    }

    if (STATEFUL_ROLES.has(c.role) && o.spoken.trim() && !STATE_WORDS.test(o.spoken)) {
      out.push(make(
        "sr-missing-state", "high", ["4.1.2"],
        "Checked/selected state not announced",
        `${control(c)} was announced without its state, so users can't tell whether it is on. ${said}`,
        "Use a native checkbox/radio, or keep aria-checked (aria-pressed for toggle buttons) in sync with the visual state.",
        at, { node: c, spoken: o.spoken },
      ));
    }

    if (c.role === "link" && GENERIC_LINK.test(c.name.trim())) {
      out.push(make(
        "sr-generic-link", "medium", ["2.4.4"],
        "Link text doesn't describe its destination",
        `The link “${c.name}” only makes sense with the text around it; in a links list or when tabbing it is ambiguous. ${said}`,
        "Rewrite the link text to name the destination (e.g. “Read the pricing guide”), or add the missing context with aria-label / visually hidden text.",
        at, { node: c, spoken: o.spoken },
      ));
    }

    if (c.tabindex !== undefined && c.tabindex > 0) {
      out.push(make(
        "sr-positive-tabindex", "medium", ["2.4.3"],
        "Positive tabindex changes the focus order",
        `${control(c)} has tabindex="${c.tabindex}", which pulls it out of the reading order.`,
        "Remove the positive tabindex and order the elements in the DOM instead.",
        at, { node: c },
      ));
    }
  }
  return out;
}

/** Image problems VoiceOver reads out on any step. */
function imageFindings(at: Place): Finding[] {
  return at.step.output
    .filter((o) => UNLABELED_IMAGE.test(o.spoken) || (IMAGE_FILE.test(o.spoken) && /\b(image|graphic|img)\b/i.test(o.spoken)))
    .map((o) => make(
      "sr-image-alt", "high", ["1.1.1"],
      UNLABELED_IMAGE.test(o.spoken) ? "Image has no text alternative" : "Image is announced by its file name",
      `VoiceOver said: “${o.spoken}”. Screen reader users get no meaningful description of the image.`,
      'Add alt text that describes the image, or alt="" if it is purely decorative.',
      at, { spoken: o.spoken },
    ));
}

/** Heading structure from a full read of the page. */
function headingFindings(at: Place): Finding[] {
  if (at.step.kind !== "read") return [];
  const levels = at.step.output.map((o) => /heading level (\d)/i.exec(o.spoken)?.[1]).filter((l): l is string => Boolean(l)).map(Number);
  if (levels.length === 0) {
    return at.step.output.length >= 10
      ? [make(
        "sr-no-headings", "medium", ["1.3.1"],
        "No headings announced on the page",
        `VoiceOver read ${at.step.output.length} items without a single heading, so screen reader users can't skim or jump between sections.`,
        "Mark up section titles as real headings (<h1>–<h6>), starting with one <h1>.",
        at,
      )]
      : [];
  }
  const out: Finding[] = [];
  for (let i = 1; i < levels.length; i++) {
    if (levels[i]! > levels[i - 1]! + 1) {
      out.push(make(
        "sr-heading-skip", "low", ["1.3.1"],
        "Heading levels skip",
        `A heading level ${levels[i]} follows a level ${levels[i - 1]}, so the outline implies a missing section.`,
        "Use heading levels in order (h2 under h1, h3 under h2); style them with CSS instead of picking a level for its size.",
        at,
      ));
      break;
    }
  }
  return out;
}

/** Focus order, traps and unreachable controls from a `tab` step. */
function tabFindings(at: Place): Finding[] {
  const { tab } = at.step;
  if (!tab) return [];
  const out: Finding[] = [];
  const focused = at.step.output.map((o) => o.focus).filter((c): c is FocusedControl => Boolean(c));

  const backwards = focused.findIndex((c, i) => i > 0 && c.domIndex < focused[i - 1]!.domIndex);
  if (backwards > 0) {
    out.push(make(
      "sr-focus-order", "medium", ["2.4.3"],
      "Tab order doesn't follow the reading order",
      `Tabbing went from ${control(focused[backwards - 1]!)} back up the page to ${control(focused[backwards]!)}. Check the order still makes sense to someone who can't see the layout.`,
      "Order elements in the DOM the way they should be read; avoid positive tabindex and CSS that reorders interactive content.",
      at, { node: focused[backwards] },
    ));
  }

  if (tab.stopped === "repeated" && focused.length > 0) {
    out.push(make(
      "sr-keyboard-trap", "medium", ["2.1.2"],
      "Focus cycles inside the page and never leaves it",
      `Pressing Tab returned to an already-visited control instead of moving on (after ${focused.length} stops). Fine inside an open modal dialog; otherwise keyboard users are trapped.`,
      "Only trap focus inside open modal dialogs, and make sure Escape closes them.",
      at, { node: focused.at(-1) },
    ));
  }

  for (const c of tab.unreached) {
    out.push(make(
      "sr-unreachable", "high", ["2.1.1"],
      "Interactive element can't be reached with Tab",
      `${control(c)} is on the page but Tab never landed on it, so keyboard-only users can't operate it.`,
      "Use a native interactive element (<button>, <a href>), or add tabindex=\"0\" plus keyboard handlers to the custom control.",
      at, { node: c },
    ));
  }
  return out;
}

/** Duplicate link names that go to different places, across one transcript. */
function ambiguousLinkFindings(transcript: Transcript, file?: string): Finding[] {
  const byName = new Map<string, { hrefs: Set<string>; at: Place; node: FocusedControl }>();
  for (const step of transcript.steps) {
    for (const o of step.output) {
      const c = o.focus;
      if (c?.role !== "link" || !c.name || !c.href) continue;
      const key = `${step.url}|${c.name.toLowerCase()}`;
      const entry = byName.get(key) ?? { hrefs: new Set<string>(), at: { transcript, step, file }, node: c };
      entry.hrefs.add(c.href);
      byName.set(key, entry);
    }
  }
  return [...byName.values()]
    .filter((e) => e.hrefs.size > 1 && !GENERIC_LINK.test(e.node.name))
    .map((e) => make(
      "sr-ambiguous-links", "low", ["2.4.4"],
      "Links with the same text go to different places",
      `${e.hrefs.size} links are all announced as “${e.node.name}” but lead to different pages (${[...e.hrefs].slice(0, 3).join(", ")}).`,
      "Make each link's text unique to its destination, or add context with aria-label / visually hidden text.",
      e.at, { node: e.node },
    ));
}

/** A workflow `expect` that VoiceOver didn't say. */
function expectFindings(at: Place): Finding[] {
  const { step } = at;
  if (step.expect === undefined || step.passed !== false || step.error) return [];
  const criteria = step.wcag?.filter((c) => WCAG[c]).length ? step.wcag.filter((c) => WCAG[c]) : DYNAMIC_STEPS.has(step.kind) ? ["4.1.3"] : ["4.1.2"];
  const said = step.output.map((o) => o.spoken).filter(Boolean).join(" / ");
  return [make(
    "sr-expected-announcement", "medium", criteria,
    `Expected announcement not heard: “${step.expect}”`,
    `The workflow expected VoiceOver to say “${step.expect}” at this step. It said: “${said || "(nothing)"}”.`,
    DYNAMIC_STEPS.has(step.kind)
      ? "Announce updates that appear without a focus change with a live region (role=\"status\" / role=\"alert\"), or move focus to them."
      : "Check the element's accessible name, role and state match what is shown on screen.",
    at, { spoken: said },
  )];
}

/** Same issue on the same element on the same page → one finding. */
function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = [f.ruleId, f.nodeId ?? f.title, f.evidence?.page].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function analyzeTranscript(transcript: Transcript, file?: string): Finding[] {
  const findings: Finding[] = [];
  for (const step of transcript.steps) {
    const at = { transcript, step, file };
    findings.push(...focusFindings(at), ...imageFindings(at), ...headingFindings(at), ...tabFindings(at), ...expectFindings(at));
  }
  findings.push(...ambiguousLinkFindings(transcript, file));
  return dedupe(findings);
}

/** Findings from the AI review of a transcript (judgment calls: meaningful alt text, clear labels…). */
export function reviewFindings(transcript: Transcript, review: TranscriptReview, file?: string): Finding[] {
  return review.findings.flatMap((r) => {
    const step = transcript.steps.find((s) => s.step === r.step) ?? transcript.steps[0];
    const criteria = r.wcag.filter((c) => WCAG[c]);
    if (!step || criteria.length === 0) return [];
    const f = make("sr-ai-review", r.severity, criteria, r.title, r.description, r.remediation ?? "", { transcript, step, file });
    return [{ ...f, source: `${SOURCE}-ai`, remediation: r.remediation }];
  });
}
