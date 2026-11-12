/**
 * Where screen reader workflows, transcripts and saved sign-in sessions live.
 *
 * Run from the repo being audited (`bt-a11y sr …`), everything sits with the
 * audit, under a11y-audit/screen-reader/. Run inside the toolkit repo itself
 * (`npm run sr:test`), the toolkit's own demo layout is used: workflows in
 * screen-reader/workflows/, transcripts in reports/screen-reader/.
 *
 * The project folder is BT_A11Y_PROJECT (set by `bt-a11y sr`), else the
 * current directory.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface ScreenReaderPaths {
  root: string;
  workflows: string;
  transcripts: string;
  /** Saved sign-in sessions: live tokens, never committed. */
  sessions: string;
  /** Playwright's own output (traces, screenshots of failures). */
  testResults: string;
}

export function projectRoot(): string {
  return process.env.BT_A11Y_PROJECT || process.cwd();
}

/** The toolkit repo itself: it has the runner and its demo workflows. */
function isToolkitRepo(root: string): boolean {
  return existsSync(join(root, "screen-reader", "workflows.sr.ts"));
}

/** How to run a screen reader command where the user is: `npm run sr:test --` in the toolkit, `npx bt-a11y sr test` elsewhere. */
export function srCommand(name: string, root = projectRoot()): string {
  return isToolkitRepo(root) ? `npm run sr:${name} --` : `npx bt-a11y sr ${name}`;
}

/** Where the keyboard runner saves what it found per page/workflow (a11y-audit/keyboard/results/ in an audited repo). */
export function keyboardResultsDir(root = projectRoot()): string {
  return isToolkitRepo(root) ? join(root, "reports", "keyboard") : join(root, "a11y-audit", "keyboard", "results");
}

export function screenReaderPaths(root = projectRoot()): ScreenReaderPaths {
  if (isToolkitRepo(root)) {
    const reports = join(root, "reports", "screen-reader");
    return {
      root,
      workflows: join(root, "screen-reader", "workflows"),
      transcripts: reports,
      sessions: join(reports, "sessions"),
      testResults: join(reports, "test-results"),
    };
  }
  const base = join(root, "a11y-audit", "screen-reader");
  return {
    root,
    workflows: join(base, "workflows"),
    transcripts: join(base, "transcripts"),
    sessions: join(base, "sessions"),
    testResults: join(base, "test-results"),
  };
}
