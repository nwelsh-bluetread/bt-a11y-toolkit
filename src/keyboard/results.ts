/**
 * What the keyboard runner records per page or workflow
 * (a11y-audit/keyboard/results/<id>.json), and the analyzer reads.
 */

/** An element as the runner describes it. */
export interface KbElement {
  role: string;
  /** Accessible name, approximated ("" when it has none). */
  name: string;
  tag: string;
  /** Position in document order, to compare focus order with reading order. */
  domIndex: number;
  tabindex?: number;
}

/** One Tab stop. */
export interface KbStop extends KbElement {
  /** Focused vs. not focused looked different ("unknown" when it couldn't be measured, e.g. zero size). */
  indicator: "visible" | "none" | "unknown";
  /** Every sampled point of the element was covered by something else (sticky header, banner) or off screen. */
  obscured: boolean;
  /** Inside the page's main landmark. */
  inMain: boolean;
}

export interface KbTabRun {
  stops: KbStop[];
  /**
   * left-page: Tab moved focus out of the page. wrapped: back to the first stop.
   * repeated: back to a later stop (a loop that doesn't include the whole page). limit/count: stopped by the runner.
   */
  stopped: "left-page" | "wrapped" | "repeated" | "limit" | "count";
  /** Interactive elements Tab never reached (only for a full Tab-through). */
  unreached: KbElement[];
}

export interface KbStep {
  step: number;
  /** Readable label, e.g. `activate #save`. */
  action: string;
  kind: string;
  url: string;
  tab?: KbTabRun;
  /** An `activate` step: whether anything happened (DOM, URL, focus or state changed). */
  activated?: { target: KbElement; key: string; changed: boolean };
  /** A dialog appeared after this step. */
  dialog?: { focusInside: boolean; opener?: KbElement };
  /** Escape pressed with a dialog open. */
  escape?: { closed: boolean; focusReturned: boolean; opener?: KbElement };
  /** VoiceOver-only step (read, next, find): not run by the keyboard runner. */
  skipped?: true;
  error?: string;
}

export interface KbResult {
  version: 1;
  /** "page": the built-in Tab-through of one page. "workflow": a saved screen reader workflow. */
  kind: "page" | "workflow";
  name: string;
  url: string;
  ranAt: string;
  steps: KbStep[];
  /** Pages only: the skip link test. `position` is its Tab stop (1 = first). */
  skipLink?: { present: boolean; name?: string; works?: boolean; position?: number };
  /** Pages only: the page has a main landmark (another way to bypass repeated blocks). */
  hasMain?: boolean;
  error?: string;
}
