/**
 * Screen discovery for React Native projects.
 *
 * Finds the app's screens from its navigation code, then follows each screen's
 * local imports to learn which files it renders and what it contains (inputs,
 * images, video, gestures…). The guided audit uses this to attribute code-scan
 * findings to screens and to tailor each screen's manual checklist.
 *
 * Sources, in order of preference:
 * 1. React Navigation — `<Stack.Screen name="Login" component={LoginScreen} />`,
 *    `getComponent={() => require("./X").default}`, and static configs
 *    (`createNativeStackNavigator({ screens: { Home: HomeScreen } })`).
 * 2. expo-router — every route file under `app/` (or `src/app/`).
 * 3. Fallback — files in `screens/` / `pages/` folders or named `*Screen`.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import type * as TS from "typescript";
import type { ScreenFeature } from "../checklist.js";
import { listSourceFiles } from "./react-native.js";

export interface ScreenInfo {
  name: string;
  kind: "mobile" | "web";
  /** Screen entry file, relative to the project root (mobile). */
  file?: string;
  /** Local files the screen renders: entry + transitive imports, stopping at other screens. */
  files?: string[];
  /** What the screen contains, detected from code. Undefined when unknown (web pages, hand-added screens). */
  features?: ScreenFeature[];
  /** Page URL (web). */
  url?: string;
  /** From the context doc: where the screen sits, e.g. "Main bottom tabs › BillingTab". */
  group?: string;
  /** From the context doc: deep-link path to open the screen directly. */
  deepLink?: string;
  /** From the context doc's flow diagram: screens that lead here. */
  reachedFrom?: string[];
}

export interface ScreenDiscovery {
  screens: ScreenInfo[];
  method: "react-navigation" | "expo-router" | "folders" | "none";
}

type Ts = typeof TS;

const FEATURE_PATTERNS: Record<ScreenFeature, RegExp> = {
  inputs: /<(TextInput|Picker|Switch|CheckBox|Checkbox|Slider|RadioButton|DateTimePicker|SegmentedControl)\b/,
  images: /<(Image|ImageBackground|FastImage|Svg)\b|require\(\s*["'][^"']+\.(png|jpe?g|gif|webp|svg)["']\s*\)/,
  media: /<(Video|VideoView|Audio|YoutubePlayer|YoutubeIframe)\b|["'](expo-av|react-native-video|expo-video|expo-audio|react-native-track-player)["']/,
  gestures: /<(PanGestureHandler|PinchGestureHandler|RotationGestureHandler|GestureDetector|Swipeable|ReanimatedSwipeable|SwipeListView|DraggableFlatList)\b|\bonLongPress=|\bonSwipe\w*=|PanResponder\.create/,
  modals: /<(Modal|BottomSheet|BottomSheetModal|Dialog|ActionSheet)\b/,
  animation: /\bAnimated\.|react-native-reanimated|LottieView|lottie-react-native|["']moti["']/,
  auth: /secureTextEntry|(textContentType|autoComplete)=["'{]*\s*["']?(password|newPassword|current-password|new-password|oneTimeCode|one-time-code|sms-otp)/,
  status: /Toast|Snackbar|ActivityIndicator|showMessage|announceForAccessibility|accessibilityLiveRegion|isLoading|refreshing/,
  webview: /<WebView\b/,
};

export const FEATURE_LABEL: Record<ScreenFeature, string> = {
  inputs: "form inputs",
  images: "images",
  media: "audio/video",
  gestures: "gestures",
  modals: "modals",
  animation: "animation",
  auth: "sign-in",
  status: "loading/status messages",
  webview: "web views",
};

/** Detect features from the source of files that render UI (JSX). */
export function detectFeatures(texts: string[]): ScreenFeature[] {
  const ui = texts.filter((t) => JSX_TAG.test(t));
  return (Object.keys(FEATURE_PATTERNS) as ScreenFeature[]).filter((f) => ui.some((t) => FEATURE_PATTERNS[f].test(t)));
}

/** Rough "this file renders JSX" test — excludes translations, types, stores, and theme files. */
const JSX_TAG = /<[A-Z][\w.]*[\s/>]/;

/** A navigator component (its own child screens are listed separately). */
const NAVIGATOR = /<\w+\.(Navigator|Screen)\b|create\w*Navigator\(/;

export async function discoverScreens(root: string): Promise<ScreenDiscovery> {
  const ts = ((await import("typescript")) as { default: Ts }).default;
  const files = listSourceFiles(root);
  const rel = (abs: string) => relative(root, abs).split(sep).join("/");
  const resolver = makeResolver(ts, root);

  const sources = new Map<string, TS.SourceFile>();
  const source = (abs: string): TS.SourceFile | undefined => {
    if (sources.has(abs)) return sources.get(abs);
    let sf: TS.SourceFile | undefined;
    try {
      const kind = abs.endsWith(".tsx") ? ts.ScriptKind.TSX : abs.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JSX;
      sf = ts.createSourceFile(abs, readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true, kind);
    } catch {
      sf = undefined;
    }
    sources.set(abs, sf!);
    return sf;
  };

  // ── Find screen entries ────────────────────────────────────────────────────
  const found: Array<{ name: string; file?: string }> = [];
  let method: ScreenDiscovery["method"] = "none";

  for (const abs of files) {
    const sf = source(abs);
    if (!sf || !/Screen|Navigator/.test(sf.text)) continue;
    const imports = importBindings(ts, sf, resolver);
    const resolveIdent = (name: string): string | undefined => {
      const binding = imports.get(name);
      if (binding) return resolveExport(ts, binding.file, binding.exported, resolver, source) ?? binding.file;
      // Declared in the same file.
      return new RegExp(`(function|const|let|class)\\s+${name}\\b`).test(sf.text) ? abs : undefined;
    };
    const fromExpr = (expr: TS.Expression | undefined): string | undefined => {
      if (!expr) return undefined;
      if (ts.isIdentifier(expr)) return resolveIdent(expr.text);
      // getComponent={() => require("./X").default}
      const req = /require\(\s*["']([^"']+)["']\s*\)/.exec(expr.getText(sf));
      return req ? resolver(req[1]!, abs) : undefined;
    };

    const visit = (node: TS.Node) => {
      // <Stack.Screen name="Login" component={LoginScreen} />
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const tag = node.tagName.getText(sf);
        if (/(^|\.)Screen$/.test(tag)) {
          let name: string | undefined;
          let file: string | undefined;
          let hasComponent = false;
          for (const prop of node.attributes.properties) {
            if (!ts.isJsxAttribute(prop)) continue;
            const key = prop.name.getText(sf);
            const init = prop.initializer;
            const expr = init && ts.isJsxExpression(init) ? init.expression : undefined;
            if (key === "name") {
              if (init && ts.isStringLiteral(init)) name = init.text;
              else if (expr && (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr))) name = expr.text;
              else if (expr) name = expr.getText(sf).split(".").pop();
            }
            if (key === "component" || key === "getComponent") {
              hasComponent = true;
              file = fromExpr(expr);
              if (!name && expr && ts.isIdentifier(expr)) name = expr.text;
            }
          }
          if (name && hasComponent) found.push({ name, file });
        }
      }
      // createNativeStackNavigator({ screens: { Home: HomeScreen } }) and v4 createStackNavigator({ Home: HomeScreen })
      if (ts.isCallExpression(node) && /create\w*Navigator$/.test(node.expression.getText(sf))) {
        const arg = node.arguments[0];
        if (arg && ts.isObjectLiteralExpression(arg)) {
          const screensProp = arg.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === "screens");
          const map =
            screensProp && ts.isPropertyAssignment(screensProp) && ts.isObjectLiteralExpression(screensProp.initializer)
              ? screensProp.initializer
              : arg;
          for (const p of map.properties) {
            if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) continue;
            const name = p.name.getText(sf).replace(/^["']|["']$/g, "");
            let value: TS.Expression | undefined = ts.isPropertyAssignment(p) ? p.initializer : p.name;
            if (value && ts.isObjectLiteralExpression(value)) {
              const screen = value.properties.find((q) => ts.isPropertyAssignment(q) && q.name.getText(sf) === "screen");
              value = screen && ts.isPropertyAssignment(screen) ? screen.initializer : undefined;
            }
            const file = value && ts.isIdentifier(value) ? resolveIdent(value.text) : undefined;
            if (file) found.push({ name, file });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  if (found.length > 0) method = "react-navigation";

  // expo-router: route files under app/ or src/app/.
  if (found.length === 0) {
    const appDir = ["app", "src/app"].find((d) => existsSync(join(root, d)) && hasExpoRouter(root, d));
    if (appDir) {
      const prefix = `${appDir}/`;
      for (const abs of files) {
        const r = rel(abs);
        if (!r.startsWith(prefix)) continue;
        const route = r.slice(prefix.length).replace(/\.(tsx?|jsx?)$/, "");
        const last = route.split("/").pop()!;
        if (last.startsWith("_") || last.startsWith("+")) continue;
        const path = route
          .split("/")
          .filter((seg) => !/^\(.*\)$/.test(seg))
          .filter((seg, i, arr) => !(seg === "index" && i === arr.length - 1))
          .join("/");
        found.push({ name: `/${path}`, file: abs });
      }
      if (found.length > 0) method = "expo-router";
    }
  }

  // Fallback: screens/pages folders and *Screen files.
  if (found.length === 0) {
    for (const abs of files) {
      const r = rel(abs);
      const base = basename(r).replace(/\.(tsx?|jsx?)$/, "");
      const inFolder = /(^|\/)(screens|pages|views)\//i.test(r);
      if ((inFolder && base !== "index" && /^[A-Z]/.test(base)) || /Screen$/.test(base)) {
        found.push({ name: base.replace(/Screen$/, "") || base, file: abs });
      } else if (inFolder && base === "index" && /^[A-Z]/.test(basename(dirname(r)))) {
        found.push({ name: basename(dirname(r)).replace(/Screen$/, ""), file: abs });
      }
    }
    if (found.length > 0) method = "folders";
  }

  // Dedupe: same name, or same file under different names (keep the first name).
  // Nested navigators show up as "screens" too; their child screens are already listed.
  const unique: Array<{ name: string; file?: string }> = [];
  for (const s of found) {
    if (method === "react-navigation" && s.file && NAVIGATOR.test(source(s.file)?.text ?? "")) continue;
    if (unique.some((u) => u.name === s.name || (s.file && u.file === s.file))) continue;
    unique.push(s);
  }

  // ── Follow imports to find what each screen renders ────────────────────────
  const screenFiles = new Set(unique.map((s) => s.file).filter((f): f is string => Boolean(f)));
  const importCache = new Map<string, string[]>();
  const localImports = (abs: string): string[] => {
    if (importCache.has(abs)) return importCache.get(abs)!;
    const sf = source(abs);
    const out = sf ? importedFiles(ts, sf, resolver, source) : [];
    importCache.set(abs, out);
    return out;
  };

  const screens: ScreenInfo[] = unique.map((s) => {
    if (!s.file) return { name: s.name, kind: "mobile" };
    const seen = new Set<string>([s.file]);
    const queue = [s.file];
    while (queue.length > 0 && seen.size < 400) {
      for (const next of localImports(queue.shift()!)) {
        if (seen.has(next) || screenFiles.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    const closure = [...seen];
    return {
      name: s.name,
      kind: "mobile",
      file: rel(s.file),
      files: closure.map(rel).sort(),
      features: detectFeatures(closure.map((f) => source(f)?.text ?? "")),
    };
  });

  return { screens, method };
}

// ── Module resolution ────────────────────────────────────────────────────────

type Resolver = (spec: string, fromFile: string) => string | undefined;

/** Resolve import specifiers to local source files, honoring tsconfig/jsconfig paths and babel aliases. */
function makeResolver(ts: Ts, root: string): Resolver {
  let options: TS.CompilerOptions = {};
  const configName = ["tsconfig.json", "jsconfig.json"].find((n) => existsSync(join(root, n)));
  if (configName) {
    const read = ts.readConfigFile(join(root, configName), ts.sys.readFile);
    if (read.config) options = ts.parseJsonConfigFileContent(read.config, ts.sys, root).options;
  }
  options = {
    ...options,
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    moduleResolution: options.moduleResolution ?? ts.ModuleResolutionKind.Node10,
    moduleSuffixes: options.moduleSuffixes ?? [".native", ".ios", ".android", ""],
  };

  // babel-plugin-module-resolver aliases, e.g. alias: { "@": "./src" }.
  const babel = ["babel.config.js", ".babelrc", ".babelrc.js"].map((n) => join(root, n)).find(existsSync);
  if (babel) {
    const block = /alias\s*:\s*\{([\s\S]*?)\}/.exec(readFileSync(babel, "utf8"))?.[1];
    if (block) {
      const paths: Record<string, string[]> = { ...(options.paths ?? {}) };
      for (const m of block.matchAll(/["']?([@~\w/-]+)["']?\s*:\s*["']([^"']+)["']/g)) {
        const [alias, target] = [m[1]!, m[2]!.replace(/\/$/, "")];
        paths[`${alias}/*`] ??= [`${target}/*`];
        paths[alias] ??= [target];
      }
      options.paths = paths;
      options.baseUrl ??= root;
    }
  }

  const cache = new Map<string, string | undefined>();
  return (spec, fromFile) => {
    const key = `${dirname(fromFile)}\0${spec}`;
    if (cache.has(key)) return cache.get(key);
    let out: string | undefined;
    const r = ts.resolveModuleName(spec, fromFile, options, ts.sys).resolvedModule;
    if (r && !r.isExternalLibraryImport && !r.resolvedFileName.endsWith(".d.ts")) {
      const file = r.resolvedFileName;
      if (file.startsWith(root) && !file.includes(`${sep}node_modules${sep}`) && /\.(tsx?|jsx?)$/.test(file)) out = file;
    }
    cache.set(key, out);
    return out;
  };
}

function hasExpoRouter(root: string, appDir: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    if (pkg.dependencies?.["expo-router"] ?? pkg.devDependencies?.["expo-router"]) return true;
  } catch {
    // No package.json.
  }
  return ["_layout.tsx", "_layout.jsx", "_layout.js", "_layout.ts"].some((f) => existsSync(join(root, appDir, f)));
}

/** Imported identifier → the file and export name it comes from. */
function importBindings(ts: Ts, sf: TS.SourceFile, resolve: Resolver): Map<string, { file: string; exported: string }> {
  const out = new Map<string, { file: string; exported: string }>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier) || !stmt.importClause) continue;
    const file = resolve(stmt.moduleSpecifier.text, sf.fileName);
    if (!file) continue;
    const clause = stmt.importClause;
    if (clause.name) out.set(clause.name.text, { file, exported: "default" });
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) out.set(el.name.text, { file, exported: (el.propertyName ?? el.name).text });
    }
  }
  return out;
}

/** Follow barrel re-exports (`export { X } from "./X"`, `export * from "./X"`) to the defining file. */
function resolveExport(
  ts: Ts,
  file: string,
  name: string,
  resolve: Resolver,
  source: (abs: string) => TS.SourceFile | undefined,
  depth = 0,
): string | undefined {
  const sf = source(file);
  if (!sf || depth > 5) return undefined;
  if (name !== "default" && new RegExp(`export\\s+(default\\s+)?(async\\s+)?(function|const|let|var|class)\\s+${name}\\b`).test(sf.text)) {
    return file;
  }
  if (name === "default" && /export\s+default\b/.test(sf.text)) return file;
  for (const stmt of sf.statements) {
    // `import X from "./X"; export { X }` — follow the local import.
    if (ts.isExportDeclaration(stmt) && !stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      const el = stmt.exportClause.elements.find((e) => e.name.text === name);
      if (el) {
        const binding = importBindings(ts, sf, resolve).get((el.propertyName ?? el.name).text);
        if (binding) return resolveExport(ts, binding.file, binding.exported, resolve, source, depth + 1) ?? binding.file;
      }
      continue;
    }
    if (!ts.isExportDeclaration(stmt) || !stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const target = resolve(stmt.moduleSpecifier.text, file);
    if (!target) continue;
    const clause = stmt.exportClause;
    if (clause && ts.isNamedExports(clause)) {
      const el = clause.elements.find((e) => e.name.text === name);
      if (el) return resolveExport(ts, target, (el.propertyName ?? el.name).text, resolve, source, depth + 1) ?? target;
    } else if (!clause) {
      const hit = resolveExport(ts, target, name, resolve, source, depth + 1);
      if (hit) return hit;
    }
  }
  return undefined;
}

/**
 * The local files a file actually uses. Named and default imports are followed
 * to the file that defines each imported name, so importing one component from
 * a barrel (`import { Button } from "../components"`) doesn't pull in every
 * component the barrel re-exports. Namespace and side-effect imports, re-exports,
 * require(), and dynamic import() follow the whole module.
 */
function importedFiles(ts: Ts, sf: TS.SourceFile, resolve: Resolver, source: (abs: string) => TS.SourceFile | undefined): string[] {
  const out = new Set<string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const clause = stmt.importClause;
    if (clause?.isTypeOnly) continue;
    const file = resolve(stmt.moduleSpecifier.text, sf.fileName);
    if (!file) continue;
    const bindings = clause?.namedBindings;
    if (!clause || (bindings && ts.isNamespaceImport(bindings))) {
      out.add(file);
      continue;
    }
    const names: string[] = [];
    if (clause.name) names.push("default");
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) if (!el.isTypeOnly) names.push((el.propertyName ?? el.name).text);
    }
    for (const name of names) out.add(resolveExport(ts, file, name, resolve, source) ?? file);
  }
  for (const spec of moduleSpecifiers(ts, sf, { skipImports: true })) {
    const file = resolve(spec, sf.fileName);
    if (file) out.add(file);
  }
  return [...out];
}

/** Every module a file pulls in: imports, re-exports, require(), and dynamic import(). */
function moduleSpecifiers(ts: Ts, sf: TS.SourceFile, options: { skipImports?: boolean } = {}): string[] {
  const specs: string[] = [];
  const visit = (node: TS.Node) => {
    if (ts.isImportDeclaration(node) && options.skipImports) {
      // Handled precisely by importedFiles.
    } else if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specs.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(sf) === "require") &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specs.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return specs;
}

/** Screens for website pages, named by URL path. */
export function screensFromUrls(urls: string[]): ScreenInfo[] {
  return urls.map((url) => {
    let name = url;
    try {
      const u = new URL(url);
      name = `${u.pathname}${u.search}` || "/";
    } catch {
      // Not a URL — use as-is.
    }
    return { name, kind: "web", url };
  });
}

/** Whether a path is an existing file (helper for prompts). */
export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
