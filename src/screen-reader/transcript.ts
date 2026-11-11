/**
 * The transcript a screen reader workflow run saves (reports/screen-reader/*.json),
 * shared by the VoiceOver runner that writes it and the analyzer that reads it.
 */

/** A control as the browser exposes it to assistive tech. */
export interface FocusedControl {
  role: string;
  /** Accessible name ("" when it has none). */
  name: string;
  /** Checked / pressed / expanded etc., from the accessibility tree. */
  states: string[];
  tag: string;
  href?: string;
  /** Explicit tabindex attribute, when set. */
  tabindex?: number;
  /** Position in document order, to compare focus order with reading order. */
  domIndex: number;
}

export interface Spoken {
  /** What VoiceOver said, without its usage hints. */
  spoken: string;
  /** The item under the VoiceOver cursor afterwards. */
  item: string;
  /** The element with keyboard focus, for steps that move focus. */
  focus?: FocusedControl;
}

export interface TabSummary {
  /** Why tabbing stopped: focus left the page, came back to a visited control, or hit the step limit. */
  stopped: "left-page" | "repeated" | "limit" | "count";
  /** Interactive elements on the page that Tab never reached. */
  unreached: FocusedControl[];
}

export interface TranscriptStep {
  step: number;
  /** Readable label, e.g. `activate #submit`. */
  action: string;
  /** Step type: "start", "read", "tab", "activate"… */
  kind: string;
  /** Page URL when the step ran. */
  url: string;
  /** One entry per VoiceOver move (a `read` or `next` step has several). */
  output: Spoken[];
  expect?: string;
  passed?: boolean;
  /** WCAG criteria the workflow author tied to this step's `expect`. */
  wcag?: string[];
  tab?: TabSummary;
  error?: string;
}

export interface Transcript {
  version: 1;
  workflow: string;
  url: string;
  ranAt: string;
  steps: TranscriptStep[];
}

/** Judgment-call findings the AI review writes next to a transcript, as <workflow>.review.json. */
export interface TranscriptReview {
  findings: Array<{
    step: number;
    title: string;
    description: string;
    wcag: string[];
    severity: "critical" | "high" | "medium" | "low";
    remediation?: string;
  }>;
}
