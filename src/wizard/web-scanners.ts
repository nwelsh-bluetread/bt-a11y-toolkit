/**
 * The website scanners (axe-core, Lighthouse): which optional packages each
 * needs, which WCAG criteria each checks, and the up-front install offer.
 * Shared by the guided audit and the one-page quick scan.
 */
import { LIGHTHOUSE_AUDIT_MAP } from "../integrations/lighthouse.js";
import type { Prompter } from "./prompts.js";

export const SCANNERS = {
  axe: {
    label: "axe-core",
    packages: ["playwright", "@axe-core/playwright"],
    postInstall: ["npx", ["playwright", "install", "chromium"]] as const,
  },
  lighthouse: {
    label: "Lighthouse",
    packages: ["lighthouse", "chrome-launcher"],
    postInstall: undefined,
  },
} as const;

export type ScannerId = keyof typeof SCANNERS;

/** Criteria each web scanner has rules for (axe-core 4.x; Lighthouse runs a subset of axe). */
export const WEB_CHECKED: Record<ScannerId, string[]> = {
  axe: [
    "1.1.1", "1.2.2", "1.3.1", "1.3.4", "1.3.5", "1.4.1", "1.4.2", "1.4.3", "1.4.4", "1.4.12",
    "2.1.1", "2.2.1", "2.2.2", "2.4.1", "2.4.2", "2.4.4", "2.5.3", "2.5.8", "3.1.1", "3.1.2", "3.3.2", "4.1.2",
  ],
  lighthouse: [...new Set(Object.values(LIGHTHOUSE_AUDIT_MAP).flatMap((m) => m.wcag))],
};

export interface ScannerSetupDeps {
  prompter: Prompter;
  out: (text: string) => void;
  /** Whether an optional package can be imported. */
  hasModule: (name: string) => Promise<boolean>;
  /** Run a command in `cwd` with inherited stdio; resolves to the exit code. */
  runCommand: (cmd: string, args: string[]) => Promise<number>;
}

/** Check scanner packages up front (offering to install missing ones) so the automated run needs no prompts. */
export async function webScannersToRun(deps: ScannerSetupDeps): Promise<ScannerId[]> {
  const { prompter: p, out } = deps;
  const ready: ScannerId[] = [];
  const missing: ScannerId[] = [];
  for (const id of Object.keys(SCANNERS) as ScannerId[]) {
    const present = await Promise.all(SCANNERS[id].packages.map((pkg) => deps.hasModule(pkg)));
    (present.every(Boolean) ? ready : missing).push(id);
  }
  if (missing.length === 0) return ready;

  const pkgs = missing.flatMap((id) => [...SCANNERS[id].packages]);
  if (!(await p.confirm(`The website scanners need ${pkgs.join(", ")}. Install them as dev dependencies now?`, { default: true }))) {
    out(`Skipping ${missing.map((id) => SCANNERS[id].label).join(" and ")}. Install later with: npm install -D ${pkgs.join(" ")}`);
    return ready;
  }
  if ((await deps.runCommand("npm", ["install", "-D", ...pkgs])) !== 0) {
    out(`Install failed. Try manually: npm install -D ${pkgs.join(" ")}`);
    return ready;
  }
  for (const id of missing) {
    const post = SCANNERS[id].postInstall;
    if (post && (await deps.runCommand(post[0], [...post[1]])) !== 0) {
      out(`Setup failed. Try manually: ${post[0]} ${post[1].join(" ")}`);
      continue;
    }
    ready.push(id);
  }
  return ready;
}
