import type { ScreenInfo } from "./code-scan/screens.js";

/**
 * Audit context: documents the team already has about the app (a navigation
 * map, a sitemap, flow notes) that shape the audit before anything runs.
 *
 * From a Markdown navigation map the toolkit reads:
 * - tables of screens — route name, screen component, deep link — grouped by
 *   the section heading and the tab/stack row they sit under ("↳" rows);
 * - Mermaid flowcharts — `A --> B` edges — to tell testers how each screen is
 *   reached.
 * Prose isn't interpreted; the files are copied into the audit folder and
 * linked from the checklist so testers can read them.
 */

export interface ContextScreen {
  /** Route name, as passed to navigate() — matches the name code discovery finds. */
  name: string;
  /** Where it sits, e.g. "Main bottom tabs › BillingTab". */
  group: string;
  /** Screen component path as written in the doc (may be abbreviated). */
  component?: string;
  deepLink?: string;
  /** Other groups the same route also appears in. */
  alsoIn?: string[];
}

export interface NavigationContext {
  screens: ContextScreen[];
  /** Directed edges from flow diagrams: from → to, with an optional condition label. */
  flows: Array<{ from: string; to: string; label?: string }>;
  /** Labels shown on flow nodes, e.g. Loading["Loading<br/>(LoginValidationStatus)"]. */
  nodeLabels: Record<string, string>;
}

const EMPTY = /^(—|-|–|n\/a|)$/i;

/** Parse every navigation table and flowchart in a Markdown document. */
export function parseNavigationMap(md: string): NavigationContext {
  const screens: ContextScreen[] = [];
  const flows: NavigationContext["flows"] = [];
  const nodeLabels: Record<string, string> = {};

  let section = "Screens";
  let header: { route: number; component: number; link: number } | undefined;
  let parent: string | undefined;
  /** A navigator's deep link goes to the screen it opens on ("opens on `Billing`"). */
  let opensOn: { screen: string; link: string } | undefined;
  let inMermaid = false;

  const add = (s: ContextScreen) => {
    const existing = screens.find((x) => x.name === s.name);
    if (!existing) screens.push(s);
    else if (existing.group !== s.group) existing.alsoIn = [...new Set([...(existing.alsoIn ?? []), s.group])];
  };

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();

    if (/^```mermaid/.test(line)) {
      inMermaid = true;
      continue;
    }
    if (inMermaid) {
      if (line.startsWith("```")) inMermaid = false;
      else parseMermaidLine(line, flows, nodeLabels);
      continue;
    }

    const heading = /^#{2,3}\s+(.+)$/.exec(line);
    if (heading) {
      section = cleanHeading(heading[1]!);
      header = undefined;
      parent = undefined;
      continue;
    }

    if (!line.startsWith("|")) {
      if (line) header = header && line.startsWith("|") ? header : undefined;
      continue;
    }
    const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // separator row

    if (!header) {
      header = headerColumns(cells);
      continue;
    }

    const first = cells[header.route] ?? "";
    const name = firstCode(first) ?? stripMd(first);
    if (!name) continue;
    const isChild = first.startsWith("↳");
    const isBold = /\*\*/.test(first);
    const component = header.component >= 0 ? cellValue(cells[header.component]) : undefined;
    const deepLink = header.link >= 0 ? cellValue(cells[header.link]) : undefined;
    const route = name.replace(/\s*→.*$/, "").trim();

    if (!isChild) parent = undefined;
    const group = isChild && parent ? `${section} › ${parent}` : section;

    if (!component) {
      // A navigator (tab, nested stack) — its "↳" rows are its screens.
      parent = route;
      const initial = /opens on `([^`]+)`/.exec(first)?.[1];
      opensOn = initial && deepLink ? { screen: initial, link: deepLink } : undefined;
      continue;
    }
    if (isBold && !isChild) parent = route;
    // A bold tab row that renders a screen directly ("**`Home`** | `Home`") is itself a screen.
    const link = deepLink ?? (isChild && opensOn?.screen === route ? opensOn.link : undefined);
    add({ name: route, group: isBold && !isChild ? `${section} › ${route}` : group, component, ...(link ? { deepLink: link } : {}) });
  }

  return { screens, flows, nodeLabels };
}

function headerColumns(cells: string[]): { route: number; component: number; link: number } {
  const find = (re: RegExp) => cells.findIndex((c) => re.test(c.toLowerCase()));
  const route = find(/route|screen name|tab|^name|screen$/);
  return {
    route: route >= 0 ? route : 0,
    component: find(/component|file|source/),
    link: find(/deep ?link|path|url|link/),
  };
}

function cleanHeading(text: string): string {
  return text
    .replace(/^\d+[.)]\s*/, "")
    .replace(/:\s*`[^`]*`.*$/, "")
    .replace(/`/g, "")
    .trim();
}

function firstCode(cell: string): string | undefined {
  return /`([^`]+)`/.exec(cell)?.[1]?.trim();
}

function stripMd(cell: string): string {
  return cell.replace(/[*_↳]/g, "").replace(/\(.*?\)/g, "").trim();
}

function cellValue(cell: string | undefined): string | undefined {
  if (cell === undefined) return undefined;
  const value = firstCode(cell) ?? stripMd(cell);
  return EMPTY.test(value) ? undefined : value.replace(/\\\*$|\*$/, "");
}

/** Read `A --> B`, `A -- "label" --> B`, `A <--> B`, and chains `A --> B --> C`. */
function parseMermaidLine(line: string, flows: NavigationContext["flows"], labels: Record<string, string>): void {
  if (!line || /^(flowchart|graph|subgraph|end\b|%%|classDef|style|class )/.test(line)) return;
  // Node definitions with labels anywhere on the line: Id["Label"], Id{{"Label"}}, Id(["Label"]).
  const NODE = /([A-Za-z0-9_]+)\s*[[({]+(?:"([^"]*)"|([^\])}]*))[\])}]+/g;
  for (const m of line.matchAll(NODE)) {
    labels[m[1]!] = (m[2] ?? m[3] ?? "").replace(/<br\s*\/?>/g, " ").replace(/\s+/g, " ").trim();
  }
  const simplified = line.replace(NODE, "$1");
  const tokens = simplified.split(/\s*(<-->|-->|--\s*"[^"]*"\s*-->|-\.->|==>)\s*/);
  for (let i = 1; i + 1 < tokens.length; i += 2) {
    const from = tokens[i - 1]!.trim();
    const arrow = tokens[i]!;
    const to = tokens[i + 1]!.trim();
    if (!/^[A-Za-z0-9_]+$/.test(from) || !/^[A-Za-z0-9_]+$/.test(to)) continue;
    const label = /"([^"]*)"/.exec(arrow)?.[1];
    flows.push({ from, to, ...(label ? { label } : {}) });
    if (arrow === "<-->") flows.push({ from: to, to: from });
  }
}

/** How a screen is reached, from the flow diagrams (node ids map to route names where they match). */
export function reachedFrom(ctx: NavigationContext, route: string): string[] {
  const id = Object.entries(ctx.nodeLabels).find(([, label]) => label === route || label.startsWith(`${route} `))?.[0];
  const targets = new Set([route, ...(id ? [id] : [])]);
  const sources = ctx.flows
    .filter((f) => targets.has(f.to))
    .map((f) => {
      const name = ctx.nodeLabels[f.from] ?? f.from;
      return f.label ? `${name} (${f.label})` : name;
    });
  return [...new Set(sources)];
}

/** Merge several parsed docs into one. */
export function mergeContexts(contexts: NavigationContext[]): NavigationContext {
  const merged: NavigationContext = { screens: [], flows: [], nodeLabels: {} };
  for (const c of contexts) {
    for (const s of c.screens) if (!merged.screens.some((m) => m.name === s.name)) merged.screens.push(s);
    merged.flows.push(...c.flows);
    Object.assign(merged.nodeLabels, c.nodeLabels);
  }
  return merged;
}

export const UNLISTED_GROUP = "Other screens (found in code, not in the context doc)";

/**
 * Combine the screens found in code with the context doc. The doc decides the
 * list, order, and grouping; code supplies files and features. Doc screens the
 * code scan didn't find are kept (contents unknown); code screens missing from
 * the doc are kept at the end under UNLISTED_GROUP.
 */
export function applyContext(code: ScreenInfo[], ctx: NavigationContext): ScreenInfo[] {
  if (ctx.screens.length === 0) return code;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const used = new Set<ScreenInfo>();

  const merged = ctx.screens.map((doc): ScreenInfo => {
    const byName = code.find((c) => !used.has(c) && norm(c.name) === norm(doc.name));
    // Fall back to the component path, e.g. "Billing/PayNow" → src/screens/Billing/PayNow/index.js.
    const component = doc.component && !doc.component.startsWith("…") ? doc.component : undefined;
    const byFile =
      byName ??
      (component
        ? code.find((c) => !used.has(c) && c.file && new RegExp(`(^|/)${component.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(/index)?\\.[jt]sx?$`).test(c.file))
        : undefined);
    if (byFile) used.add(byFile);
    const from = reachedFrom(ctx, doc.name);
    return {
      ...(byFile ?? { kind: "mobile" as const }),
      name: doc.name,
      group: doc.group,
      ...(doc.deepLink ? { deepLink: doc.deepLink } : {}),
      ...(from.length ? { reachedFrom: from } : {}),
    };
  });

  const unlisted = code.filter((c) => !used.has(c)).map((c) => ({ ...c, group: UNLISTED_GROUP }));
  return [...merged, ...unlisted];
}
