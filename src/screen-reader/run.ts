/**
 * `bt-a11y sr <command>`: the screen reader tools, run from the repo being
 * audited. Workflows, transcripts and saved sessions live in that repo under
 * a11y-audit/screen-reader/ (see paths.ts); the runner itself ships with the
 * toolkit.
 *
 *   test       run the workflows with real VoiceOver (Playwright + Guidepup)
 *   login      sign in by hand and save the session for workflows
 *   inspect    list a page's controls with their accessible names and selectors
 *   check      validate the workflow files (--selectors: against the live pages)
 *   baseline   write a read + Tab-through workflow for each page
 *   findings   turn the transcripts into audit findings (= bt-a11y screen-reader)
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { screenReaderPaths } from "./paths.js";

/** The toolkit package: two levels up from src/screen-reader/ or dist/screen-reader/. */
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SCRIPTS: Record<string, string> = {
  login: "sr-login.ts",
  inspect: "sr-inspect.ts",
  check: "sr-check.ts",
  baseline: "sr-baseline.ts",
};

const INSTALL_HINT =
  "The screen reader tools need these in the repo you're auditing (one time):\n" +
  "  npm install -D @guidepup/playwright @playwright/test playwright tsx\n" +
  "and VoiceOver set up for automation on this Mac (one time): npx @guidepup/setup\n";

export const SR_HELP = `bt-a11y sr <command> — VoiceOver screen reader testing (macOS)

Run these from the repo you're auditing. Files live in a11y-audit/screen-reader/:
workflows/ (what to do on each page), transcripts/ (what VoiceOver said),
sessions/ (saved sign-ins, never committed).

  bt-a11y sr test [-g <name>]          Run every workflow with VoiceOver (hands off the Mac)
  bt-a11y sr findings                  Turn the transcripts into audit findings
  bt-a11y sr login <url> [--name <n>]  Sign in by hand, save the session for workflows
  bt-a11y sr inspect <url> [--session <n>]  List the page's controls and selectors
  bt-a11y sr check [--selectors]       Validate the workflow files
  bt-a11y sr baseline [<url> ...] [--session <n>]  Write a read + Tab-through workflow per page
                                       (default: the audit's pages, or ./urls.txt)

The guided audit (npx bt-a11y → Screen reader test) runs these for you.
`;

/** Resolve a package from the audited repo first, then from the toolkit's own dependencies. */
function resolveFrom(id: string, cwd: string): string | undefined {
  for (const base of [cwd, PKG_ROOT]) {
    try {
      return createRequire(join(base, "noop.js")).resolve(id);
    } catch {
      // Try the next place.
    }
  }
  return undefined;
}

function run(cmd: string, args: string[], cwd: string): Promise<number> {
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, BT_A11Y_PROJECT: cwd } });
    child.on("error", (err) => {
      process.stderr.write(`${err.message}\n`);
      done(1);
    });
    child.on("exit", (code) => done(code ?? 1));
  });
}

/**
 * Playwright doesn't compile TypeScript inside node_modules, so when the toolkit
 * is an installed package its runner is copied next to the audit first. Package
 * imports (@guidepup/playwright…) then resolve from the audited repo.
 */
function runnerDir(base: string): string {
  if (!PKG_ROOT.split(sep).includes("node_modules")) return join(PKG_ROOT, "screen-reader");
  const dest = join(base, ".runner");
  rmSync(dest, { recursive: true, force: true });
  cpSync(join(PKG_ROOT, "screen-reader"), join(dest, "screen-reader"), {
    recursive: true,
    // The toolkit's own demo workflows and pages aren't part of the runner.
    filter: (src) => !["workflows", "fixtures", "README.md"].includes(basename(src)),
  });
  cpSync(join(PKG_ROOT, "src", "screen-reader"), join(dest, "src", "screen-reader"), { recursive: true });
  return join(dest, "screen-reader");
}

/** Folders for the audited repo, with a .gitignore for the parts that shouldn't be committed. */
function prepare(cwd: string): ReturnType<typeof screenReaderPaths> {
  const paths = screenReaderPaths(cwd);
  mkdirSync(paths.workflows, { recursive: true });
  const base = dirname(paths.workflows);
  const ignore = join(base, ".gitignore");
  if (base.endsWith(join("a11y-audit", "screen-reader")) && !existsSync(ignore)) {
    writeFileSync(ignore, "# Saved sign-ins hold live tokens; the rest is regenerated on every run.\nsessions/\ntest-results/\n.runner/\n");
  }
  return paths;
}

export async function runSr(argv: string[], findings: () => Promise<void>): Promise<void> {
  const [command, ...rest] = argv;
  const cwd = process.cwd();
  if (!command || command === "help" || rest.includes("-h") || rest.includes("--help")) {
    process.stdout.write(SR_HELP);
    return;
  }
  if (command === "findings") return findings();

  if (command === "test") {
    const cli = resolveFrom("@playwright/test/cli", cwd);
    if (!cli || !resolveFrom("@guidepup/playwright", cwd)) {
      process.stderr.write(INSTALL_HINT);
      process.exitCode = 1;
      return;
    }
    const paths = prepare(cwd);
    const config = join(runnerDir(dirname(paths.workflows)), "playwright.config.ts");
    if (!rest.includes("--list")) process.stdout.write(`Workflows: ${paths.workflows}\nTranscripts: ${paths.transcripts}\nVoiceOver is about to take over the Mac: keep hands off the keyboard and mouse.\n\n`);
    process.exitCode = await run(process.execPath, [cli, "test", "-c", config, ...rest], cwd);
    if (process.exitCode !== 0) process.stdout.write(`\nSome steps failed or expected announcements weren't heard (listed above). Transcripts are saved either way.\n`);
    process.stdout.write(`Next: npx bt-a11y sr findings\n`);
    return;
  }

  const script = SCRIPTS[command];
  if (!script) {
    process.stderr.write(`Unknown screen reader command: ${command}\n\n${SR_HELP}`);
    process.exitCode = 1;
    return;
  }
  const tsx = resolveFrom("tsx/cli", cwd);
  if (!tsx || !resolveFrom("playwright", cwd)) {
    process.stderr.write(INSTALL_HINT);
    process.exitCode = 1;
    return;
  }
  prepare(cwd);
  process.exitCode = await run(process.execPath, [tsx, join(PKG_ROOT, "scripts", script), ...rest], cwd);
}
