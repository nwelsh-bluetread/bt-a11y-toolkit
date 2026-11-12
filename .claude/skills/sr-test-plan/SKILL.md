---
name: sr-test-plan
description: Plan and write the screen reader (VoiceOver) and keyboard tests for a whole website audit from its sitemap, navigation map and flow notes - a baseline per page plus targeted workflows for the interactive parts (dropdowns, dialogs, forms, tabs) and the key multi-page flows - then validate them and write a test plan. Use when preparing a screen reader audit, or when the user asks to create screen reader tests / VoiceOver workflows for a site, from a sitemap or nav map, or for all pages. For a single flow on one page, use sr-workflow instead.
---

# Screen reader test plan for a website audit

Preparation step before an audit's VoiceOver run. Turns what's known about the site (sitemap, navigation map, flow notes, the pages themselves) into workflow files that `npx bt-a11y sr test` runs, plus a plan the auditor can check.

The same workflow files run twice: with VoiceOver (`npx bt-a11y sr test`, macOS) and with the keyboard only (`npx bt-a11y kb`, any OS, part of every website audit). The keyboard run skips `read`/`next`/`find` steps and checks that each `activate` changes something, that a dialog that opens takes focus, and that `Escape` closes it and returns focus. So write workflows that work for both: reach controls with `focus`/`activate`/`press: "Tab"`, and after opening a dialog, `press: "Escape"` at the end.

Two layers:

1. **A baseline per page** (read the whole page, then Tab through every control). Generated, no judgment needed. Catches most problems.
2. **Targeted workflows** for what a baseline can't exercise: opening things, submitting forms, moving between pages. This is where you add value.

Work from the repo being audited. Paths and commands are as in `sr-workflow` ("Where things are"): workflows in `a11y-audit/screen-reader/workflows/`, commands `npx bt-a11y sr <command>`. Read the workflow format in the toolkit's `screen-reader/README.md` (`node_modules/@bluetread/accessibility-toolkit/screen-reader/README.md`) before writing files.

Never run `npx bt-a11y sr test` yourself: VoiceOver takes over the Mac.

## 1. Gather the inputs

Use what exists; ask only for what's missing.

- **Pages:** `a11y-audit/session.json` → `project.urls` (the audit's pages). Else a sitemap (`<loc>` entries) or `urls.txt` the user names. If there's no audit yet, suggest `npx bt-a11y start` first so the pages and checklist exist.
- **Navigation map / flow notes:** `a11y-audit/context/` (copied there by the guided audit), or paths the user gives. Navigation maps have route tables and Mermaid flowcharts (`Login --> Dashboard`); flow notes describe tasks in prose. These tell you which multi-page flows matter.
- **Existing workflows:** list `a11y-audit/screen-reader/workflows/`. Never overwrite or duplicate one; mention which you left alone.
- **Sign-in:** `a11y-audit/screen-reader/sessions/` lists saved sign-ins. Notes in the sitemap or nav map often say which pages need a login.

Confirm the site is running (the URLs load) before inspecting. If it isn't, stop and tell the user how the notes say to start it.

## 2. Inspect every page

```bash
npx bt-a11y sr inspect <url> [--session <name>]
```

It prints the accessibility tree, each focusable control with a unique selector and flags (`expanded=false`, `haspopup=menu`, `required`, `state=…`, `native-select`), and a **Patterns** section (forms, dialogs, tablists, live regions, expandable controls). A `⚠ Redirected` line means the page needs a sign-in: if none is saved, ask the user to run `npx bt-a11y sr login <url>` (it opens a browser for them to sign in by hand), then inspect again with `--session`. Don't write workflows for a page you couldn't inspect; list it in the plan as blocked.

Use only selectors inspect printed. Never guess one.

## 3. Baselines

```bash
npx bt-a11y sr baseline [--session <name>]
```

Writes `baseline-<page>.json` for every audit page (existing files are kept). Pass `--session` when the pages need a sign-in. Pages outside the audit: pass their URLs.

## 4. Targeted workflows

Pick from the inspect output. One workflow per pattern instance worth testing, **at most 3 per page**, most important first (forms and dialogs before tabs). Shared components (the same header menu on every page) get **one** workflow, on the first page they appear on.

| Pattern in inspect | Workflow | What it checks |
| --- | --- | --- |
| `expanded=false` / `haspopup` (dropdown, menu button, accordion) | `focus` it (expect `collapsed`), `activate` (expect `expanded`), `ArrowDown` (expect first option, if visible in the tree), `Escape`, and check focus returns | state announced and changes (the runner also records it automatically) |
| Form with required fields | Tab through the fields; `activate` submit while empty; `wait` 1500; expect the first error text if the page shows one, else no expect and note it as an assumption. `"wcag": ["3.3.1"]` on that step | labels, errors announced, focus moves to the error |
| Form, happy path (only if the user gave test data) | fill each field with `type` + `into`, submit, `wait`, expect the success heading/message | status messages (4.1.3) |
| Button that opens a dialog (`haspopup=dialog`, or the name says so) | `activate`, `wait` 1000, expect the dialog's title; `press: "Tab"` a few times (focus stays inside); `press: "Escape"`; expect the opener's name | focus moves in, is contained, and returns (2.4.3) |
| Tablist | `focus` the selected tab, `press: "ArrowRight"` (expect the next tab's name), `press: "Tab"` (into the panel) | tab pattern keyboard support |
| Live region near a search/filter input | `type` a query `into` the input, `wait` 1500, expect the result count text if shown | results announced (4.1.3) |
| Custom checkbox/switch (`role=checkbox`, `state=`) | `focus`, `press: "Space"`, expect `checked` / `on` | state changes announced |
| `native-select` | skip: browsers handle native selects | |

**Multi-page flows** from the nav map / flow notes: pick the 2–4 tasks a user must be able to complete (sign in, the main create/edit flow, checkout). For each: start on the first page, move like a screen reader user (`find: "link"`/`"control"`, or `activate` the link's selector), `wait` after each navigation, and `expect` the next page's main heading (from inspect). Add `"session"` when the flow starts signed in.

Rules (same as `sr-workflow`):
- `expect` only text the page establishes (inspect output, visible labels, the user's description). Short distinctive fragments.
- Anything you expect but couldn't see (an error message that only appears on submit, focus moving into a dialog) is an **assumption**: list it in the plan.
- `wait` 1000–2000 ms after anything that loads or changes content.
- Never put real credentials in a workflow; use a saved session, or test data the user gave.
- File names: `<page-slug>--<pattern>.json` (e.g. `users--add-user-dialog.json`), flows `flow--<task>.json`. Names: `"<Page>: <what>"`, e.g. `"Users: add-user dialog"`.

## 5. Validate

```bash
npx bt-a11y sr check --selectors
```

Fix schema errors and selectors that match nothing. A selector that matches 0 elements is only fine if the element appears after an earlier step (dialog contents, an error); say so in the plan.

## 6. Write the plan

Write `a11y-audit/screen-reader/test-plan.md` (replace it if it exists):

```markdown
# Screen reader test plan — <project>

Run: `npx bt-a11y` → Screen reader test → Saved workflows (or `npx bt-a11y sr test`). The keyboard tests run them too: `npx bt-a11y kb` (also part of every website audit).
About <N> workflows; VoiceOver takes roughly 3–10 minutes per page. Keep hands off the Mac while it runs.

## Pages
| Page | Baseline | Targeted workflows | Sign-in |
| --- | --- | --- | --- |
| /users | baseline-…-users.json | users--add-user-dialog.json, users--filter.json | localhost-4173 |

## Flows
- **Sign in → dashboard** (`flow--sign-in.json`): …

## Assumptions to confirm
- users--add-user-dialog step 3 expects “Add user” as the dialog title: not visible before opening.

## Not covered
- /reports: redirected to /login and no saved sign-in. Run `npx bt-a11y sr login <url>`, then ask again.
- Native selects, drag and drop, timing: manual checklist.
```

## 7. Hand over

Tell the user, briefly: how many baselines and targeted workflows you wrote (and how many existing ones you left alone), the flows covered, the assumptions to confirm, pages you couldn't cover and why, and how to run them (above). Point them at `test-plan.md`. After they run it, `sr-workflow` covers fixing failed steps and reviewing transcripts.
