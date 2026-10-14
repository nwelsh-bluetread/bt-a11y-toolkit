/**
 * The manual testing checklist as data, so the interactive `bt-a11y start`
 * wizard (and anything else) can walk testers through it per platform and
 * WCAG level. Mirrors docs/MANUAL_TESTING.md — keep the two in sync.
 */
import type { Platform, Severity, WcagLevel } from "./types.js";

/** A platform the manual checklist can be run against. */
export type AuditTarget = Extract<Platform, "web" | "ios" | "android">;

export interface ChecklistItem {
  id: string;
  title: string;
  /** WCAG success criterion ids (see `WCAG` in wcag.ts). */
  wcag: string[];
  /** Lowest conformance level that requires this check. */
  level: WcagLevel;
  /** Which kinds of product the check applies to. */
  appliesTo: Array<"web" | "mobile">;
  /** Scorecard category failures roll up into. */
  category: string;
  /** Default severity when the check fails (the tester can override). */
  severity: Severity;
  /** How to test it. `default` is used when there's no platform-specific text. */
  howTo: Partial<Record<AuditTarget | "default", string>>;
}

const ALL: ChecklistItem["appliesTo"] = ["web", "mobile"];

export const MANUAL_CHECKLIST: ChecklistItem[] = [
  // ── Level A ────────────────────────────────────────────────────────────────
  {
    id: "sr-name-role-value",
    title: "Screen reader announces the name, role, and state of every control",
    wcag: ["4.1.2"],
    level: "A",
    appliesTo: ALL,
    category: "Screen Reader",
    severity: "high",
    howTo: {
      web: "Turn on NVDA (Windows) or VoiceOver (Cmd+F5 on Mac). Tab through every control and listen: is each one named, is its role (button, link, checkbox) announced, and are states (selected, expanded, disabled) read out?",
      ios: "Turn on VoiceOver (Settings → Accessibility → VoiceOver, or triple-click the side button). Swipe right through every control and listen for a name, a role (button, link, heading), and states (selected, dimmed, expanded).",
      android: "Turn on TalkBack (Settings → Accessibility → TalkBack). Swipe right through every control and listen for a name, a role (button, switch, link), and states (checked, selected, disabled).",
    },
  },
  {
    id: "focus-order",
    title: "Reading and focus order is logical and matches the visual layout",
    wcag: ["1.3.2", "2.4.3"],
    level: "A",
    appliesTo: ALL,
    category: "Keyboard & Focus",
    severity: "high",
    howTo: {
      web: "Tab through each page and swipe/arrow with the screen reader. Focus should move top-to-bottom, left-to-right, in the order a sighted user would read it.",
      default: "Swipe right through each screen with the screen reader. The order should follow the visual layout; nothing skipped, nothing jumping around.",
    },
  },
  {
    id: "modal-focus",
    title: "Dialogs, sheets, and menus move focus in, keep it inside, and return it on close",
    wcag: ["2.4.3"],
    level: "A",
    appliesTo: ALL,
    category: "Keyboard & Focus",
    severity: "high",
    howTo: {
      web: "Open each modal/menu with the keyboard. Focus should move into it, Tab should not escape to the page behind, Esc should close it, and focus should return to the button that opened it.",
      default: "Open each modal, bottom sheet, and menu with the screen reader on. Focus should land inside it, swiping should not reach content behind it, and closing it should return focus to what opened it.",
    },
  },
  {
    id: "keyboard-operable",
    title: "Everything works with a keyboard, and there are no keyboard traps",
    wcag: ["2.1.1", "2.1.2"],
    level: "A",
    appliesTo: ALL,
    category: "Keyboard & Focus",
    severity: "critical",
    howTo: {
      web: "Put the mouse away. Use Tab / Shift+Tab / Enter / Space / Esc / arrow keys to complete every primary flow. You should never get stuck in a widget.",
      ios: "Pair a Bluetooth keyboard and turn on Full Keyboard Access (Settings → Accessibility → Keyboards). Complete every primary flow with Tab and Space; you should never get stuck.",
      android: "Pair a Bluetooth/USB keyboard. Complete every primary flow with Tab, arrow keys, and Enter; you should never get stuck.",
    },
  },
  {
    id: "alt-text-meaningful",
    title: "Images and icons have meaningful text alternatives (or are hidden if decorative)",
    wcag: ["1.1.1"],
    level: "A",
    appliesTo: ALL,
    category: "Images/Icons",
    severity: "high",
    howTo: {
      default: "Listen to how each image and icon button is announced. Labels should describe purpose (\"Search\", not \"magnifying glass\" or \"icon_42\"); purely decorative images should be skipped entirely.",
    },
  },
  {
    id: "color-alone",
    title: "Information is not conveyed by color alone",
    wcag: ["1.4.1"],
    level: "A",
    appliesTo: ALL,
    category: "Visual",
    severity: "medium",
    howTo: {
      default: "Check errors, required fields, statuses, links within text, and charts. Each needs a second cue (icon, text, underline, pattern) besides color. Viewing in grayscale makes this easy to spot.",
    },
  },
  {
    id: "errors-identified",
    title: "Form errors are identified and described in text, and announced",
    wcag: ["3.3.1"],
    level: "A",
    appliesTo: ALL,
    category: "Forms",
    severity: "high",
    howTo: {
      default: "Submit each form empty and with bad data. Every error should be described in text, tied to its field, and announced by the screen reader.",
    },
  },
  {
    id: "input-labels",
    title: "Every input has a label or instructions (not just placeholder text)",
    wcag: ["3.3.2"],
    level: "A",
    appliesTo: ALL,
    category: "Forms",
    severity: "high",
    howTo: {
      default: "Focus each field with the screen reader. It should announce a label that stays available after typing — placeholder text alone doesn't count.",
    },
  },
  {
    id: "captions",
    title: "Prerecorded video and audio have captions",
    wcag: ["1.2.2"],
    level: "A",
    appliesTo: ALL,
    category: "Media & Motion",
    severity: "high",
    howTo: {
      default: "Play every video/audio clip. Accurate, synchronized captions should be available. Mark N/A if there's no media.",
    },
  },
  {
    id: "sensory-characteristics",
    title: "Instructions don't rely only on shape, position, or sound",
    wcag: ["1.3.3"],
    level: "A",
    appliesTo: ALL,
    category: "Visual",
    severity: "medium",
    howTo: {
      default: "Look for copy like \"tap the round button\" or \"see the box on the right\". Each needs a text equivalent (the control's name).",
    },
  },
  {
    id: "link-purpose",
    title: "Link and button purpose is clear from its text or context",
    wcag: ["2.4.4"],
    level: "A",
    appliesTo: ALL,
    category: "Content",
    severity: "medium",
    howTo: {
      default: "Listen for vague labels like \"Read more\", \"Click here\", or several identical \"Edit\" buttons. Each should make sense to a screen reader user on its own or with its immediate context.",
    },
  },
  {
    id: "pointer-gestures",
    title: "Swipe, pinch, and drag gestures have a single-tap alternative",
    wcag: ["2.5.1"],
    level: "A",
    appliesTo: ALL,
    category: "Gestures & Touch",
    severity: "high",
    howTo: {
      web: "Find carousels, sliders, maps, and drag-and-drop. Each must also work with simple clicks/taps (e.g. arrow buttons).",
      default: "Find swipe-to-delete, carousels, pinch-to-zoom, drag-to-reorder, and multi-finger gestures. Each must also be doable with a single tap (buttons, menu actions, or screen-reader custom actions).",
    },
  },
  {
    id: "pointer-cancellation",
    title: "Actions fire on release, and dragging off a control cancels",
    wcag: ["2.5.2"],
    level: "A",
    appliesTo: ALL,
    category: "Gestures & Touch",
    severity: "medium",
    howTo: {
      default: "Press and hold a button, slide your finger/pointer off it, then release. The action should not fire.",
    },
  },

  // ── Level AA ───────────────────────────────────────────────────────────────
  {
    id: "focus-visible",
    title: "A visible focus indicator appears on every focusable control",
    wcag: ["2.4.7"],
    level: "AA",
    appliesTo: ALL,
    category: "Keyboard & Focus",
    severity: "high",
    howTo: {
      web: "Tab through every page. You should always be able to see where focus is — check custom buttons, links, and inputs that may have outline removed.",
      default: "With an external keyboard (Full Keyboard Access on iOS), Tab through each screen. A focus ring should always be visible.",
    },
  },
  {
    id: "contrast",
    title: "Text contrast is 4.5:1 (3:1 large text); icons and UI borders 3:1",
    wcag: ["1.4.3", "1.4.11"],
    level: "AA",
    appliesTo: ALL,
    category: "Contrast",
    severity: "high",
    howTo: {
      web: "Spot-check with the Colour Contrast Analyser or browser DevTools, especially hover/focus/disabled states, placeholder text, and text over images or gradients.",
      ios: "Use Accessibility Inspector's color contrast calculator or screenshots in the Colour Contrast Analyser. Check light and dark mode, and text over images.",
      android: "Accessibility Scanner flags many contrast issues; also check light and dark themes, disabled states, and text over images with the Colour Contrast Analyser.",
    },
  },
  {
    id: "resize-text",
    title: "Text scales to 200% without clipping, overlap, or lost content",
    wcag: ["1.4.4"],
    level: "AA",
    appliesTo: ALL,
    category: "Layout & Zoom",
    severity: "high",
    howTo: {
      web: "Zoom the browser to 200% (Cmd/Ctrl +). All text should remain readable and every control usable.",
      ios: "Set Settings → Accessibility → Display & Text Size → Larger Text to the largest size. Text should grow and nothing should be truncated or overlapping.",
      android: "Set Settings → Display → Font size (and Display size) to the maximum. Text should grow and nothing should be truncated or overlapping.",
    },
  },
  {
    id: "reflow",
    title: "Content reflows at 320px wide with no horizontal scrolling",
    wcag: ["1.4.10"],
    level: "AA",
    appliesTo: ["web"],
    category: "Layout & Zoom",
    severity: "medium",
    howTo: {
      web: "Set the browser to 1280px wide and zoom to 400% (or use a 320px-wide responsive viewport). Content should stack into one column with no sideways scrolling.",
    },
  },
  {
    id: "text-spacing",
    title: "Increased text spacing doesn't break the layout",
    wcag: ["1.4.12"],
    level: "AA",
    appliesTo: ["web"],
    category: "Layout & Zoom",
    severity: "low",
    howTo: {
      web: "Apply a text-spacing bookmarklet (line height 1.5, paragraph spacing 2x, letter 0.12em, word 0.16em). No text should be cut off or overlap.",
    },
  },
  {
    id: "status-messages",
    title: "Status messages are announced without moving focus",
    wcag: ["4.1.3"],
    level: "AA",
    appliesTo: ALL,
    category: "Screen Reader",
    severity: "medium",
    howTo: {
      default: "Trigger toasts, loading indicators, \"item added\" messages, and search result counts with the screen reader on. Each should be announced without focus jumping away.",
    },
  },
  {
    id: "headings-labels",
    title: "Headings and labels are descriptive, and headings are exposed as headings",
    wcag: ["2.4.6"],
    level: "AA",
    appliesTo: ALL,
    category: "Content",
    severity: "medium",
    howTo: {
      web: "List headings with the screen reader (NVDA: Insert+F7; VoiceOver: rotor). They should outline the page clearly; labels should say what each control does.",
      ios: "Use the VoiceOver rotor set to Headings to jump between them. Section titles should be exposed as headings and be descriptive.",
      android: "Use TalkBack's reading controls set to Headings to jump between them. Section titles should be exposed as headings and be descriptive.",
    },
  },
  {
    id: "orientation",
    title: "Works in both portrait and landscape (not locked unless essential)",
    wcag: ["1.3.4"],
    level: "AA",
    appliesTo: ALL,
    category: "Layout & Zoom",
    severity: "medium",
    howTo: {
      web: "On a phone or tablet, rotate between portrait and landscape. The site should not force one orientation.",
      default: "Rotate the device on every screen. The app should support both orientations unless one is essential (e.g. a check-deposit camera).",
    },
  },
  {
    id: "target-size",
    title: "Touch/click targets are at least 24×24 or adequately spaced",
    wcag: ["2.5.8"],
    level: "AA",
    appliesTo: ALL,
    category: "Touch Targets",
    severity: "medium",
    howTo: {
      web: "Check small icon buttons, close (×) buttons, and inline links in dense lists. Each should be at least 24×24 CSS px or have spacing so a 24px circle doesn't overlap neighbors.",
      ios: "Accessibility Inspector's audit flags small hit regions; also try tapping small icons and closely spaced controls — they should not misfire.",
      android: "Accessibility Scanner flags small touch targets; also try tapping small icons and closely spaced controls — they should not misfire.",
    },
  },
  {
    id: "consistent-navigation",
    title: "Navigation and repeated components are consistent across screens",
    wcag: ["3.2.3", "3.2.4"],
    level: "AA",
    appliesTo: ALL,
    category: "Content",
    severity: "low",
    howTo: {
      default: "Compare navigation, headers, and repeated controls across screens. They should appear in the same order and use the same names for the same functions.",
    },
  },
  {
    id: "error-suggestion",
    title: "Error messages suggest how to fix the problem",
    wcag: ["3.3.3"],
    level: "AA",
    appliesTo: ALL,
    category: "Forms",
    severity: "medium",
    howTo: {
      default: "Trigger validation errors. Messages should say how to fix it (\"Enter a date as MM/DD/YYYY\"), not just \"Invalid\".",
    },
  },

  // ── Level AAA ──────────────────────────────────────────────────────────────
  {
    id: "contrast-enhanced",
    title: "Text contrast is 7:1 (4.5:1 for large text)",
    wcag: ["1.4.6"],
    level: "AAA",
    appliesTo: ALL,
    category: "Contrast",
    severity: "low",
    howTo: { default: "Re-measure body and UI text against the higher 7:1 bar." },
  },
  {
    id: "target-size-enhanced",
    title: "Touch targets are at least 44×44",
    wcag: ["2.5.5"],
    level: "AAA",
    appliesTo: ALL,
    category: "Touch Targets",
    severity: "low",
    howTo: { default: "Measure interactive targets; each should be at least 44×44 px/pt/dp." },
  },
  {
    id: "motion",
    title: "Motion triggered by interaction can be turned off",
    wcag: ["2.3.3"],
    level: "AAA",
    appliesTo: ALL,
    category: "Media & Motion",
    severity: "low",
    howTo: {
      web: "Turn on the OS reduced-motion setting. Parallax, zoom, and slide animations should stop or be minimal.",
      ios: "Turn on Settings → Accessibility → Motion → Reduce Motion. Animations should be removed or replaced with fades.",
      android: "Turn on Settings → Accessibility → Remove animations. Animations should be removed or minimal.",
    },
  },
  {
    id: "sign-language",
    title: "Prerecorded audio content has sign language interpretation",
    wcag: ["1.2.6"],
    level: "AAA",
    appliesTo: ALL,
    category: "Media & Motion",
    severity: "low",
    howTo: { default: "Check media for a sign language track. Mark N/A if there's no media." },
  },
  {
    id: "timing",
    title: "No time limits, and re-authenticating doesn't lose data",
    wcag: ["2.2.3", "2.2.5"],
    level: "AAA",
    appliesTo: ALL,
    category: "Content",
    severity: "low",
    howTo: {
      default: "Look for timeouts and session expiry. Users shouldn't be timed out of tasks, and logging back in should preserve what they entered.",
    },
  },
  {
    id: "help",
    title: "Context-sensitive help is available where input is required",
    wcag: ["3.3.5"],
    level: "AAA",
    appliesTo: ALL,
    category: "Forms",
    severity: "low",
    howTo: { default: "Check complex forms for hints, examples, or help links next to fields." },
  },
];

const LEVEL_RANK: Record<WcagLevel, number> = { A: 1, AA: 2, AAA: 3 };

/** Checklist items that apply to a platform at a target level (levels stack: AA includes A). */
export function checklistFor(target: AuditTarget, level: WcagLevel): ChecklistItem[] {
  const kind = target === "web" ? "web" : "mobile";
  return MANUAL_CHECKLIST.filter(
    (item) => item.appliesTo.includes(kind) && LEVEL_RANK[item.level] <= LEVEL_RANK[level],
  );
}

/** The testing instructions for an item on a given platform. */
export function howToFor(item: ChecklistItem, target: AuditTarget): string {
  return item.howTo[target] ?? item.howTo.default ?? Object.values(item.howTo)[0] ?? "";
}
