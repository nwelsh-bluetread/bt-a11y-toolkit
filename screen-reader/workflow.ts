// Screen reader workflows: JSON files in screen-reader/workflows/ that list
// the steps to take on a page with VoiceOver. See screen-reader/README.md.
import { readdirSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** VoiceOver "find next" commands a `find` step can use. */
export const FIND_COMMANDS = {
  heading: "findNextHeading",
  link: "findNextLink",
  control: "findNextControl",
  table: "findNextTable",
  list: "findNextList",
  graphic: "findNextGraphic",
} as const;

export type FindTarget = keyof typeof FIND_COMMANDS;

/** One step. Exactly one action key, plus an optional soft `expect`. */
export type WorkflowStep = (
  | { read: "page" }
  | { next: number }
  | { find: FindTarget }
  | { focus: string }
  | { type: string; into?: string }
  | { press: string }
  | { activate: string | true }
  | { wait: number }
) & {
  /** Text VoiceOver should say during this step. Reported, never stops the run. */
  expect?: string;
};

export interface Workflow {
  name: string;
  /** Full URL, or a path to a local HTML file relative to the workflow file. */
  url: string;
  steps: WorkflowStep[];
  /** Slug used for the transcript file name. */
  id: string;
}

const ACTIONS = ["read", "next", "find", "focus", "type", "press", "activate", "wait"] as const;
export type Action = (typeof ACTIONS)[number];

export function stepAction(step: WorkflowStep): Action {
  const found = ACTIONS.filter((a) => a in step);
  if (found.length !== 1) throw new Error(`Each step needs exactly one of ${ACTIONS.join(", ")}; got ${JSON.stringify(step)}`);
  return found[0];
}

/** A short readable label for a step, e.g. `type "a@b.com" into #email`. */
export function describeStep(step: WorkflowStep): string {
  const s = step as Record<string, unknown>;
  switch (stepAction(step)) {
    case "read": return "read page";
    case "next": return `next ×${s.next}`;
    case "find": return `find next ${s.find}`;
    case "focus": return `focus ${s.focus}`;
    case "type": return `type "${s.type}"${s.into ? ` into ${s.into}` : ""}`;
    case "press": return `press ${s.press}`;
    case "activate": return s.activate === true ? "activate current item" : `activate ${s.activate}`;
    case "wait": return `wait ${s.wait}ms`;
  }
}

function validate(raw: unknown, file: string): Omit<Workflow, "id"> {
  const wf = raw as Partial<Workflow>;
  const where = basename(file);
  if (!wf || typeof wf.name !== "string" || typeof wf.url !== "string" || !Array.isArray(wf.steps) || wf.steps.length === 0) {
    throw new Error(`${where}: a workflow needs "name", "url" and a non-empty "steps" list.`);
  }
  wf.steps.forEach((step, i) => {
    try {
      const action = stepAction(step);
      const value = (step as Record<string, unknown>)[action];
      if (action === "find" && !(String(value) in FIND_COMMANDS)) {
        throw new Error(`"find" must be one of ${Object.keys(FIND_COMMANDS).join(", ")}`);
      }
      if ((action === "next" || action === "wait") && typeof value !== "number") throw new Error(`"${action}" needs a number`);
    } catch (err) {
      throw new Error(`${where}, step ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return wf as Omit<Workflow, "id">;
}

/** Load every *.json workflow in a folder, sorted by file name. */
export function loadWorkflows(dir: string): Workflow[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const file = join(dir, f);
      const wf = validate(JSON.parse(readFileSync(file, "utf8")), file);
      const url = /^[a-z]+:\/\//i.test(wf.url) ? wf.url : pathToFileURL(isAbsolute(wf.url) ? wf.url : resolve(dir, wf.url)).href;
      return { ...wf, url, id: basename(f, ".json") };
    });
}

/** Drop VoiceOver's usage hints ("You are currently on…", "To click this button, press…"). */
export function stripHints(spoken: string): string {
  return spoken
    .replace(/\s*You are currently on [^.]*\./g, "")
    .replace(/\s*To [^.]*, press [^.]*\./g, "")
    .trim();
}
