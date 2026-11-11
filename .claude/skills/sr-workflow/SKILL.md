---
name: sr-workflow
description: Write a VoiceOver screen reader workflow (screen-reader/workflows/*.json) from a URL and a plain-language description of a user flow, then validate it; and review run transcripts for judgment-call issues. Use when the user asks to create, generate, or add a screen reader / VoiceOver test or workflow for a page or flow, or to review VoiceOver transcripts / record screen reader issues.
---

# Screen reader workflow from a description

Turn "URL + what the user does" into a workflow file that `npm run sr:test` runs with real VoiceOver. The format and step types are documented in `screen-reader/README.md` — read it before writing a file.

## Inputs

- **URL** of the page the flow starts on (full URL, or a local HTML file).
- **Description** of the flow, e.g. "sign in with a wrong password and check the error is announced".

If either is missing, ask for it. If the page needs a login first, ask for the login steps and test credentials; tell the user the credentials will be saved in the workflow file, and suggest a test account.

## Steps

### 1. Inspect the page

```bash
npm run sr:inspect -- <url>
```

This prints the accessibility tree (roughly what VoiceOver will read) and every focusable control with a selector that matches exactly one element. Use only these selectors. Never guess a selector. If a control shows `(no unique selector)`, that is itself an accessibility signal worth mentioning; target it with `press: "Tab"` from a known neighbour instead.

If the flow moves to another page (e.g. after submitting), inspect that page too when it is reachable by URL.

### 2. Write the workflow

Create `screen-reader/workflows/<short-kebab-name>.json`. Do not overwrite an existing file without asking.

Rules:
- **Navigate like a screen reader user.** Prefer `find` (heading, link, control), `next`, and `press: "Tab"` for moving around; use `focus`/`activate`/`type` with selectors when the flow needs a specific control. Start with `{ "read": "page" }` when the user wants the whole page heard.
- **Use the keyboard to operate controls**: `press: "Space"` for checkboxes, `press: "Enter"` for links and submit, `ArrowDown` in selects and radio groups.
- **Add a `wait` (1000–2000 ms) after anything that loads or updates content** (submit, navigation, opening a dialog) before the next check.
- **Add `expect` only for what the page itself establishes**: visible labels, headings, button text, and error/success text shown in the inspect output or stated by the user. Keep each `expect` a short distinctive fragment (`"Password"`, not the whole announcement).
- **Expected behaviour you can't see** (e.g. "focus moves into the dialog", "error is announced when it appears") is fine to check, but list these as assumptions for the user to confirm.

### 3. Validate

```bash
npm run sr:check -- --selectors
```

Fix any schema errors. A selector reported as matching 0 elements is only acceptable if the element appears after an earlier step (a dialog, an error message); say so to the user.

### 4. Hand over

Tell the user:
- the file path and a one-line summary of each step,
- which `expect` checks are assumptions rather than taken from the page,
- how to run it: `npm run sr:test -- -g "<workflow name>"` (hands off the keyboard and mouse while it runs).

Do not run `sr:test` yourself unless the user asks: it takes over the Mac with VoiceOver.

If the user later pastes a failed run, read `reports/screen-reader/<file>.json`. Fix steps that failed because of the workflow (wrong selector, missing wait). Report steps that failed because of the page (missing label, nothing announced) as accessibility findings, and don't edit the workflow to hide them.

## Reviewing a run (when asked to review transcripts or record issues)

After `npm run sr:test`, each workflow has a transcript in `reports/screen-reader/<workflow>.json`. `bt-a11y screen-reader` (`npm run sr:findings`) already turns the clear-cut problems into findings: missing names and states, unclear link text, file-name or unlabelled images, heading skips, focus order, traps, unreachable controls and missed `expect`s. Do not repeat those.

Your job is the judgment calls the rules can't make. Read every step's `spoken` text, and the focused control's `role`/`name`, and look for:

- **1.1.1:** alt text that is present but meaningless ("image", "photo", "logo1", "icon").
- **2.4.6 / 2.5.3:** labels that don't describe the field or don't match the visible text in the `sr:inspect` output ("Field 1", "Submit" on a button that shows "Pay now").
- **1.3.2 / 2.4.3:** reading order that wouldn't make sense to someone who can't see the layout.
- **3.3.1 / 3.3.3:** error messages that are announced but vague ("Invalid input") or don't say how to fix it.
- **4.1.3:** content that obviously changed after a step (results, cart count, toast) with nothing announced, where the workflow had no `expect`.
- **2.4.2:** a page title that doesn't identify the page, if the start step announces it.

Write what you find to `reports/screen-reader/<workflow>.review.json`, next to its transcript (replace the file if it exists):

```json
{
  "findings": [
    {
      "step": 3,
      "title": "Alt text doesn't describe the image",
      "description": "The hero image is announced as “banner”, which tells the user nothing about it.",
      "wcag": ["1.1.1"],
      "severity": "medium",
      "remediation": "Describe what the image shows, or use alt=\"\" if it's decorative."
    }
  ]
}
```

- `step` is the transcript step number the issue was heard at. Quote what VoiceOver said in `description`.
- Severity: `high` blocks or seriously misleads a screen reader user, `medium` makes a task harder, `low` is a minor annoyance.
- Only report what the transcript shows. If something can't be judged from the transcript, leave it out rather than guess. Write `{ "findings": [] }` when there is nothing to add.

Then run `npm run sr:findings`. It merges the rule findings and your review into the audit: every finding lands on its checklist line as "scan found issues · not reviewed yet", and AI findings are marked as such (source `voiceover-ai`), for the auditor to confirm or dismiss in `bt-a11y checklist`. Tell the user how many findings you added and which ones you're least sure of.
