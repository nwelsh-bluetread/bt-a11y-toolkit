/**
 * Minimal WCAG relative-luminance contrast utilities. No dependencies so this
 * can run anywhere (CI, RN metro, browser).
 */

/** Parse a hex color (#rgb, #rrggbb, #rrggbbaa) into [r,g,b] 0-255. */
export function parseHex(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  const num = parseInt(h, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Relative luminance per WCAG 2.x. */
export function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two hex colors (1..21), or null if unparseable. */
export function contrastRatio(fg: string, bg: string): number | null {
  const f = parseHex(fg);
  const b = parseHex(bg);
  if (!f || !b) return null;
  const l1 = luminance(f);
  const l2 = luminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Whether text is "large" per WCAG (>=18pt, or >=14pt bold). */
export function isLargeText(fontSize?: number, bold?: boolean): boolean {
  if (fontSize == null) return false;
  return fontSize >= 18 || (fontSize >= 14 && Boolean(bold));
}

/** Minimum required contrast ratio for a given level and text size. */
export function requiredContrast(level: "AA" | "AAA", large: boolean): number {
  if (level === "AAA") return large ? 4.5 : 7;
  return large ? 3 : 4.5;
}
