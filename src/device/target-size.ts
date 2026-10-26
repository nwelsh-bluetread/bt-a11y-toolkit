/**
 * WCAG 2.5.8 Target Size (Minimum), measured on a running Android app.
 *
 * `uiautomator dump` gives every view's on-screen bounds in pixels. Tappable
 * views from the app are converted to dp (px ÷ density/160) and checked
 * against 24×24. Smaller targets still pass under the spacing exception: a
 * 24 dp circle centered on each one must not overlap another target, or
 * another small target's circle.
 *
 *   parseUiDump    XML → a tree of views
 *   measureTargets the app's tappable views, sized in dp, each pass / spaced / fail
 *   targetFindings failures as report findings, attached to the screen by name
 */
import type { Finding } from "../types.js";
import { WCAG } from "../wcag.js";

export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface UiNode {
  text: string;
  desc: string;
  resourceId: string;
  className: string;
  pkg: string;
  clickable: boolean;
  enabled: boolean;
  scrollable: boolean;
  /** False when uiautomator reports the view as not visible to the user. */
  visible: boolean;
  bounds: Rect;
  parent?: UiNode;
  children: UiNode[];
}

export interface MeasuredTarget {
  label: string;
  widthDp: number;
  heightDp: number;
  bounds: Rect;
  /** pass: at least the minimum · spaced: smaller, but far enough from other targets · fail */
  result: "pass" | "spaced" | "fail";
}

export interface ScreenMeasurement {
  targets: MeasuredTarget[];
  /** Tappable views left out because they're cut off by a scroll container or the screen edge. */
  clipped: number;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m),
  );

/** Parse `uiautomator dump` XML into a tree; returns the top-level nodes. */
export function parseUiDump(xml: string): UiNode[] {
  const roots: UiNode[] = [];
  const stack: UiNode[] = [];
  for (const m of xml.matchAll(/<node\b([^>]*?)(\/?)>|<\/node>/g)) {
    if (m[0] === "</node>") {
      stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[1]!.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]!] = decode(a[2]!);
    const b = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(attrs.bounds ?? "");
    const node: UiNode = {
      text: attrs.text ?? "",
      desc: attrs["content-desc"] ?? "",
      resourceId: attrs["resource-id"] ?? "",
      className: attrs.class ?? "",
      pkg: attrs.package ?? "",
      clickable: attrs.clickable === "true" || attrs["long-clickable"] === "true",
      enabled: attrs.enabled !== "false",
      scrollable: attrs.scrollable === "true",
      visible: attrs["visible-to-user"] !== "false",
      bounds: b ? { x1: +b[1]!, y1: +b[2]!, x2: +b[3]!, y2: +b[4]! } : { x1: 0, y1: 0, x2: 0, y2: 0 },
      parent: stack.at(-1),
      children: [],
    };
    (node.parent ? node.parent.children : roots).push(node);
    if (m[2] !== "/") stack.push(node);
  }
  return roots;
}

function* walk(nodes: UiNode[]): Generator<UiNode> {
  for (const n of nodes) {
    yield n;
    yield* walk(n.children);
  }
}

const width = (r: Rect) => r.x2 - r.x1;
const height = (r: Rect) => r.y2 - r.y1;
const contains = (a: Rect, b: Rect) => a.x1 <= b.x1 && a.y1 <= b.y1 && a.x2 >= b.x2 && a.y2 >= b.y2;

/** What a screen reader would call it: its own text, or its children's. */
function labelOf(n: UiNode): string {
  const own = n.desc || n.text;
  if (own) return own.trim();
  for (const c of walk(n.children)) if (c.desc || c.text) return (c.desc || c.text).trim();
  const id = n.resourceId.split("/").pop();
  return id || n.className.split(".").pop() || "unlabeled control";
}

/**
 * Bounds are clipped to what's visible, so a control half scrolled out of a
 * scroll container looks small. Which sides clip depends on the scroll direction.
 */
function clippedAxes(n: UiNode): { x: boolean; y: boolean } {
  const out = { x: false, y: false };
  for (let p = n.parent; p; p = p.parent) {
    if (!p.scrollable) continue;
    if (/Horizontal|ViewPager/i.test(p.className)) out.x ||= n.bounds.x1 <= p.bounds.x1 || n.bounds.x2 >= p.bounds.x2;
    else out.y ||= n.bounds.y1 <= p.bounds.y1 || n.bounds.y2 >= p.bounds.y2;
  }
  return out;
}

/** Distance from a point to the nearest point of a rectangle (0 inside it). */
function distanceToRect(x: number, y: number, r: Rect): number {
  const dx = Math.max(r.x1 - x, 0, x - r.x2);
  const dy = Math.max(r.y1 - y, 0, y - r.y2);
  return Math.hypot(dx, dy);
}

export function measureTargets(roots: UiNode[], options: { pkg: string; density: number; minDp?: number }): ScreenMeasurement {
  const min = options.minDp ?? 24;
  const scale = options.density / 160;
  const all = [...walk(roots)];

  let clipped = 0;
  const seen = new Set<string>();
  const nodes: UiNode[] = [];
  for (const n of all) {
    if (!n.clickable || !n.enabled || !n.visible || n.pkg !== options.pkg) continue;
    if (width(n.bounds) <= 0 || height(n.bounds) <= 0) continue;
    const key = `${n.bounds.x1},${n.bounds.y1},${n.bounds.x2},${n.bounds.y2}`;
    if (seen.has(key)) continue; // a touchable wrapping a touchable of the same size is one target
    seen.add(key);
    // Only skip it when the clipping is what makes it look too small.
    const cut = clippedAxes(n);
    if ((cut.x && width(n.bounds) / scale < min) || (cut.y && height(n.bounds) / scale < min)) {
      clipped++;
      continue;
    }
    nodes.push(n);
  }

  // Work in dp from here on.
  const dp = nodes.map((n) => ({
    node: n,
    rect: { x1: n.bounds.x1 / scale, y1: n.bounds.y1 / scale, x2: n.bounds.x2 / scale, y2: n.bounds.y2 / scale },
  }));
  const small = new Set(dp.filter((t) => width(t.rect) < min || height(t.rect) < min));
  const center = (r: Rect) => [(r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2] as const;

  const targets = dp.map((t): MeasuredTarget => {
    const w = Math.round(width(t.rect) * 10) / 10;
    const h = Math.round(height(t.rect) * 10) / 10;
    const base = { label: labelOf(t.node), widthDp: w, heightDp: h, bounds: t.node.bounds };
    if (!small.has(t)) return { ...base, result: "pass" };
    const [cx, cy] = center(t.rect);
    const crowded = dp.some((o) => {
      // A target nested in another is part of the same control, not a neighbor.
      if (o === t || contains(o.rect, t.rect) || contains(t.rect, o.rect)) return false;
      if (small.has(o)) {
        const [ox, oy] = center(o.rect);
        return Math.hypot(cx - ox, cy - oy) < min;
      }
      return distanceToRect(cx, cy, o.rect) < min / 2;
    });
    return { ...base, result: crowded ? "fail" : "spaced" };
  });
  return { targets, clipped };
}

export const TARGET_RULE = "device-target-size";

export function targetFindings(screen: string, m: ScreenMeasurement, minDp = 24): Finding[] {
  return m.targets
    .filter((t) => t.result === "fail")
    .map((t) => ({
      ruleId: TARGET_RULE,
      title: `Touch target smaller than ${minDp}×${minDp} dp — ${screen}`,
      description: `"${t.label}" measures ${t.widthDp}×${t.heightDp} dp on the device and is too close to other controls for the spacing exception.`,
      severity: "medium" as const,
      wcag: [WCAG["2.5.8"]!],
      nodeId: `"${t.label}" ${t.widthDp}×${t.heightDp}dp`,
      platforms: ["android" as const],
      category: "Touch Targets",
      source: "device",
      remediation: `Make it at least ${minDp}×${minDp} dp (minWidth/minHeight or padding), or move it away from neighboring controls. hitSlop also counts, but doesn't show in the measurement, so re-check by hand if it's set.`,
      evidence: { screen, label: t.label, widthDp: t.widthDp, heightDp: t.heightDp, bounds: t.bounds },
    }));
}

/** One line for the checklist and terminal, e.g. "18 targets, all at least 24×24 dp or spaced apart". */
export function measurementSummary(m: ScreenMeasurement, minDp = 24): string {
  const fails = m.targets.filter((t) => t.result === "fail").length;
  const n = m.targets.length;
  if (n === 0) return "no tappable controls found";
  return fails ? `${fails} of ${n} targets too small` : `${n} target${n === 1 ? "" : "s"}, all at least ${minDp}×${minDp} dp or spaced apart`;
}
