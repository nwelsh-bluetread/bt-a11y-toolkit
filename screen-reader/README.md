# Screen reader workflows

Runs real VoiceOver (macOS) through scripted steps on a page and saves what it
said. Built on [Guidepup](https://www.guidepup.dev/) + Playwright.

## From the repo you're auditing

Run everything from the client repo; no need to `cd` into the toolkit.

```bash
# One time per repo, and one time per Mac:
npm install -D @guidepup/playwright @playwright/test playwright tsx
npx @guidepup/setup

npx bt-a11y sr baseline            # a read + Tab-through workflow for each audit page
npx bt-a11y sr test                # run every workflow
npx bt-a11y sr test -g "Login"     # only workflows whose name contains "Login"
npx bt-a11y sr findings            # turn the transcripts into audit findings
npx bt-a11y sr                     # all commands (login, inspect, check…)
```

Or run `npx bt-a11y` and pick **Screen reader test (VoiceOver)**: it asks
whether to test every page in the audit, one page, or saved workflows, offers
any saved sign-in, runs VoiceOver, then adds the findings to the checklist.

Files live with the audit, in `a11y-audit/screen-reader/`:

| Folder | What's in it | Commit it? |
| --- | --- | --- |
| `workflows/` | the workflow JSON files | yes |
| `transcripts/` | what VoiceOver said, one file per workflow | your call |
| `sessions/` | saved sign-ins (live tokens) | never (gitignored) |

Keep hands off the keyboard and mouse while it runs: VoiceOver drives the whole Mac.

## Inside the toolkit repo

The same commands also run as `npm run sr:<command>` in the toolkit itself, on
its demo pages: workflows in `screen-reader/workflows/`, transcripts in
`reports/screen-reader/`. The examples below use `npx bt-a11y sr <command>`; in
the toolkit, write `npm run sr:<command> --` instead.

## Recording issues

```bash
npx bt-a11y sr test        # run the workflows, save transcripts
npx bt-a11y sr findings    # turn the transcripts into findings
```

`sr findings` checks every transcript for: controls with no accessible name or
that say nothing on focus, checkbox/switch state not announced, dropdowns,
menu buttons and accordions that don't say "expanded"/"collapsed" or don't
open or close when activated, unclear or duplicate link text, images read as a file name or "unlabelled", skipped or
missing headings, Tab order going backwards, positive tabindex, focus cycling
inside the page, controls Tab never reaches, and `expect`s that weren't heard.

With a guided audit (`bt-a11y start`), each finding pre-fills its checklist line
on that page as **"scan found issues · not reviewed yet"**. The auditor opens
`bt-a11y checklist` and confirms or dismisses each one; details with the exact
words VoiceOver said are in `a11y-audit/scan-details.md`. Without an audit, it
prints a report. Re-running replaces the earlier screen reader findings.

For judgment calls the rules can't make (meaningless alt text, vague error
messages, labels that don't match what's on screen), ask Claude to review the
transcripts, e.g. `/sr-workflow review the latest run`. It writes
`<workflow>.review.json` next to each transcript, and `sr findings` adds those
too, marked as AI findings.

An `activate` step on anything with `aria-expanded` (or a `<details>` summary)
records whether it was open before and after; the console shows it as
`collapsed → expanded`. `fixtures/dropdowns.html` has a working and a broken
dropdown to try it on.

A failed `expect` is filed under 4.1.3 after an action (activate, press, type,
wait, goto) and 4.1.2 otherwise. Add `"wcag": ["3.3.1"]` to the step to choose.

## Writing a workflow

Add a JSON file to `a11y-audit/screen-reader/workflows/`. One file = one workflow = one transcript.

```json
{
  "name": "Checkout: apply a bad promo code",
  "url": "https://staging.example.com/checkout",
  "steps": [
    { "read": "page" },
    { "type": "BADCODE", "into": "#promo" },
    { "activate": "button.apply", "expect": "not valid" }
  ]
}
```

`url` is a full URL, or a path to a local HTML file relative to the workflow file.

Selectors can be CSS (`#email`) or Playwright role selectors (`role=button[name="Sign in"]`).

## Generating workflows

- **Baselines for every page:** `npx bt-a11y sr baseline` writes `workflows/baseline-<page>.json` for each page in the guided audit (else each URL in `urls.txt`) (or pass URLs, `--urls <file>`, `--sitemap <url>`). Each one reads the whole page, then Tabs through every control. Existing files are kept unless you pass `--force`.
- **From a description:** in Claude Code, ask for a workflow, e.g. `/sr-workflow https://staging.example.com/login sign in with a wrong password and check the error is announced`. The skill inspects the page, writes the file and validates it.

Helpers:

```bash
npx bt-a11y sr inspect <url>          # accessibility tree + a unique selector for every control
npx bt-a11y sr check                 # validate all workflow files (no VoiceOver needed)
npx bt-a11y sr check --selectors      # ...and check each selector matches one element
```

### Steps

Each step has exactly one action, plus an optional `expect`.

| Step | What it does |
|---|---|
| `{ "read": "page" }` | Moves through every item to the end of the page (VO+→ repeatedly) |
| `{ "next": 3 }` | Moves to the next item, N times |
| `{ "tab": "all" }` | Presses Tab through every control until focus leaves the page or repeats; or `"tab": 5` for N presses |
| `{ "goto": "/account" }` | Goes to another page (relative to the current one) and puts VoiceOver back in the page |
| `{ "find": "heading" }` | Jumps to the next `heading`, `link`, `control`, `table`, `list` or `graphic` |
| `{ "focus": "#email" }` | Moves keyboard focus (and the VoiceOver cursor) to a CSS selector |
| `{ "type": "text", "into": "#email" }` | Types text; `into` focuses the field first (optional) |
| `{ "press": "Tab" }` | Presses a key: `Tab`, `Enter`, `Space`, `Escape`, `ArrowDown`, `Shift+Tab`… |
| `{ "activate": "button.save" }` | Activates an element (VO+Space); `true` activates the current item |
| `{ "wait": 1000 }` | Waits N milliseconds |

`"expect": "text"` checks that VoiceOver said that text (case-insensitive)
during the step. Failed checks and failed steps are reported at the end; they
never stop the run, so the transcript always covers the whole workflow.
