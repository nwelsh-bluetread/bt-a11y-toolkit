/**
 * The manual testing checklist as data, so the interactive `bt-a11y start`
 * wizard (and anything else) can walk testers through it per platform and
 * WCAG level. Mirrors docs/MANUAL_TESTING.md — keep the two in sync.
 */
import type { Platform, Severity, WcagLevel } from "./types.js";

/** A platform the manual checklist can be run against. */
export type AuditTarget = Extract<Platform, "web" | "ios" | "android">;

/** Things a screen can contain that make extra checks relevant (detected from code). */
export type ScreenFeature =
  | "inputs"
  | "images"
  | "media"
  | "gestures"
  | "modals"
  | "animation"
  | "auth"
  | "status"
  | "webview";

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
  /**
   * Where the check is done: on every screen, or once for the whole app.
   * With `when`, it's done only on screens that contain one of those features.
   */
  scope: "screen" | "app";
  when?: ScreenFeature[];
  /** Which testing pass the check belongs to, so testers set up once (e.g. VoiceOver on) and do every screen. */
  mode: TestMode;
}

export type TestMode = "screen-reader" | "keyboard" | "visual" | "touch" | "cognitive" | "media";

/**
 * Testing passes, in the order testers do them. Each starts with a one-time
 * setup, then covers every screen, to avoid switching tools screen by screen.
 */
export const TEST_MODES: Array<{ id: TestMode; title: string; setup: Partial<Record<AuditTarget | "default", string>> }> = [
  {
    id: "screen-reader",
    title: "Screen reader",
    setup: {
      ios: "Turn on VoiceOver (Settings → Accessibility → VoiceOver, or triple-click the side button with the Accessibility Shortcut) and keep it on for this whole section.",
      android: "Turn on TalkBack (Settings → Accessibility → TalkBack, or hold both volume keys with the shortcut on) and keep it on for this whole section.",
      web: "Turn on NVDA (Windows) or VoiceOver (Cmd+F5 on Mac) and keep it on for this whole section.",
    },
  },
  {
    id: "keyboard",
    title: "Keyboard, switch & voice control",
    setup: {
      ios: "Turn VoiceOver off. Pair a Bluetooth keyboard and turn on Full Keyboard Access (Settings → Accessibility → Keyboards). Voice Control (Settings → Accessibility → Voice Control) is used for the label check.",
      android: "Turn TalkBack off. Pair a Bluetooth or USB keyboard. Voice Access is used for the label check.",
      web: "Turn the screen reader off and put the mouse away: use Tab, Shift+Tab, Enter, Space, Esc, and the arrow keys.",
    },
  },
  {
    id: "visual",
    title: "Visual, text size & orientation",
    setup: {
      ios: "Assistive tech off. You'll switch Larger Text (Settings → Accessibility → Display & Text Size), rotate the device, and check colors — light and dark mode.",
      android: "Assistive tech off. You'll switch Font size and Display size (Settings → Display), rotate the device, and check colors — light and dark theme.",
      web: "Assistive tech off. You'll zoom (Cmd/Ctrl +), narrow the window, apply text spacing, and check colors.",
    },
  },
  {
    id: "touch",
    title: "Touch & gestures",
    setup: {
      default: "Assistive tech off. Use the app by touch, paying attention to small targets, swipes, drags, and long-presses.",
      web: "Assistive tech off. Use a phone or tablet (or the browser's touch emulation) and the mouse, paying attention to small targets and drag interactions.",
    },
  },
  {
    id: "cognitive",
    title: "Cognitive: content, forms & behavior",
    setup: {
      default: "Use each screen as a first-time user would: read the wording, fill in and submit forms with mistakes, and compare screens for consistency.",
    },
  },
  {
    id: "media",
    title: "Media, motion & timing",
    setup: {
      default: "Look for video, audio, animation, auto-advancing content, and time limits. Mark N/A where a screen has none.",
    },
  },
];

const ALL: ChecklistItem["appliesTo"] = ["web", "mobile"];

const ITEMS: Array<Omit<ChecklistItem, "scope" | "when" | "mode">> = [
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

  {
    id: "media-alternatives",
    title: "Audio-only and video-only content has a text alternative; video has audio description or a transcript",
    wcag: ["1.2.1", "1.2.3"],
    level: "A",
    appliesTo: ALL,
    category: "Media & Motion",
    severity: "high",
    howTo: {
      default: "For each prerecorded clip: audio-only (podcasts, voice notes) needs a transcript; silent video needs a text or audio description; video with important visuals needs audio description or a full text alternative. Mark N/A if there's no media.",
    },
  },
  {
    id: "info-relationships",
    title: "Structure is exposed to assistive tech: headings, lists, groups, and label–field relationships",
    wcag: ["1.3.1"],
    level: "A",
    appliesTo: ALL,
    category: "Semantics",
    severity: "medium",
    howTo: {
      web: "With the screen reader, list headings and landmarks, and check lists are announced as lists, tables have headers, and each field announces its label and group (e.g. radio group name).",
      ios: "With VoiceOver, use the rotor (Headings) to confirm section titles are headings. Cards and list rows should read as one coherent item, and each field should announce its label.",
      android: "With TalkBack, use reading controls (Headings) to confirm section titles are headings. Cards and list rows should read as one coherent item, and each field should announce its label.",
    },
  },
  {
    id: "audio-control",
    title: "Audio that plays automatically for more than 3 seconds can be paused or muted",
    wcag: ["1.4.2"],
    level: "A",
    appliesTo: ALL,
    category: "Media & Motion",
    severity: "high",
    howTo: {
      default: "Open each screen that might autoplay sound (video, background music, onboarding). Sound longer than 3 seconds must have a pause/mute control that's reachable with the screen reader. Mark N/A if nothing autoplays.",
    },
  },
  {
    id: "character-shortcuts",
    title: "Single-key keyboard shortcuts can be turned off or remapped",
    wcag: ["2.1.4"],
    level: "A",
    appliesTo: ALL,
    category: "Keyboard & Focus",
    severity: "medium",
    howTo: {
      web: "Press single letter/number keys (outside text fields). If any trigger actions, there must be a way to turn them off, remap them, or limit them to when a control has focus.",
      default: "With an external keyboard, press single letter keys outside text fields. If any trigger actions, they must be configurable. Mark N/A if the app has no keyboard shortcuts.",
    },
  },
  {
    id: "timing-adjustable",
    title: "Time limits can be turned off, adjusted, or extended",
    wcag: ["2.2.1"],
    level: "A",
    appliesTo: ALL,
    category: "Content",
    severity: "high",
    howTo: {
      default: "Look for session timeouts, OTP countdowns, timed quizzes, and auto-advancing screens. The user must be warned and able to extend (at least 10x or with a simple action) unless the limit is essential.",
    },
  },
  {
    id: "pause-stop-hide",
    title: "Moving, blinking, scrolling, or auto-updating content can be paused, stopped, or hidden",
    wcag: ["2.2.2"],
    level: "A",
    appliesTo: ALL,
    category: "Media & Motion",
    severity: "medium",
    howTo: {
      default: "Find carousels that auto-advance, looping animations, tickers, and live-updating feeds. Anything that moves for more than 5 seconds needs a pause/stop control.",
    },
  },
  {
    id: "flashing",
    title: "Nothing flashes more than three times per second",
    wcag: ["2.3.1"],
    level: "A",
    appliesTo: ALL,
    category: "Media & Motion",
    severity: "critical",
    howTo: {
      default: "Watch animations, videos, loading effects, and transitions. Nothing should flash more than 3 times in any one second (use PEAT for video content if unsure).",
    },
  },
  {
    id: "bypass-blocks",
    title: "A skip link or landmarks let users bypass repeated content",
    wcag: ["2.4.1"],
    level: "A",
    appliesTo: ["web"],
    category: "Keyboard & Focus",
    severity: "medium",
    howTo: {
      web: "Press Tab on page load: a \"Skip to content\" link should appear and work. Landmarks (header, nav, main) should be listed by the screen reader.",
    },
  },
  {
    id: "page-titled",
    title: "Every page or screen has a descriptive title",
    wcag: ["2.4.2"],
    level: "A",
    appliesTo: ALL,
    category: "Content",
    severity: "medium",
    howTo: {
      web: "Check the browser tab title on every page. Each should be unique and describe the page (\"Checkout – Acme\", not just \"Acme\").",
      default: "Navigate between screens with the screen reader on. Each new screen should announce a descriptive title (usually the navigation header) when it opens.",
    },
  },
  {
    id: "label-in-name",
    title: "The accessible name includes the visible label text",
    wcag: ["2.5.3"],
    level: "A",
    appliesTo: ALL,
    category: "Screen Reader",
    severity: "medium",
    howTo: {
      web: "For buttons and links with visible text, the screen reader name should contain that same text (ideally at the start). Try voice control: \"Click <visible label>\".",
      ios: "Turn on Voice Control (Settings → Accessibility → Voice Control) and say \"Tap <visible label>\" for buttons. Also listen with VoiceOver: the spoken name should contain the visible text.",
      android: "Turn on Voice Access and say \"Tap <visible label>\" for buttons. Also listen with TalkBack: the spoken name should contain the visible text.",
    },
  },
  {
    id: "motion-actuation",
    title: "Shake or tilt actions have an on-screen alternative and can be turned off",
    wcag: ["2.5.4"],
    level: "A",
    appliesTo: ALL,
    category: "Gestures & Touch",
    severity: "medium",
    howTo: {
      default: "Look for shake-to-undo, shake-to-report, tilt-to-scroll, or motion-based features. Each needs a button alternative and a way to disable the motion trigger. Mark N/A if none.",
    },
  },
  {
    id: "language",
    title: "The language of the page or app is set correctly",
    wcag: ["3.1.1"],
    level: "A",
    appliesTo: ALL,
    category: "Content",
    severity: "medium",
    howTo: {
      web: "Check <html lang> matches the page language. With the screen reader, text should be pronounced with the correct voice/accent.",
      default: "Listen with the screen reader: text should be read with the correct language voice. Switch the device language to another supported locale and confirm the app follows.",
    },
  },
  {
    id: "on-focus-input",
    title: "Focusing or changing a control doesn't cause unexpected changes of context",
    wcag: ["3.2.1", "3.2.2"],
    level: "A",
    appliesTo: ALL,
    category: "Content",
    severity: "medium",
    howTo: {
      default: "Move focus through controls and change pickers, toggles, and fields. Nothing should navigate away, submit, or open a new screen unless the user activates a clearly labeled control (or is told in advance).",
    },
  },
  {
    id: "consistent-help",
    title: "Help options (contact, chat, FAQ) appear in the same place on every screen",
    wcag: ["3.2.6"],
    level: "A",
    appliesTo: ALL,
    category: "Content",
    severity: "low",
    howTo: {
      default: "Where help mechanisms exist (support link, chat button, phone number), they should appear in the same relative position across screens. Mark N/A if there are none.",
    },
  },
  {
    id: "redundant-entry",
    title: "Users aren't asked to re-enter information they've already given in the same flow",
    wcag: ["3.3.7"],
    level: "A",
    appliesTo: ALL,
    category: "Forms",
    severity: "medium",
    howTo: {
      default: "Walk multi-step flows (checkout, sign-up, applications). Previously entered info (e.g. shipping address for billing) should be auto-filled or selectable, unless re-entry is essential for security.",
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
    title: "Content reflows without two-way scrolling (320px wide / largest text)",
    wcag: ["1.4.10"],
    level: "AA",
    appliesTo: ALL,
    category: "Layout & Zoom",
    severity: "medium",
    howTo: {
      web: "Set the browser to 1280px wide and zoom to 400% (or use a 320px-wide responsive viewport). Content should stack into one column with no sideways scrolling.",
      default: "Set the largest system text size and try each screen in portrait and landscape. Text should wrap rather than require scrolling both vertically and horizontally (maps, tables, and carousels are exempt).",
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

  {
    id: "live-media-description",
    title: "Live audio/video has captions; prerecorded video has audio description",
    wcag: ["1.2.4", "1.2.5"],
    level: "AA",
    appliesTo: ALL,
    category: "Media & Motion",
    severity: "medium",
    howTo: {
      default: "Live streams need real-time captions. Prerecorded video with important visual information needs an audio-described version. Mark N/A if there's no media.",
    },
  },
  {
    id: "input-purpose",
    title: "Personal-data fields identify their purpose so autofill works",
    wcag: ["1.3.5"],
    level: "AA",
    appliesTo: ALL,
    category: "Forms",
    severity: "medium",
    howTo: {
      web: "Check name, email, phone, address, and payment fields have the right autocomplete attribute — the browser should offer autofill.",
      ios: "Tap into name, email, phone, address, and password fields. iOS should offer AutoFill suggestions (requires textContentType).",
      android: "Tap into name, email, phone, address, and password fields. Android Autofill / Google should offer suggestions (requires autoComplete / importantForAutofill).",
    },
  },
  {
    id: "images-of-text",
    title: "Text is real text, not images of text",
    wcag: ["1.4.5"],
    level: "AA",
    appliesTo: ALL,
    category: "Visual",
    severity: "medium",
    howTo: {
      default: "Look for banners, buttons, headings, or promos rendered as images. Text should be real text (logos are exempt). Increase text size: image text won't scale.",
    },
  },
  {
    id: "hover-focus-content",
    title: "Tooltips and popovers are dismissible, hoverable, and stay visible",
    wcag: ["1.4.13"],
    level: "AA",
    appliesTo: ALL,
    category: "Visual",
    severity: "medium",
    howTo: {
      web: "Hover/focus each tooltip or popover. It must be dismissible with Esc without moving the pointer, stay open while the pointer moves onto it, and persist until dismissed.",
      default: "Check tooltips or popovers that appear on focus or long-press. They must be dismissible and stay visible until the user dismisses them. Mark N/A if none.",
    },
  },
  {
    id: "multiple-ways",
    title: "There's more than one way to find a page (navigation, search, sitemap)",
    wcag: ["2.4.5"],
    level: "AA",
    appliesTo: ["web"],
    category: "Content",
    severity: "low",
    howTo: {
      web: "Confirm at least two ways to reach content pages: e.g. main navigation plus search, a sitemap, or related links.",
    },
  },
  {
    id: "focus-not-obscured",
    title: "Focused elements aren't hidden behind sticky headers, footers, or overlays",
    wcag: ["2.4.11"],
    level: "AA",
    appliesTo: ALL,
    category: "Keyboard & Focus",
    severity: "medium",
    howTo: {
      web: "Tab through long pages. The focused element must never be fully hidden by sticky headers, cookie banners, or chat widgets.",
      default: "With an external keyboard or the screen reader, move focus through long screens. The focused item must never be fully hidden behind tab bars, sticky buttons, or the keyboard.",
    },
  },
  {
    id: "dragging",
    title: "Dragging actions have a single-tap/click alternative",
    wcag: ["2.5.7"],
    level: "AA",
    appliesTo: ALL,
    category: "Gestures & Touch",
    severity: "medium",
    howTo: {
      default: "Find drag-to-reorder, sliders, swipe-to-dismiss, and map panning. Each needs a non-dragging alternative (buttons, tap-to-select, menu actions). Mark N/A if none.",
    },
  },
  {
    id: "language-parts",
    title: "Passages in a different language are marked with that language",
    wcag: ["3.1.2"],
    level: "AA",
    appliesTo: ALL,
    category: "Content",
    severity: "low",
    howTo: {
      default: "Find phrases or sections in another language (e.g. a Spanish link on an English screen). The screen reader should switch voices for them.",
    },
  },
  {
    id: "error-prevention",
    title: "Legal, financial, or data-changing submissions can be reviewed, corrected, or reversed",
    wcag: ["3.3.4"],
    level: "AA",
    appliesTo: ALL,
    category: "Forms",
    severity: "high",
    howTo: {
      default: "For payments, purchases, account deletion, and legal agreements: there must be a review/confirm step, a way to correct input, or a way to undo.",
    },
  },
  {
    id: "accessible-auth",
    title: "Sign-in doesn't require a memory or puzzle test; password managers and paste work",
    wcag: ["3.3.8"],
    level: "AA",
    appliesTo: ALL,
    category: "Forms",
    severity: "high",
    howTo: {
      web: "On login/sign-up: paste into password and code fields, and let the password manager fill them. CAPTCHAs must offer a non-puzzle alternative (e.g. object recognition or passkey).",
      default: "On login/sign-up: paste into password and OTP fields, use the password manager / AutoFill, and confirm biometrics or passkeys work. No puzzles or memory tests should be required.",
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
  {
    id: "media-enhanced",
    title: "Extended audio description, full media alternatives, and live audio alternatives",
    wcag: ["1.2.7", "1.2.8", "1.2.9"],
    level: "AAA",
    appliesTo: ALL,
    category: "Media & Motion",
    severity: "low",
    howTo: {
      default: "Prerecorded video has extended audio description (pausing where needed) and a full text alternative; live audio-only content has a text alternative. Mark N/A if there's no media.",
    },
  },
  {
    id: "identify-purpose",
    title: "The purpose of icons, regions, and components can be programmatically determined",
    wcag: ["1.3.6"],
    level: "AAA",
    appliesTo: ALL,
    category: "Semantics",
    severity: "low",
    howTo: {
      default: "Icons and regions expose their purpose (roles, landmarks, labels) so assistive tech or personalization tools can adapt them.",
    },
  },
  {
    id: "background-audio",
    title: "Speech recordings have little or no background audio",
    wcag: ["1.4.7"],
    level: "AAA",
    appliesTo: ALL,
    category: "Media & Motion",
    severity: "low",
    howTo: {
      default: "Prerecorded speech has no background sound, or it can be turned off, or it's at least 20 dB quieter than the speech.",
    },
  },
  {
    id: "visual-presentation",
    title: "Blocks of text can be customized and are easy to read",
    wcag: ["1.4.8"],
    level: "AAA",
    appliesTo: ALL,
    category: "Visual",
    severity: "low",
    howTo: {
      default: "Users can choose text/background colors; lines are 80 characters or fewer; text isn't justified; line spacing is at least 1.5; text resizes to 200% without horizontal scrolling.",
    },
  },
  {
    id: "images-of-text-strict",
    title: "No images of text at all (except logos and essential cases)",
    wcag: ["1.4.9"],
    level: "AAA",
    appliesTo: ALL,
    category: "Visual",
    severity: "low",
    howTo: {
      default: "Confirm no text is presented as an image except logos or where a particular presentation is essential.",
    },
  },
  {
    id: "keyboard-no-exception",
    title: "Everything works with a keyboard, with no exceptions",
    wcag: ["2.1.3"],
    level: "AAA",
    appliesTo: ALL,
    category: "Keyboard & Focus",
    severity: "low",
    howTo: {
      default: "Repeat the keyboard check with no exceptions — even path-dependent input (drawing, signatures) must have a keyboard method.",
    },
  },
  {
    id: "interruptions-timeouts",
    title: "Interruptions can be postponed, and users are warned about data-loss timeouts",
    wcag: ["2.2.4", "2.2.6"],
    level: "AAA",
    appliesTo: ALL,
    category: "Content",
    severity: "low",
    howTo: {
      default: "Non-emergency alerts, popups, and updates can be postponed or turned off. Users are told how long inactivity can last before data is lost (unless data is kept for 20+ hours).",
    },
  },
  {
    id: "three-flashes",
    title: "Nothing flashes more than three times per second, regardless of size or color",
    wcag: ["2.3.2"],
    level: "AAA",
    appliesTo: ALL,
    category: "Media & Motion",
    severity: "low",
    howTo: {
      default: "Same as the flashing check, with no size or brightness exceptions.",
    },
  },
  {
    id: "navigation-enhanced",
    title: "Location is shown, link text alone is clear, and content uses section headings",
    wcag: ["2.4.8", "2.4.9", "2.4.10"],
    level: "AAA",
    appliesTo: ALL,
    category: "Content",
    severity: "low",
    howTo: {
      default: "Users can tell where they are (breadcrumbs, selected tab, screen title). Each link makes sense from its text alone. Long content is organized with section headings.",
    },
  },
  {
    id: "focus-enhanced",
    title: "Focus is never partially obscured and the focus indicator is large and high-contrast",
    wcag: ["2.4.12", "2.4.13"],
    level: "AAA",
    appliesTo: ALL,
    category: "Keyboard & Focus",
    severity: "low",
    howTo: {
      default: "No part of the focused element is hidden by other content. The focus indicator is at least as large as a 2px outline around the control with 3:1 contrast between focused and unfocused states.",
    },
  },
  {
    id: "concurrent-input",
    title: "Users can switch between touch, keyboard, voice, and switch input at any time",
    wcag: ["2.5.6"],
    level: "AAA",
    appliesTo: ALL,
    category: "Gestures & Touch",
    severity: "low",
    howTo: {
      default: "While using touch, connect a keyboard or turn on Switch/Voice Control. The app shouldn't block or ignore the other input methods.",
    },
  },
  {
    id: "language-enhanced",
    title: "Unusual words, abbreviations, reading level, and pronunciation are supported",
    wcag: ["3.1.3", "3.1.4", "3.1.5", "3.1.6"],
    level: "AAA",
    appliesTo: ALL,
    category: "Content",
    severity: "low",
    howTo: {
      default: "Jargon and idioms are defined; abbreviations are expanded; content beyond lower-secondary reading level has a simpler version; ambiguous pronunciations are clarified.",
    },
  },
  {
    id: "change-on-request",
    title: "Changes of context only happen when the user asks for them",
    wcag: ["3.2.5"],
    level: "AAA",
    appliesTo: ALL,
    category: "Content",
    severity: "low",
    howTo: {
      default: "No automatic redirects, auto-opening screens, or unexpected new windows; all context changes are user-initiated (or can be turned off).",
    },
  },
  {
    id: "error-prevention-all",
    title: "All submissions can be reviewed, corrected, or reversed",
    wcag: ["3.3.6"],
    level: "AAA",
    appliesTo: ALL,
    category: "Forms",
    severity: "low",
    howTo: {
      default: "Extend the error-prevention check to every form, not just legal/financial ones.",
    },
  },
  {
    id: "accessible-auth-enhanced",
    title: "Sign-in requires no cognitive test at all — not even object recognition",
    wcag: ["3.3.9"],
    level: "AAA",
    appliesTo: ALL,
    category: "Forms",
    severity: "low",
    howTo: {
      default: "Confirm sign-in works without any cognitive function test, including image or object recognition CAPTCHAs.",
    },
  },
];

/**
 * Where each check happens. "screen" checks repeat on every screen; "app"
 * checks are done once; `when` limits a check to screens containing that
 * feature (if no screen has it, it's listed once app-wide as "if present").
 */
const SCOPES: Record<string, Pick<ChecklistItem, "scope" | "when">> = {
  "sr-name-role-value": { scope: "screen" },
  "focus-order": { scope: "screen" },
  "modal-focus": { scope: "screen", when: ["modals"] },
  "keyboard-operable": { scope: "screen" },
  "alt-text-meaningful": { scope: "screen", when: ["images"] },
  "color-alone": { scope: "screen" },
  "errors-identified": { scope: "screen", when: ["inputs"] },
  "input-labels": { scope: "screen", when: ["inputs"] },
  "captions": { scope: "screen", when: ["media"] },
  "sensory-characteristics": { scope: "screen" },
  "link-purpose": { scope: "screen" },
  "pointer-gestures": { scope: "screen", when: ["gestures"] },
  "pointer-cancellation": { scope: "app" },
  "media-alternatives": { scope: "screen", when: ["media"] },
  "info-relationships": { scope: "screen" },
  "audio-control": { scope: "screen", when: ["media"] },
  "character-shortcuts": { scope: "app" },
  "timing-adjustable": { scope: "app" },
  "pause-stop-hide": { scope: "screen", when: ["animation"] },
  "flashing": { scope: "app" },
  "bypass-blocks": { scope: "screen" },
  "page-titled": { scope: "screen" },
  "label-in-name": { scope: "screen" },
  "motion-actuation": { scope: "app" },
  "language": { scope: "app" },
  "on-focus-input": { scope: "screen", when: ["inputs"] },
  "consistent-help": { scope: "app" },
  "redundant-entry": { scope: "screen", when: ["inputs"] },
  "focus-visible": { scope: "screen" },
  "contrast": { scope: "screen" },
  "resize-text": { scope: "screen" },
  "reflow": { scope: "screen" },
  "text-spacing": { scope: "screen" },
  "status-messages": { scope: "screen", when: ["status"] },
  "headings-labels": { scope: "screen" },
  "orientation": { scope: "app" },
  "target-size": { scope: "screen" },
  "consistent-navigation": { scope: "app" },
  "error-suggestion": { scope: "screen", when: ["inputs"] },
  "live-media-description": { scope: "screen", when: ["media"] },
  "input-purpose": { scope: "screen", when: ["inputs"] },
  "images-of-text": { scope: "screen", when: ["images"] },
  "hover-focus-content": { scope: "app" },
  "multiple-ways": { scope: "app" },
  "focus-not-obscured": { scope: "screen" },
  "dragging": { scope: "screen", when: ["gestures"] },
  "language-parts": { scope: "app" },
  "error-prevention": { scope: "screen", when: ["inputs"] },
  "accessible-auth": { scope: "screen", when: ["auth"] },
  "contrast-enhanced": { scope: "screen" },
  "target-size-enhanced": { scope: "screen" },
  "motion": { scope: "screen", when: ["animation"] },
  "sign-language": { scope: "screen", when: ["media"] },
  "timing": { scope: "app" },
  "help": { scope: "screen", when: ["inputs"] },
  "media-enhanced": { scope: "screen", when: ["media"] },
  "identify-purpose": { scope: "screen" },
  "background-audio": { scope: "screen", when: ["media"] },
  "visual-presentation": { scope: "app" },
  "images-of-text-strict": { scope: "screen", when: ["images"] },
  "keyboard-no-exception": { scope: "app" },
  "interruptions-timeouts": { scope: "app" },
  "three-flashes": { scope: "app" },
  "navigation-enhanced": { scope: "app" },
  "focus-enhanced": { scope: "screen" },
  "concurrent-input": { scope: "app" },
  "language-enhanced": { scope: "app" },
  "change-on-request": { scope: "app" },
  "error-prevention-all": { scope: "screen", when: ["inputs"] },
  "accessible-auth-enhanced": { scope: "screen", when: ["auth"] },
};

/** Which testing pass each check belongs to (see TEST_MODES). */
const MODES: Record<string, TestMode> = {
  "sr-name-role-value": "screen-reader",
  "focus-order": "screen-reader",
  "modal-focus": "screen-reader",
  "alt-text-meaningful": "screen-reader",
  "errors-identified": "screen-reader",
  "input-labels": "screen-reader",
  "link-purpose": "screen-reader",
  "info-relationships": "screen-reader",
  "page-titled": "screen-reader",
  "status-messages": "screen-reader",
  "headings-labels": "screen-reader",
  "language": "screen-reader",
  "language-parts": "screen-reader",
  "identify-purpose": "screen-reader",
  "keyboard-operable": "keyboard",
  "character-shortcuts": "keyboard",
  "bypass-blocks": "keyboard",
  "label-in-name": "keyboard",
  "focus-visible": "keyboard",
  "focus-not-obscured": "keyboard",
  "keyboard-no-exception": "keyboard",
  "focus-enhanced": "keyboard",
  "concurrent-input": "keyboard",
  "color-alone": "visual",
  "contrast": "visual",
  "resize-text": "visual",
  "reflow": "visual",
  "text-spacing": "visual",
  "orientation": "visual",
  "images-of-text": "visual",
  "hover-focus-content": "visual",
  "contrast-enhanced": "visual",
  "visual-presentation": "visual",
  "images-of-text-strict": "visual",
  "pointer-gestures": "touch",
  "pointer-cancellation": "touch",
  "motion-actuation": "touch",
  "target-size": "touch",
  "dragging": "touch",
  "target-size-enhanced": "touch",
  "sensory-characteristics": "cognitive",
  "on-focus-input": "cognitive",
  "consistent-help": "cognitive",
  "redundant-entry": "cognitive",
  "consistent-navigation": "cognitive",
  "error-suggestion": "cognitive",
  "input-purpose": "cognitive",
  "multiple-ways": "cognitive",
  "error-prevention": "cognitive",
  "accessible-auth": "cognitive",
  "help": "cognitive",
  "navigation-enhanced": "cognitive",
  "language-enhanced": "cognitive",
  "change-on-request": "cognitive",
  "error-prevention-all": "cognitive",
  "accessible-auth-enhanced": "cognitive",
  "captions": "media",
  "media-alternatives": "media",
  "audio-control": "media",
  "timing-adjustable": "media",
  "pause-stop-hide": "media",
  "flashing": "media",
  "live-media-description": "media",
  "motion": "media",
  "sign-language": "media",
  "timing": "media",
  "media-enhanced": "media",
  "background-audio": "media",
  "interruptions-timeouts": "media",
  "three-flashes": "media",
};

export const MANUAL_CHECKLIST: ChecklistItem[] = ITEMS.map((item) => {
  const scope = SCOPES[item.id];
  const mode = MODES[item.id];
  if (!scope) throw new Error(`Checklist item "${item.id}" has no scope in SCOPES`);
  if (!mode) throw new Error(`Checklist item "${item.id}" has no testing mode in MODES`);
  return { ...item, ...scope, mode };
});

/** Setup text for a testing pass on a platform. */
export function modeSetup(mode: TestMode, target: AuditTarget): string {
  const m = TEST_MODES.find((x) => x.id === mode)!;
  return m.setup[target] ?? m.setup.default ?? "";
}

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
