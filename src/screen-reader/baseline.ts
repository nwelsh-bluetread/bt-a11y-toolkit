/**
 * Baseline screen reader workflows (read the whole page with VoiceOver, then
 * reload and Tab through every control) and the list of saved workflows, for
 * `bt-a11y sr baseline` and the guided audit's screen reader option.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

/** `https://example.com/account/settings` → `example-com-account-settings`. */
export function pageSlug(url: string): string {
  const u = new URL(url);
  return `${u.hostname}${u.pathname}`
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function baselineName(url: string): string {
  return `Baseline: ${url}`;
}

export function baselineWorkflow(url: string, session?: string) {
  return {
    name: baselineName(url),
    url,
    ...(session ? { session } : {}),
    steps: [{ read: "page" }, { goto: url }, { tab: "all" }],
  };
}

export interface WrittenBaseline {
  url: string;
  name: string;
  file: string;
  /** False when the file already existed and was kept (hand edits survive). */
  written: boolean;
}

export function writeBaselines(dir: string, urls: string[], opts: { force?: boolean; session?: string } = {}): WrittenBaseline[] {
  mkdirSync(dir, { recursive: true });
  return urls.map((url) => {
    const file = join(dir, `baseline-${pageSlug(url)}.json`);
    const keep = existsSync(file) && !opts.force;
    if (!keep) writeFileSync(file, JSON.stringify(baselineWorkflow(url, opts.session), null, 2) + "\n");
    else if (opts.session) addSession(file, opts.session);
    // A kept file may have been renamed by hand: run it under the name it has.
    const name = keep ? (readWorkflowName(file) ?? baselineName(url)) : baselineName(url);
    return { url, name, file, written: !keep };
  });
}

/** A kept workflow with no sign-in gets the one chosen now; one it already has is left alone. */
function addSession(file: string, session: string): void {
  try {
    const wf = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    if (wf.session) return;
    const { name, url, ...rest } = wf;
    writeFileSync(file, JSON.stringify({ name, url, session, ...rest }, null, 2) + "\n");
  } catch {
    // Unreadable: sr check reports it.
  }
}

function readWorkflowName(file: string): string | undefined {
  try {
    const name = (JSON.parse(readFileSync(file, "utf8")) as { name?: unknown }).name;
    return typeof name === "string" ? name : undefined;
  } catch {
    return undefined;
  }
}

/** Saved workflows in a folder: file name and workflow name, sorted by file. Unreadable files are skipped. */
export function listWorkflows(dir: string): Array<{ file: string; name: string }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => {
      const name = readWorkflowName(join(dir, f));
      return name ? [{ file: f, name }] : [];
    });
}

/**
 * Workflow files from paths the user gave (files or folders of *.json). Each must
 * be a workflow: a name, a url and a non-empty steps list. Returns an error
 * message instead when one isn't.
 */
export function findWorkflowFiles(paths: string[]): { files: Array<{ path: string; name: string }> } | { error: string } {
  const files: Array<{ path: string; name: string }> = [];
  for (const p of paths) {
    if (!existsSync(p)) return { error: `Not found: ${p}` };
    const list = statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith(".json")).sort().map((f) => join(p, f)) : [p];
    if (list.length === 0) return { error: `No .json workflow files in ${p}` };
    for (const file of list) {
      let wf: { name?: unknown; url?: unknown; steps?: unknown };
      try {
        wf = JSON.parse(readFileSync(file, "utf8")) as typeof wf;
      } catch {
        return { error: `${basename(file)} isn't valid JSON` };
      }
      if (typeof wf.name !== "string" || typeof wf.url !== "string" || !Array.isArray(wf.steps) || wf.steps.length === 0) {
        return { error: `${basename(file)} isn't a screen reader workflow (needs "name", "url" and "steps")` };
      }
      files.push({ path: file, name: wf.name });
    }
  }
  return { files };
}

/** Saved sign-in sessions (see `bt-a11y sr login`). */
export function listSessions(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
}

/** A Playwright `-g` pattern that runs exactly these workflows (it's a regular expression). */
export function grepFor(names: string[]): string {
  return names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
}
