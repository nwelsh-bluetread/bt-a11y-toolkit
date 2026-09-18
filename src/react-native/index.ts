/**
 * React Native adapter: serializes a rendered element tree into {@link A11yNode}s.
 *
 * Point this at a `react-test-renderer` instance (which is what
 * `@testing-library/react-native` hands you) and the resulting tree can be fed
 * to `runAudit` or the `@bluetread/accessibility-toolkit/matchers` matchers:
 *
 * ```ts
 * import { render } from "@testing-library/react-native";
 * import { StyleSheet } from "react-native";
 * import { toA11yTree } from "@bluetread/accessibility-toolkit/react-native";
 * import { runAudit } from "@bluetread/accessibility-toolkit";
 *
 * const tree = toA11yTree(render(<Screen />), { flatten: StyleSheet.flatten });
 * const assessment = runAudit(tree, { platform: "react-native", targetLevel: "AA" });
 * ```
 *
 * The adapter deliberately does not import `react-native` — it is structurally
 * typed against the renderer and ships its own style flattener, so it can be
 * unit-tested in a plain Node environment. Pass `StyleSheet.flatten` via
 * {@link ToA11yNodeOptions.flatten} when running inside an app that registers
 * styles through a native registry.
 */
import type { A11yNode } from "../types.js";

/**
 * The shape this adapter needs from a rendered element.
 *
 * Structurally compatible with `react-test-renderer`'s `ReactTestInstance`, but
 * declared locally so the toolkit takes no dependency on React or React Native.
 */
export interface RnTestInstance {
  props?: Record<string, unknown>;
  type?: unknown;
  children?: Array<RnTestInstance | string>;
}

/** A `@testing-library/react-native` render result. */
export interface RnRenderResult {
  UNSAFE_root: RnTestInstance;
}

/** Flattens a React Native `style` prop into a single object of style values. */
export type StyleFlattener = (style: unknown) => Record<string, unknown> | undefined;

export interface ToA11yNodeOptions {
  /**
   * Style flattener. Defaults to a built-in implementation that handles nested
   * arrays and falsy entries. Pass React Native's `StyleSheet.flatten` if your
   * RN version returns opaque style handles from `StyleSheet.create`.
   */
  flatten?: StyleFlattener;
  /**
   * Nearest ancestor background color, used for text contrast checks. Set
   * automatically as the adapter walks down the tree.
   */
  background?: string;
}

/** Maps RN `accessibilityRole` values onto the toolkit's normalized node types. */
const ROLE_TO_TYPE: Record<string, string> = {
  button: "button",
  link: "link",
  image: "image",
  header: "heading",
  text: "text",
  adjustable: "slider",
  search: "textinput",
};

/**
 * Flatten a `style` prop without React Native.
 *
 * Handles the shapes RN itself accepts: a plain object, an (arbitrarily nested)
 * array, and falsy entries from conditional styles. Opaque numeric style
 * handles cannot be resolved without the RN registry and are skipped — pass
 * `StyleSheet.flatten` through the options if your app produces them.
 */
export function flattenStyle(style: unknown): Record<string, unknown> | undefined {
  if (!style) return undefined;
  if (Array.isArray(style)) {
    let result: Record<string, unknown> | undefined;
    for (const entry of style) {
      const flat = flattenStyle(entry);
      if (flat) result = { ...(result ?? {}), ...flat };
    }
    return result;
  }
  if (typeof style === "object") return { ...(style as Record<string, unknown>) };
  return undefined;
}

/** Serialize a rendered React Native element into an {@link A11yNode} tree. */
export function toA11yNode(el: RnTestInstance, options: ToA11yNodeOptions = {}): A11yNode {
  const flatten = options.flatten ?? flattenStyle;
  const p = el.props ?? {};
  const role = (p.accessibilityRole ?? p.role) as string | undefined;
  const state = (p.accessibilityState ?? {}) as Record<string, unknown>;
  const style = flatten(p.style) ?? {};

  const background =
    typeof style.backgroundColor === "string" ? style.backgroundColor : options.background;

  const childOptions: ToA11yNodeOptions = { flatten: options.flatten, background };

  return {
    id: p.testID as string | undefined,
    type: ROLE_TO_TYPE[role ?? ""] ?? inferType(el),
    role,
    accessibleName:
      (p.accessibilityLabel as string | undefined) ??
      (p["aria-label"] as string | undefined) ??
      deepTextOf(el),
    accessibilityHint: p.accessibilityHint as string | undefined,
    accessible: p.accessible as boolean | undefined,
    hiddenFromAT:
      p.importantForAccessibility === "no-hide-descendants" ||
      p["aria-hidden"] === true ||
      p.accessibilityElementsHidden === true,
    interactive: isPressable(el),
    liveRegion: (p.accessibilityLiveRegion ?? p["aria-live"]) as A11yNode["liveRegion"],
    state: {
      disabled: (state.disabled ?? p.disabled) as boolean | undefined,
      selected: state.selected as boolean | undefined,
      checked: state.checked as boolean | "mixed" | undefined,
      busy: state.busy as boolean | undefined,
      expanded: state.expanded as boolean | undefined,
    },
    value: p.accessibilityValue as A11yNode["value"],
    text: textOf(el),
    size: sizeOf(style, p.hitSlop),
    colors: colorsOf(style, background),
    children: childrenOf(el).map((c) => toA11yNode(c, childOptions)),
  };
}

/**
 * Serialize an `@testing-library/react-native` render result.
 *
 * Prefer this over calling {@link toA11yNode} on a queried element so the whole
 * rendered screen is audited rather than one subtree.
 */
export function toA11yTree(rendered: RnRenderResult, options: ToA11yNodeOptions = {}): A11yNode {
  return toA11yNode(rendered.UNSAFE_root, options);
}

type FlatStyle = Record<string, unknown>;

/** Element children, with raw text nodes removed. */
function childrenOf(el: RnTestInstance): RnTestInstance[] {
  return (el.children ?? []).filter((c): c is RnTestInstance => typeof c !== "string");
}

/**
 * Touch-target size, when it can be known without a layout pass.
 *
 * `react-test-renderer` never lays anything out, so only explicitly declared
 * dimensions are available. Nodes sized purely by flex or padding return
 * `undefined`, and the touch-target rule skips them — verify those on-device
 * with the Accessibility Inspector / Accessibility Scanner instead.
 */
function sizeOf(style: FlatStyle, hitSlop?: unknown): { width: number; height: number } | undefined {
  const width = numeric(style.width);
  const height = numeric(style.height);
  if (width === undefined || height === undefined) return undefined;

  const slop = normalizeHitSlop(hitSlop);
  return {
    width: width + slop.left + slop.right,
    height: height + slop.top + slop.bottom,
  };
}

function normalizeHitSlop(hitSlop: unknown): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  if (typeof hitSlop === "number") {
    return { top: hitSlop, bottom: hitSlop, left: hitSlop, right: hitSlop };
  }
  if (hitSlop && typeof hitSlop === "object") {
    const h = hitSlop as Record<string, unknown>;
    return {
      top: numeric(h.top) ?? 0,
      bottom: numeric(h.bottom) ?? 0,
      left: numeric(h.left) ?? 0,
      right: numeric(h.right) ?? 0,
    };
  }
  return { top: 0, bottom: 0, left: 0, right: 0 };
}

function colorsOf(style: FlatStyle, background?: string): A11yNode["colors"] | undefined {
  const foreground = typeof style.color === "string" ? style.color : undefined;
  const fontSize = numeric(style.fontSize);
  const bold = isBold(style.fontWeight);

  if (!foreground && !background && fontSize === undefined && !bold) return undefined;
  return { foreground, background, fontSize, bold };
}

function isBold(fontWeight: unknown): boolean {
  if (fontWeight === "bold") return true;
  const weight = numeric(fontWeight);
  return weight !== undefined && weight >= 700;
}

function numeric(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value)) return Number(value);
  return undefined;
}

/** Best-effort element type from the component's name, for non-role'd nodes. */
function inferType(el: RnTestInstance): string {
  const type = el.type;
  const name =
    typeof type === "string"
      ? type
      : ((type as { displayName?: string; name?: string } | undefined)?.displayName ??
        (type as { name?: string } | undefined)?.name ??
        "view");
  if (/TextInput/i.test(name)) return "textinput";
  if (/Image/i.test(name)) return "image";
  if (/Text/i.test(name)) return "text";
  return "view";
}

function isPressable(el: RnTestInstance): boolean {
  const p = el.props ?? {};
  return Boolean(
    p.onPress ||
      p.onLongPress ||
      p.accessibilityRole === "button" ||
      p.role === "button" ||
      inferType(el) === "textinput",
  );
}

/** Text contributed directly by this node. */
function textOf(el: RnTestInstance): string | undefined {
  const strings = (el.children ?? []).filter((c): c is string => typeof c === "string");
  return strings.length ? strings.join(" ") : undefined;
}

/**
 * Text contributed by this node and all of its descendants.
 *
 * RN derives the accessible name of a pressable from its descendant text, so
 * `<Pressable><Text>Save</Text></Pressable>` must not read as unnamed.
 *
 * Whitespace is collapsed: text split across nested `<Text>` elements would
 * otherwise produce names like `"Hello  world"`, which screen readers announce
 * identically but which make names impossible to compare across runs.
 */
function deepTextOf(el: RnTestInstance): string | undefined {
  const parts: string[] = [];
  for (const child of el.children ?? []) {
    if (typeof child === "string") {
      parts.push(child);
    } else {
      const nested = deepTextOf(child);
      if (nested) parts.push(nested);
    }
  }
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return text.length ? text : undefined;
}
