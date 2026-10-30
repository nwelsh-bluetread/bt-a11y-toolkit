/**
 * Which tool checks which WCAG criterion — read from the same mappings the
 * audit uses (scanner criteria lists, code-scan rules, the manual checklist),
 * so the reference document can't drift from what the toolkit actually does.
 */
import { MANUAL_CHECKLIST } from "./checklist.js";
import { RN_RULES } from "./code-scan/react-native.js";
import { LIGHTHOUSE_AUDIT_MAP } from "./integrations/lighthouse.js";
import type { WcagLevel } from "./types.js";
import { WCAG } from "./wcag.js";
import { WEB_CHECKED } from "./wizard/web-scanners.js";

export type ToolId = "axe" | "lighthouse" | "rn-code-scan" | "device-target-size";

export const TOOLS: Array<{ id: ToolId; name: string; platforms: string; run: string; about: string }> = [
  {
    id: "axe",
    name: "axe-core",
    platforms: "Web",
    run: "npx bt-a11y (website), npx bt-a11y quick <url>, npx bt-a11y axe <url>",
    about: "Loads each page in a browser (Playwright) and runs Deque's axe-core rules on the rendered page.",
  },
  {
    id: "lighthouse",
    name: "Lighthouse",
    platforms: "Web",
    run: "npx bt-a11y (website), npx bt-a11y quick <url>, npx bt-a11y lighthouse <url>",
    about: "Google's Lighthouse accessibility audits, a subset of axe-core's rules run in Chrome.",
  },
  {
    id: "rn-code-scan",
    name: "React Native code scan",
    platforms: "iOS + Android",
    run: "npx bt-a11y (mobile app), npx bt-a11y code",
    about: "Reads the app's source code, app.json, Info.plist and AndroidManifest.xml for patterns that break accessibility.",
  },
  {
    id: "device-target-size",
    name: "Device measurement",
    platforms: "Android",
    run: "npx bt-a11y target-size",
    about: "Measures the real size of every tappable control on a connected Android phone or emulator.",
  },
];

/** AAA criteria the code scan adds when the audit targets AAA. */
const RN_AAA_EXTRAS = ["1.4.6", "2.5.5"];

export function criteriaByTool(): Record<ToolId, Set<string>> {
  return {
    axe: new Set(WEB_CHECKED.axe),
    lighthouse: new Set(WEB_CHECKED.lighthouse),
    "rn-code-scan": new Set([...Object.values(RN_RULES).flatMap((r) => r.wcag), ...RN_AAA_EXTRAS]),
    "device-target-size": new Set(["2.5.8"]),
  };
}

export interface CriterionCoverage {
  id: string;
  name: string;
  level: WcagLevel;
  tools: ToolId[];
  /** Manual checklist coverage: which kinds of product have a check for it. */
  manual: Array<"web" | "mobile">;
}

export function toolCoverage(): CriterionCoverage[] {
  const byTool = criteriaByTool();
  return Object.values(WCAG)
    .sort((a, b) => compareIds(a.id, b.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      level: c.level,
      tools: TOOLS.map((t) => t.id).filter((t) => byTool[t].has(c.id)),
      manual: (["web", "mobile"] as const).filter((kind) => MANUAL_CHECKLIST.some((i) => i.wcag.includes(c.id) && i.appliesTo.includes(kind))),
    }));
}

/** Code-scan rules and Lighthouse audits with the criteria each maps to. */
export function toolRules(): { rn: Array<{ id: string; title: string; wcag: string[] }>; lighthouse: Array<{ id: string; wcag: string[] }> } {
  return {
    rn: Object.entries(RN_RULES).map(([id, r]) => ({ id, title: r.title, wcag: r.wcag })),
    lighthouse: Object.entries(LIGHTHOUSE_AUDIT_MAP).map(([id, m]) => ({ id, wcag: m.wcag })),
  };
}

export function compareIds(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}
