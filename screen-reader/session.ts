// Saved sign-in sessions for screen reader workflows.
//
// `npm run sr:login -- <url>` saves cookies, localStorage *and* sessionStorage
// for the site after you sign in by hand. Playwright's own storageState skips
// sessionStorage, which is where apps using MSAL (and many SPAs) keep tokens.
// A workflow with `"session": "<name>"` gets them back before the page loads.
//
// Session files hold live tokens. Their folder gets a .gitignore that ignores everything.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { screenReaderPaths, srCommand } from "../src/screen-reader/paths.js";
import type { BrowserContext, Cookie, Page } from "playwright";

export interface SavedSession {
  origin: string;
  savedAt: string;
  cookies: Cookie[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

export function sessionPath(name: string): string {
  return join(screenReaderPaths().sessions, `${name}.json`);
}

/** Session name from a URL, e.g. http://localhost:5173/x → "localhost-5173". */
export function defaultSessionName(url: string): string {
  return new URL(url).host.replace(/[^a-z0-9]+/gi, "-");
}

/** Read the page's storage. Empty storage returns undefined so a bad snapshot never overwrites a good one. */
export async function captureSession(page: Page): Promise<SavedSession | undefined> {
  // No named functions inside evaluate(): tsx wraps them in __name(), which doesn't exist in the page.
  const storage = await page.evaluate(() => ({
    origin: location.origin,
    localStorage: Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)!])),
    sessionStorage: Object.fromEntries(Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k)!])),
  }));
  if (!/^https?:/.test(storage.origin)) return undefined;
  if (Object.keys(storage.sessionStorage).length + Object.keys(storage.localStorage).length === 0) return undefined;
  return { ...storage, savedAt: new Date().toISOString(), cookies: await page.context().cookies() };
}

export function writeSession(name: string, session: SavedSession): void {
  const file = sessionPath(name);
  mkdirSync(dirname(file), { recursive: true });
  // The audit folder may be committed; session files hold live tokens.
  const ignore = join(dirname(file), ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "# Saved sign-in sessions hold live tokens: never commit them.\n*\n");
  writeFileSync(file, JSON.stringify(session, null, 2), { mode: 0o600 });
}

export function loadSession(name: string): SavedSession {
  const file = sessionPath(name);
  if (!existsSync(file)) {
    throw new Error(`No saved session "${name}". Sign in first: ${srCommand("login")} <url> --name ${name}`);
  }
  return JSON.parse(readFileSync(file, "utf8")) as SavedSession;
}

/**
 * Restore a saved session into a browser context. Call before the first goto.
 * Storage is written once per tab, so tokens the app refreshes later aren't
 * overwritten on the next navigation.
 */
export async function applySession(context: BrowserContext, name: string): Promise<SavedSession> {
  const session = loadSession(name);
  if (session.cookies.length) await context.addCookies(session.cookies);
  await context.addInitScript((s: Pick<SavedSession, "origin" | "localStorage" | "sessionStorage">) => {
    if (location.origin !== s.origin || sessionStorage.getItem("__srSessionRestored")) return;
    for (const [k, v] of Object.entries(s.localStorage)) localStorage.setItem(k, v);
    for (const [k, v] of Object.entries(s.sessionStorage)) sessionStorage.setItem(k, v);
    sessionStorage.setItem("__srSessionRestored", "1");
  }, { origin: session.origin, localStorage: session.localStorage, sessionStorage: session.sessionStorage });
  return session;
}
