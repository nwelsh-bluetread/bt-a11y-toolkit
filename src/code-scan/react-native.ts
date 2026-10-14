/**
 * React Native source-code scanner.
 *
 * Statically reads a React Native project's JS/TS files (via the TypeScript
 * compiler's parser — nothing is executed) plus native config (app.json,
 * Info.plist, AndroidManifest.xml) and reports accessibility problems that are
 * visible in code: unlabeled controls, missing roles/states, disabled font
 * scaling, locked orientation, low-contrast styles, and so on.
 *
 * Output has two parts:
 * - `findings` — likely violations, aggregated per rule per file (with line
 *   numbers) so one finding ≈ one fix ≈ one ticket.
 * - `signals` — code that needs a human to verify a criterion (gestures, media,
 *   timeouts…). These point manual testers at the right screens.
 *
 * Static analysis can only see what's written literally in the code. Props
 * passed through spreads or custom components are skipped rather than guessed
 * at, so "no findings" means "nothing found", not "passes".
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type * as TS from "typescript";
import { contrastRatio, isLargeText, requiredContrast } from "../contrast.js";
import { WCAG } from "../wcag.js";
import type { Finding, Platform, Severity, WcagLevel } from "../types.js";

export interface CodeLocation {
  file: string;
  line: number;
}

/** Code that a tester should verify by hand for the given criteria. */
export interface CodeSignal {
  id: string;
  criteria: string[];
  message: string;
  locations: CodeLocation[];
}

export interface CodeScanResult {
  root: string;
  filesScanned: number;
  findings: Finding[];
  signals: CodeSignal[];
  /** Criteria this scan has at least one check for (at the target level). */
  checked: string[];
}

export interface CodeScanOptions {
  targetLevel?: WcagLevel;
  /** Platforms findings apply to (default: iOS + Android). */
  platforms?: Platform[];
  /** Extra directory names to skip. */
  ignore?: string[];
}

interface RuleMeta {
  title: string;
  description: string;
  severity: Severity;
  wcag: string[];
  category: string;
  remediation: string;
}

/** Every check the scanner performs. */
export const RN_RULES: Record<string, RuleMeta> = {
  "rn-control-name": {
    title: "Touchable has no accessible name",
    description:
      "A Pressable/Touchable contains no text and has no accessibilityLabel, so screen readers announce it as just \"button\" (or nothing).",
    severity: "high",
    wcag: ["4.1.2", "1.1.1"],
    category: "Screen Reader",
    remediation: 'Add accessibilityLabel describing the action, e.g. accessibilityLabel="Close".',
  },
  "rn-control-role": {
    title: "Touchable has no accessibility role",
    description:
      "Pressable and Touchable* components have no default role, so screen readers don't announce them as buttons or links.",
    severity: "medium",
    wcag: ["4.1.2"],
    category: "Semantics",
    remediation: 'Add accessibilityRole="button" (or "link", "tab", "checkbox", …) — or role="button".',
  },
  "rn-control-state": {
    title: "Stateful control doesn't expose its state",
    description:
      "A control with a checkbox/switch/radio/tab role has no accessibilityState, so screen readers can't announce checked/selected.",
    severity: "medium",
    wcag: ["4.1.2"],
    category: "Screen Reader",
    remediation: "Add accessibilityState={{ checked }} (or selected) — or aria-checked / aria-selected.",
  },
  "rn-label-in-name": {
    title: "Accessible name doesn't include the visible text",
    description:
      "The accessibilityLabel replaces the visible text with different words, so voice-control users saying the visible label can't activate it.",
    severity: "medium",
    wcag: ["2.5.3"],
    category: "Screen Reader",
    remediation: "Start the accessibilityLabel with the visible text, or remove it so the visible text is used.",
  },
  "rn-hidden-control": {
    title: "Interactive control hidden from screen readers",
    description:
      "A touchable is inside (or is) an element hidden with aria-hidden, accessibilityElementsHidden, or importantForAccessibility=\"no-hide-descendants\". Sighted users can tap it; screen reader users can't reach it.",
    severity: "high",
    wcag: ["4.1.2"],
    category: "Screen Reader",
    remediation: "Remove the hiding prop from containers that hold interactive controls, or hide only the decorative parts.",
  },
  "rn-image-alt": {
    title: "Image has no text alternative or decorative marking",
    description:
      "React Native images are invisible to screen readers unless made accessible with a label. If this image conveys information, screen reader users miss it.",
    severity: "medium",
    wcag: ["1.1.1"],
    category: "Images/Icons",
    remediation:
      'If meaningful: accessible accessibilityLabel="…". If decorative: add accessible={false} (or aria-hidden) to make that explicit.',
  },
  "rn-input-label": {
    title: "Text input has no accessible label",
    description:
      "A TextInput has no accessibilityLabel / aria-label / labelledby. Placeholder text disappears on typing and isn't a reliable label.",
    severity: "high",
    wcag: ["3.3.2", "4.1.2", "1.3.1"],
    category: "Forms",
    remediation: "Add accessibilityLabel, or link a visible label with accessibilityLabelledBy / aria-labelledby.",
  },
  "rn-input-purpose": {
    title: "Personal-data field doesn't identify its purpose",
    description:
      "An email/phone/name/address/password field has no autoComplete or textContentType, so iOS AutoFill and Android Autofill can't help.",
    severity: "medium",
    wcag: ["1.3.5"],
    category: "Forms",
    remediation: 'Add autoComplete (e.g. "email", "tel", "name", "password") and textContentType for iOS.',
  },
  "rn-paste-blocked": {
    title: "Password field blocks paste and password managers",
    description:
      "A secureTextEntry input sets contextMenuHidden, which blocks pasting from password managers — a cognitive barrier at sign-in.",
    severity: "high",
    wcag: ["3.3.8"],
    category: "Forms",
    remediation: "Remove contextMenuHidden from password and one-time-code fields.",
  },
  "rn-font-scaling": {
    title: "Font scaling disabled",
    description:
      "allowFontScaling={false} ignores the user's system text size, so people who need larger text can't get it.",
    severity: "high",
    wcag: ["1.4.4"],
    category: "Layout & Zoom",
    remediation: "Remove allowFontScaling={false}; fix any layout that breaks at large sizes instead.",
  },
  "rn-font-scaling-cap": {
    title: "Font scaling capped below 200%",
    description: "maxFontSizeMultiplier below 2 stops text from reaching 200% of its default size.",
    severity: "medium",
    wcag: ["1.4.4"],
    category: "Layout & Zoom",
    remediation: "Raise maxFontSizeMultiplier to at least 2, or remove it.",
  },
  "rn-font-scaling-global": {
    title: "Font scaling disabled app-wide",
    description:
      "Text/TextInput defaultProps turn off (or cap) font scaling for the whole app, overriding every user's text-size setting.",
    severity: "critical",
    wcag: ["1.4.4"],
    category: "Layout & Zoom",
    remediation: "Remove the defaultProps override and fix layouts that break at large text sizes.",
  },
  "rn-target-size": {
    title: "Touch target smaller than the minimum size",
    description: "A touchable's style sets a width or height below the minimum target size, with no hitSlop to compensate.",
    severity: "medium",
    wcag: ["2.5.8"],
    category: "Touch Targets",
    remediation: "Make the control at least the minimum size, or add hitSlop to extend the tappable area.",
  },
  "rn-contrast": {
    title: "Text color contrast below the required ratio",
    description: "A text color against its container's background color (both set in styles) doesn't meet the WCAG contrast ratio.",
    severity: "high",
    wcag: ["1.4.3"],
    category: "Contrast",
    remediation: "Darken the text or lighten the background until the ratio meets 4.5:1 (3:1 for large text).",
  },
  "rn-heading-role": {
    title: "Heading-styled text isn't marked as a heading",
    description:
      "Text styled as a title/heading has no accessibilityRole=\"header\", so screen reader users can't navigate by headings.",
    severity: "low",
    wcag: ["1.3.1"],
    category: "Semantics",
    remediation: 'Add accessibilityRole="header" (or role="heading") to screen and section titles.',
  },
  "rn-orientation-lock": {
    title: "Screen orientation is locked",
    description: "The app forces portrait or landscape. Users with mounted devices may be unable to use it.",
    severity: "medium",
    wcag: ["1.3.4"],
    category: "Layout & Zoom",
    remediation: "Support both orientations unless one is essential (e.g. a check-deposit camera).",
  },
  "rn-reduce-motion": {
    title: "Animations don't respect Reduce Motion",
    description:
      "The app animates (Animated, Reanimated, or Lottie) but never checks the system Reduce Motion setting.",
    severity: "low",
    wcag: ["2.3.3"],
    category: "Media & Motion",
    remediation: "Check AccessibilityInfo.isReduceMotionEnabled() / useReducedMotion() and disable non-essential motion.",
  },
};

const TOUCHABLES = new Set([
  "Pressable",
  "TouchableOpacity",
  "TouchableHighlight",
  "TouchableWithoutFeedback",
  "TouchableNativeFeedback",
  "TouchableBounce",
  "RectButton",
  "BorderlessButton",
  "BaseButton",
]);
const IMAGES = new Set(["Image", "ImageBackground", "FastImage"]);
const INPUTS = new Set(["TextInput"]);
/** Children that never provide an accessible name on their own. */
const NON_TEXT = new Set(["View", "Image", "ImageBackground", "FastImage", "Svg", "ActivityIndicator", "LottieView"]);
const ICON_TAG = /(Icon|Icons|^Feather|^AntDesign|^Entypo|^FontAwesome\d?|^Ionicons|^Octicons|^Foundation|^Zocial|^EvilIcons|^SimpleLineIcons|^Fontisto)$/;
const LABEL_PROPS = ["accessibilityLabel", "aria-label", "accessibilityLabelledBy", "aria-labelledby"];
const STATEFUL_ROLES = new Set(["checkbox", "switch", "radio", "tab", "togglebutton"]);
export const SKIP_DIRS = new Set([
  "node_modules", ".git", "ios", "android", "build", "dist", "coverage", ".expo", "vendor", "Pods",
  "__tests__", "__mocks__", "e2e", "a11y-audit", ".next", "web-build", "storybook-static",
]);
const RANK: Record<WcagLevel, number> = { A: 1, AA: 2, AAA: 3 };

type Ts = typeof TS;

export async function scanReactNative(root: string, options: CodeScanOptions = {}): Promise<CodeScanResult> {
  const ts = ((await import("typescript")) as { default: Ts }).default;
  const level = options.targetLevel ?? "AA";
  const minTarget = level === "AAA" ? 44 : 24;
  const contrastLevel = level === "AAA" ? "AAA" : "AA";
  const skip = new Set([...SKIP_DIRS, ...(options.ignore ?? [])]);

  const hits = new Map<string, Map<string, { lines: number[]; detail?: string; platforms?: Platform[] }>>();
  const signals = new Map<string, CodeSignal>();
  const hit = (rule: string, loc: CodeLocation, detail?: string, platforms?: Platform[]) => {
    const byFile = hits.get(rule) ?? new Map();
    const entry = byFile.get(loc.file) ?? { lines: [], detail, platforms };
    if (!entry.lines.includes(loc.line)) entry.lines.push(loc.line);
    byFile.set(loc.file, entry);
    hits.set(rule, byFile);
  };
  const signal = (id: string, criteria: string[], message: string, loc: CodeLocation) => {
    const s = signals.get(id) ?? { id, criteria, message, locations: [] };
    if (s.locations.length < 25) s.locations.push(loc);
    signals.set(id, s);
  };

  let usesAnimation: CodeLocation | undefined;
  let checksReduceMotion = false;
  let announces = false;

  const files = listSourceFiles(root, skip);
  for (const path of files) {
    const text = readFileSync(path, "utf8");
    const file = relative(root, path).split(sep).join("/");
    const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : path.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JSX;
    const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
    const at = (node: TS.Node): CodeLocation => ({
      file,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
    });

    // File-level signals and project-level facts.
    if (/isReduceMotionEnabled|useReducedMotion|reduceMotion|ReduceMotion/.test(text)) checksReduceMotion = true;
    if (/announceForAccessibility|accessibilityLiveRegion|aria-live/.test(text)) announces = true;

    const styles = collectStyleSheets(ts, sf);

    const visit = (node: TS.Node, ancestors: ElementInfo[]) => {
      // Global font-scaling overrides: Text.defaultProps.allowFontScaling = false, etc.
      if (ts.isExpressionStatement(node)) {
        const t = node.getText(sf);
        if (/defaultProps[\s\S]*allowFontScaling\s*[:=]\s*false/.test(t)) hit("rn-font-scaling-global", at(node));
        const cap = /defaultProps[\s\S]*maxFontSizeMultiplier\s*[:=]\s*([\d.]+)/.exec(t);
        if (cap && Number(cap[1]) < 2) hit("rn-font-scaling-global", at(node));
      }

      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(sf);
        if (/lockToPortrait|lockToLandscape|lockAsync|lockPlatformAsync/.test(callee)) {
          hit("rn-orientation-lock", at(node), `Code calls ${callee}().`);
        }
        if (/^Animated\.(timing|spring|decay|loop)$|^withTiming$|^withSpring$|^withRepeat$/.test(callee)) {
          usesAnimation ??= at(node);
        }
        if (/^(setTimeout|setInterval)$/.test(callee)) {
          const ms = node.arguments[1];
          if (ms && ts.isNumericLiteral(ms) && Number(ms.text) >= 20_000) {
            signal("timeout", ["2.2.1"], "Long timer — if it ends a session or advances content, users need a way to extend it.", at(node));
          }
        }
      }

      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        const info = describe(ts, sf, opening, styles);
        checkElement(ts, sf, node, info, ancestors, { hit, signal, at, minTarget, contrastLevel });
        if (/^(Animated\.|LottieView|Lottie)/.test(info.tag) || info.name === "LottieView") usesAnimation ??= at(node);
        ts.forEachChild(node, (child) => visit(child, [...ancestors, info]));
        return;
      }
      ts.forEachChild(node, (child) => visit(child, ancestors));
    };
    visit(sf, []);
  }

  scanNativeConfig(root, hit);

  if (usesAnimation && !checksReduceMotion) hit("rn-reduce-motion", usesAnimation);
  if (!announces && files.length > 0) {
    signals.set("no-announcements", {
      id: "no-announcements",
      criteria: ["4.1.3"],
      message:
        "No accessibilityLiveRegion or AccessibilityInfo.announceForAccessibility found anywhere — check that toasts, loading, and errors are announced.",
      locations: [],
    });
  }

  const inScope = (ids: string[]) => ids.filter((id) => WCAG[id] && RANK[WCAG[id]!.level] <= RANK[level]);
  const platforms = options.platforms ?? ["ios", "android"];

  const findings: Finding[] = [];
  for (const [ruleId, byFile] of hits) {
    const meta = RN_RULES[ruleId]!;
    let criteria = inScope(meta.wcag);
    if (ruleId === "rn-contrast" && level === "AAA") criteria = [...criteria, "1.4.6"];
    if (ruleId === "rn-target-size" && level === "AAA") criteria = ["2.5.5"];
    if (criteria.length === 0) continue;
    for (const [file, entry] of byFile) {
      const lines = entry.lines.sort((a, b) => a - b);
      const where = `${file}:${lines[0]}`;
      findings.push({
        ruleId,
        title: `${meta.title}${lines.length > 1 ? ` (${lines.length}×)` : ""} — ${file}`,
        description: entry.detail ? `${meta.description} ${entry.detail}` : meta.description,
        severity: meta.severity,
        wcag: criteria.map((id) => WCAG[id]!),
        nodeId: where,
        platforms: entry.platforms ?? platforms,
        category: meta.category,
        source: "rn-code-scan",
        remediation: meta.remediation,
        evidence: {
          page: `${file} (line${lines.length > 1 ? "s" : ""} ${lines.slice(0, 15).join(", ")}${lines.length > 15 ? ", …" : ""})`,
          file,
          lines,
        },
      });
    }
  }

  const checked = [...new Set(Object.values(RN_RULES).flatMap((r) => inScope(r.wcag)))];
  if (level === "AAA") checked.push("1.4.6", "2.5.5");

  return {
    root,
    filesScanned: files.length,
    findings,
    signals: [...signals.values()].filter((s) => inScope(s.criteria).length > 0),
    checked: [...new Set(checked)].sort(compareIds),
  };
}

// ── JSX analysis ─────────────────────────────────────────────────────────────

type StyleProps = Record<string, string | number>;

interface ElementInfo {
  /** Full tag text, e.g. "Animated.View". */
  tag: string;
  /** Last segment of the tag, e.g. "View". */
  name: string;
  attrs: Map<string, AttrValue>;
  hasSpread: boolean;
  style: StyleProps;
  /** Style key names referenced (e.g. "title" from styles.title). */
  styleKeys: string[];
}

type AttrValue =
  | { kind: "string"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "number"; value: number }
  | { kind: "expr" };

function describe(ts: Ts, sf: TS.SourceFile, el: TS.JsxOpeningLikeElement, styles: StyleSheets): ElementInfo {
  const tag = el.tagName.getText(sf);
  const attrs = new Map<string, AttrValue>();
  let hasSpread = false;
  let styleExpr: TS.Expression | undefined;
  for (const prop of el.attributes.properties) {
    if (ts.isJsxSpreadAttribute(prop)) {
      hasSpread = true;
      continue;
    }
    const name = prop.name.getText(sf);
    attrs.set(name, attrValue(ts, prop));
    if (name === "style" && prop.initializer && ts.isJsxExpression(prop.initializer)) {
      styleExpr = prop.initializer.expression;
    }
  }
  const resolved = styleExpr ? resolveStyle(ts, sf, styleExpr, styles) : { props: {}, keys: [] };
  return { tag, name: tag.split(".").pop()!, attrs, hasSpread, style: resolved.props, styleKeys: resolved.keys };
}

function attrValue(ts: Ts, attr: TS.JsxAttribute): AttrValue {
  const init = attr.initializer;
  if (!init) return { kind: "bool", value: true };
  if (ts.isStringLiteral(init)) return { kind: "string", value: init.text };
  if (ts.isJsxExpression(init) && init.expression) {
    const e = init.expression;
    if (e.kind === ts.SyntaxKind.TrueKeyword) return { kind: "bool", value: true };
    if (e.kind === ts.SyntaxKind.FalseKeyword) return { kind: "bool", value: false };
    if (ts.isNumericLiteral(e)) return { kind: "number", value: Number(e.text) };
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return { kind: "string", value: e.text };
  }
  return { kind: "expr" };
}

const has = (info: ElementInfo, ...names: string[]) => names.some((n) => info.attrs.has(n));
const isTrue = (info: ElementInfo, name: string) => {
  const v = info.attrs.get(name);
  return v?.kind === "bool" && v.value;
};
const stringAttr = (info: ElementInfo, name: string) => {
  const v = info.attrs.get(name);
  return v?.kind === "string" ? v.value : undefined;
};

/** Hidden from assistive tech by this element (and the platforms it applies to). */
function hiddenBy(info: ElementInfo): Platform[] | undefined {
  if (isTrue(info, "aria-hidden")) return ["ios", "android"];
  if (isTrue(info, "accessibilityElementsHidden")) return ["ios"];
  if (stringAttr(info, "importantForAccessibility") === "no-hide-descendants") return ["android"];
  return undefined;
}

/** Explicitly not exposed to assistive tech (accessible={false}, importantForAccessibility="no", hidden). */
function isDecorativeMarked(info: ElementInfo): boolean {
  const ifa = stringAttr(info, "importantForAccessibility");
  const notAccessible = info.attrs.get("accessible")?.kind === "bool" && !isTrue(info, "accessible");
  return notAccessible || ifa === "no" || ifa === "no-hide-descendants" || Boolean(hiddenBy(info));
}

interface CheckContext {
  hit: (rule: string, loc: CodeLocation, detail?: string, platforms?: Platform[]) => void;
  signal: (id: string, criteria: string[], message: string, loc: CodeLocation) => void;
  at: (node: TS.Node) => CodeLocation;
  minTarget: number;
  contrastLevel: "AA" | "AAA";
}

function checkElement(
  ts: Ts,
  sf: TS.SourceFile,
  node: TS.JsxElement | TS.JsxSelfClosingElement,
  info: ElementInfo,
  ancestors: ElementInfo[],
  ctx: CheckContext,
): void {
  const loc = ctx.at(node);
  const { name } = info;
  const isTouchable = TOUCHABLES.has(name);

  // Hidden interactive control.
  if (isTouchable) {
    const hider = [...ancestors, info].find((a) => hiddenBy(a));
    if (hider) ctx.hit("rn-hidden-control", loc, undefined, hiddenBy(hider));
  }

  if (isTouchable && !info.hasSpread && !isDecorativeMarked(info)) {
    const children = ts.isJsxElement(node) ? node.children : ts.factory.createNodeArray<TS.JsxChild>();
    const content = textContent(ts, sf, children);

    if (!has(info, ...LABEL_PROPS) && content.kind === "none") ctx.hit("rn-control-name", loc);
    if (!has(info, "accessibilityRole", "role")) ctx.hit("rn-control-role", loc);

    const role = stringAttr(info, "accessibilityRole") ?? stringAttr(info, "role");
    if (role && STATEFUL_ROLES.has(role) && !has(info, "accessibilityState", "aria-checked", "aria-selected", "aria-pressed")) {
      ctx.hit("rn-control-state", loc, `Role: "${role}".`);
    }

    const label = stringAttr(info, "accessibilityLabel") ?? stringAttr(info, "aria-label");
    if (label && content.kind === "literal") {
      const visible = normalize(content.text);
      if (visible && !normalize(label).includes(visible)) {
        ctx.hit("rn-label-in-name", loc, `Visible "${content.text}" vs. label "${label}".`);
      }
    }

    if (!has(info, "hitSlop")) {
      const w = size(info.style, "width", "minWidth", "paddingHorizontal");
      const h = size(info.style, "height", "minHeight", "paddingVertical");
      const small = [w, h].filter((v): v is number => v !== undefined && v < ctx.minTarget);
      if (small.length > 0) ctx.hit("rn-target-size", loc, `Smallest dimension: ${Math.min(...small)}.`);
    }
  }

  // Images without text alternatives (unless inside a labeled or decorative-marked container).
  if (IMAGES.has(name) && !info.hasSpread && !isDecorativeMarked(info) && !has(info, ...LABEL_PROPS, "alt")) {
    // A labeled, hidden, or prop-spreading container (which may pass accessibility props) covers the image.
    const coveredByParent = ancestors.some((a) => a.hasSpread || isDecorativeMarked(a) || has(a, ...LABEL_PROPS));
    if (!coveredByParent) ctx.hit("rn-image-alt", loc);
  }

  // Text inputs.
  if (INPUTS.has(name) && !info.hasSpread) {
    if (!has(info, ...LABEL_PROPS, "label")) {
      const placeholder = stringAttr(info, "placeholder");
      ctx.hit("rn-input-label", loc, placeholder ? `Only a placeholder ("${placeholder}") is set.` : undefined);
    }
    const hint = [stringAttr(info, "placeholder"), stringAttr(info, "accessibilityLabel"), stringAttr(info, "label")]
      .filter(Boolean)
      .join(" ");
    const keyboard = stringAttr(info, "keyboardType");
    const personal =
      has(info, "secureTextEntry") ||
      keyboard === "email-address" ||
      keyboard === "phone-pad" ||
      /e-?mail|phone|password|first name|last name|full name|\bname\b|address|zip|postal|city|birth|card number/i.test(hint);
    if (personal && !has(info, "autoComplete", "textContentType", "autoCompleteType")) ctx.hit("rn-input-purpose", loc);
    if (has(info, "secureTextEntry") && isTrue(info, "contextMenuHidden")) ctx.hit("rn-paste-blocked", loc);
  }

  // Font scaling.
  const afs = info.attrs.get("allowFontScaling");
  if (afs?.kind === "bool" && !afs.value) ctx.hit("rn-font-scaling", loc);
  const cap = info.attrs.get("maxFontSizeMultiplier");
  if (cap?.kind === "number" && cap.value > 0 && cap.value < 2) ctx.hit("rn-font-scaling-cap", loc, `maxFontSizeMultiplier={${cap.value}}.`);

  // Text: contrast and heading semantics.
  if (name === "Text") {
    const fg = info.style.color;
    const bg = [info, ...[...ancestors].reverse()].map((a) => a.style.backgroundColor).find((c) => typeof c === "string");
    if (typeof fg === "string" && typeof bg === "string") {
      const ratio = contrastRatio(fg, bg);
      if (ratio !== null) {
        const fontSize = typeof info.style.fontSize === "number" ? info.style.fontSize : undefined;
        const weight = String(info.style.fontWeight ?? "");
        const bold = weight === "bold" || Number(weight) >= 700;
        const required = requiredContrast(ctx.contrastLevel, isLargeText(fontSize, bold));
        if (ratio < required) {
          ctx.hit("rn-contrast", loc, `${fg} on ${bg} is ${ratio.toFixed(2)}:1 (needs ${required}:1).`);
        }
      }
    }
    const headingStyle = info.styleKeys.some((k) => /^(title|heading|header|headline|h[1-3])$|(Title|Heading|Header|Headline)$/.test(k));
    if (headingStyle && !info.hasSpread && !["header", "heading"].includes(stringAttr(info, "accessibilityRole") ?? stringAttr(info, "role") ?? "")) {
      ctx.hit("rn-heading-role", loc);
    }
  }

  // Signals for manual verification.
  if (/^(PanGestureHandler|PinchGestureHandler|RotationGestureHandler|FlingGestureHandler|GestureDetector|Swipeable|ReanimatedSwipeable|DraggableFlatList|SwipeListView)$/.test(name) || has(info, "onLongPress")) {
    ctx.signal("gestures", ["2.5.1", "2.5.7"], "Gesture or drag interaction — confirm a single-tap alternative exists.", loc);
  }
  if (/^(Video|VideoView|YoutubePlayer|YoutubeIframe)$/.test(name)) {
    ctx.signal("media", ["1.2.1", "1.2.2", "1.2.3", "1.2.5", "1.4.2"], "Video player — check captions, audio description, and autoplay sound.", loc);
  }
  if ((name === "LottieView" || name === "Lottie") && isTrue(info, "loop") && has(info, "autoPlay")) {
    ctx.signal("looping-animation", ["2.2.2"], "Looping animation — must stop within 5 seconds or have a pause control.", loc);
  }
  if (name === "Modal") {
    ctx.signal("modals", ["2.4.3"], "Modal — check focus moves into it and returns to the trigger on close.", loc);
  }
  if (name === "WebView") {
    ctx.signal("webview", ["4.1.2", "1.3.1"], "WebView — the embedded web content needs its own audit (scan its URL with axe).", loc);
  }
}

/** What a touchable's children would contribute to its accessible name. */
function textContent(
  ts: Ts,
  sf: TS.SourceFile,
  children: TS.NodeArray<TS.JsxChild>,
): { kind: "none" } | { kind: "literal"; text: string } | { kind: "unknown" } {
  let text = "";
  let unknown = false;
  const walk = (nodes: readonly TS.JsxChild[], insideText: boolean) => {
    for (const child of nodes) {
      if (ts.isJsxText(child)) {
        if (child.text.trim()) text += ` ${child.text.trim()}`;
      } else if (ts.isJsxExpression(child)) {
        if (child.expression) unknown = true; // {t("save")}, {label}, {children}, conditionals…
      } else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
        const opening = ts.isJsxElement(child) ? child.openingElement : child;
        const name = opening.tagName.getText(sf).split(".").pop()!;
        const isText = name === "Text";
        const knownNonText = NON_TEXT.has(name) || ICON_TAG.test(name);
        if (!isText && !knownNonText) unknown = true; // custom component — may render text
        if (isText && !ts.isJsxElement(child)) unknown = true; // <Text text={…} /> — text passed as a prop
        if (opening.attributes.properties.some((p) => ts.isJsxAttribute(p) && LABEL_PROPS.includes(p.name.getText(sf)))) unknown = true;
        if (ts.isJsxElement(child)) walk(child.children, insideText || isText);
      } else if (ts.isJsxFragment(child)) {
        walk(child.children, insideText);
      }
    }
  };
  walk(children, false);
  if (text.trim()) return unknown ? { kind: "unknown" } : { kind: "literal", text: text.trim() };
  return unknown ? { kind: "unknown" } : { kind: "none" };
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Effective size along one axis: explicit size (or min size) plus padding on both sides. */
function size(style: StyleProps, dim: string, minDim: string, paddingAxis: string): number | undefined {
  const base = style[dim] ?? style[minDim];
  if (typeof base !== "number") return undefined;
  const pad = style[paddingAxis] ?? style.padding;
  return base + (typeof pad === "number" ? pad * 2 : 0);
}

// ── Style resolution ─────────────────────────────────────────────────────────

/** StyleSheet.create() objects in a file: variable → style key → literal props. */
type StyleSheets = Map<string, Map<string, StyleProps>>;

function collectStyleSheets(ts: Ts, sf: TS.SourceFile): StyleSheets {
  const sheets: StyleSheets = new Map();
  const visit = (node: TS.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      /StyleSheet\.create$/.test(node.initializer.expression.getText(sf))
    ) {
      const arg = node.initializer.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) {
        const sheet = new Map<string, StyleProps>();
        for (const prop of arg.properties) {
          if (ts.isPropertyAssignment(prop) && ts.isObjectLiteralExpression(prop.initializer)) {
            sheet.set(propName(ts, sf, prop.name), literalProps(ts, sf, prop.initializer));
          }
        }
        sheets.set(node.name.text, sheet);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sheets;
}

function resolveStyle(ts: Ts, sf: TS.SourceFile, expr: TS.Expression, sheets: StyleSheets): { props: StyleProps; keys: string[] } {
  if (ts.isObjectLiteralExpression(expr)) return { props: literalProps(ts, sf, expr), keys: [] };
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    const key = expr.name.text;
    return { props: sheets.get(expr.expression.text)?.get(key) ?? {}, keys: [key] };
  }
  if (ts.isArrayLiteralExpression(expr)) {
    const merged: { props: StyleProps; keys: string[] } = { props: {}, keys: [] };
    for (const el of expr.elements) {
      // `cond && styles.x` → styles.x; ternaries are ambiguous and skipped.
      const target = ts.isBinaryExpression(el) && el.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? el.right : el;
      const r = resolveStyle(ts, sf, target, sheets);
      Object.assign(merged.props, r.props);
      merged.keys.push(...r.keys);
    }
    return merged;
  }
  return { props: {}, keys: [] };
}

function literalProps(ts: Ts, sf: TS.SourceFile, obj: TS.ObjectLiteralExpression): StyleProps {
  const out: StyleProps = {};
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = propName(ts, sf, prop.name);
    const v = prop.initializer;
    if (ts.isNumericLiteral(v)) out[key] = Number(v.text);
    else if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) out[key] = v.text;
  }
  return out;
}

function propName(ts: Ts, sf: TS.SourceFile, name: TS.PropertyName): string {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : name.getText(sf);
}

// ── Native config ────────────────────────────────────────────────────────────

function scanNativeConfig(
  root: string,
  hit: (rule: string, loc: CodeLocation, detail?: string, platforms?: Platform[]) => void,
): void {
  // Expo app.json.
  const appJson = join(root, "app.json");
  if (existsSync(appJson)) {
    try {
      const json = JSON.parse(readFileSync(appJson, "utf8")) as { expo?: { orientation?: string } };
      const o = json.expo?.orientation;
      if (o === "portrait" || o === "landscape") {
        hit("rn-orientation-lock", { file: "app.json", line: lineOf(readFileSync(appJson, "utf8"), /"orientation"/) }, `Expo orientation is "${o}".`);
      }
    } catch {
      // Not valid JSON — skip.
    }
  }
  for (const name of ["app.config.js", "app.config.ts"]) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    const m = /orientation\s*:\s*["'](portrait|landscape)["']/.exec(text);
    if (m) hit("rn-orientation-lock", { file: name, line: lineOf(text, /orientation\s*:/) }, `Expo orientation is "${m[1]}".`);
  }

  // iOS Info.plist (ios/<App>/Info.plist).
  const iosDir = join(root, "ios");
  if (existsSync(iosDir)) {
    for (const entry of safeReaddir(iosDir)) {
      const plist = join(iosDir, entry, "Info.plist");
      if (entry === "Pods" || /Tests$/.test(entry) || !existsSync(plist)) continue;
      const text = readFileSync(plist, "utf8");
      const m = /<key>UISupportedInterfaceOrientations<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text);
      if (m && !(/Portrait/.test(m[1]!) && /Landscape/.test(m[1]!))) {
        hit(
          "rn-orientation-lock",
          { file: `ios/${entry}/Info.plist`, line: lineOf(text, /UISupportedInterfaceOrientations<\/key>/) },
          "UISupportedInterfaceOrientations allows only one orientation.",
          ["ios"],
        );
      }
    }
  }

  // Android manifest.
  const manifest = join(root, "android", "app", "src", "main", "AndroidManifest.xml");
  if (existsSync(manifest)) {
    const text = readFileSync(manifest, "utf8");
    const m = /android:screenOrientation="(portrait|landscape|sensorPortrait|sensorLandscape|userPortrait|userLandscape|reversePortrait|reverseLandscape)"/.exec(text);
    if (m) {
      hit(
        "rn-orientation-lock",
        { file: "android/app/src/main/AndroidManifest.xml", line: lineOf(text, /android:screenOrientation=/) },
        `android:screenOrientation="${m[1]}".`,
        ["android"],
      );
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function listSourceFiles(root: string, skip: Set<string> = SKIP_DIRS): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of safeReaddir(dir)) {
      if (entry.startsWith(".") && entry !== ".") continue;
      const path = join(dir, entry);
      let stat;
      try {
        stat = statSync(path);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (!skip.has(entry)) walk(path);
      } else if (
        /\.(jsx?|tsx?)$/.test(entry) &&
        !/\.d\.ts$|\.(test|spec|stories)\.[jt]sx?$|\.config\.[jt]s$/.test(entry) &&
        stat.size < 1_000_000
      ) {
        out.push(path);
      }
    }
  };
  walk(root);
  return out.sort();
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function lineOf(text: string, pattern: RegExp): number {
  const idx = text.search(pattern);
  return idx < 0 ? 1 : text.slice(0, idx).split("\n").length;
}

function compareIds(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return 0;
}

/** Whether a directory looks like a React Native project. */
export function isReactNativeProject(root: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    return Boolean(pkg.dependencies?.["react-native"] ?? pkg.devDependencies?.["react-native"]);
  } catch {
    return false;
  }
}
