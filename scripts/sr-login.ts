#!/usr/bin/env node
/**
 * Sign in to a site by hand and save the session for screen reader workflows.
 *
 * Opens a browser at <url>. Sign in (MFA, popups and all), and once you can
 * see the signed-in app, close the browser window. The session is saved to
 * reports/screen-reader/sessions/<name>.json; use it in a workflow with
 * `"session": "<name>"`.
 *
 * Usage:
 *   npm run sr:login -- <url> [--name <name>]
 */
import { chromium } from "playwright";
import { srCommand } from "../src/screen-reader/paths.js";
import { captureSession, defaultSessionName, sessionPath, writeSession, type SavedSession } from "../screen-reader/session.js";

async function main() {
  const args = process.argv.slice(2);
  const url = args.find((a) => /^https?:\/\//.test(a));
  if (!url) {
    console.error(`Usage: ${srCommand("login")} <url> [--name <name>]`);
    process.exit(1);
  }
  const nameIdx = args.indexOf("--name");
  const name = nameIdx >= 0 && args[nameIdx + 1] ? args[nameIdx + 1]! : defaultSessionName(url);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  await page.goto(url);
  console.log(`Sign in in the browser window. When you can see the signed-in app, close the window (it saves as you go).\nSaving to ${sessionPath(name)}`);

  // Snapshot every couple of seconds and save each change, so the file exists
  // as soon as sign-in finishes (closing the window just ends the script).
  let last: SavedSession | undefined;
  let lastKey = "";
  const timer = setInterval(async () => {
    const snap = await captureSession(page).catch(() => undefined);
    if (!snap || new URL(snap.origin).host !== new URL(url).host) return;
    last = snap;
    const key = JSON.stringify([snap.sessionStorage, snap.localStorage]);
    if (key !== lastKey) {
      lastKey = key;
      writeSession(name, snap);
    }
  }, 2000);

  await new Promise<void>((done) => {
    page.on("close", () => done());
    browser.on("disconnected", () => done());
  });
  clearInterval(timer);
  await browser.close().catch(() => {});

  if (!last) {
    console.error("Nothing to save: the page had no cookies or storage. Did the sign-in finish?");
    process.exit(1);
  }
  writeSession(name, last);
  console.log(`Saved session "${name}" (${Object.keys(last.sessionStorage).length} sessionStorage, ${Object.keys(last.localStorage).length} localStorage, ${last.cookies.length} cookies).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
