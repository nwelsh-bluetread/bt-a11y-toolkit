# @bluetread/accessibility-toolkit

BlueTread's internal, repeatable accessibility testing toolkit. Every audit uses
this as a baseline: a guided audit (a few questions, then automated scans and a per-screen checklist), reusable automated a11y checks,
a manual testing checklist, WCAG-mapped scoring, a report generator, and Jira
ticket creation — for **websites** and **mobile apps (iOS / Android)**.

```bash
# Private package — install from GitHub into the repo you're auditing:
npm install -D github:nwelsh-bluetread/bt-a11y-toolkit
npx bt-a11y
```

> This repo backs all work for the Accessibility Product: unit tests, scripts,
> and the shared toolkit. See [`docs/DEVELOPMENT_CHECKLISTS.md`](docs/DEVELOPMENT_CHECKLISTS.md)
> for the full Phase 1–4 engagement checklists, and
> [`docs/MANUAL_TESTING.md`](docs/MANUAL_TESTING.md) for what to test by hand
> (by WCAG level) after the automated scans run.

## How to run an audit (step by step)

A plain-language walkthrough from start to finish. For more technical detail,
see [Guided audit](#guided-audit) below.

### Before you start

You'll need:
- **The app's code** on your computer (for example, a cloned GitHub repo).
- **Node.js** version 18 or newer. To check, run `node --version` in Terminal.
- **Real phones** for screen-reader testing: an iPhone (VoiceOver) and/or an
  Android phone (TalkBack). Simulators aren't good enough for this part.
- **Test builds and logins** from the client (TestFlight / APK, test accounts).
- **Google Chrome** installed, to create the summary PDF at the end.
- **Python 3**, so the PDF passes accessibility (PDF/UA) checks. Macs with
  Xcode already have it; otherwise run `xcode-select --install`.
- **veraPDF** (optional, recommended), to check every PDF automatically:
  `brew install verapdf`.

To check all of this in one go, run `npx bt-a11y pdf-setup` after Step 1.
Every item should show ✓.

### Step 1: Install the toolkit (one time per project)

In Terminal, go to the app's folder and install:

```bash
cd path/to/the-app
npm install -D github:nwelsh-bluetread/bt-a11y-toolkit
```

**Updating later:** run `npx bt-a11y update` in the same folder. You don't
need to repeat the install command. `npx bt-a11y` also tells you when a newer
version is available.

### Step 2: Start the audit and answer the questions

```bash
npx bt-a11y
```

You'll be asked:
1. **Context docs (optional, but recommended).** If you have a document that
   describes the app, such as a navigation map, a list of screens, or flow
   notes, give its path here (several paths separated by commas). If there's a
   file like `navigation-map.md` in the project, it's suggested for you. Press
   Enter to accept it, or clear the answer to skip. See
   [What a context doc adds](#what-a-context-doc-adds) below.
2. **Project name.** Press Enter to accept the suggestion.
3. **What you're auditing:** a mobile app, a website, or both.
4. **The compliance level.** Choose **AA** unless told otherwise; it's the
   legal standard.
5. **Screens.** The toolkit finds the app's screens in its code (and in your
   context doc) and lists them in the app's navigation order (the root stack
   first, then each tab in the order it's declared, with each tab's screens
   together), grouped by section. With a context doc, the doc's order is used. If the app has several
   sections, tick the ones in scope (all are ticked to start). Then check the
   list looks right and press Enter. If something's missing, say No and edit
   the list.
   - For a website, you're asked for page addresses instead (or a sitemap
     link).
6. **Whether to add the audit folder to `.gitignore`.** Say Yes so client
   findings never get committed to their code.

That's all the questions.

#### What a context doc adds

A navigation map, a document listing every screen with its route name, screen
component, and deep link (plus a flow diagram, if you have one), makes the
whole audit more accurate:

- **Complete screen list.** Screens the code scan missed are added from the
  doc. Screens found only in code are kept too, in an "Other screens" group.
- **Grouped by section** (e.g. *Root stack*, *Main bottom tabs › BillingTab*),
  so you can audit one part of a large app at a time.
- **Easier testing.** Each screen in the checklist shows its group, its **deep
  link** (open it directly instead of tapping through the app), and **where
  it's reached from** (from the flow diagram).
- **Kept with the audit.** The doc is copied into `a11y-audit/context/` and
  linked at the top of the checklist.

The toolkit reads Markdown tables whose headings include something like
*Route*, *Component*, and *Deep link*. Rows starting with `↳` belong to the
tab or stack above them. It also reads Mermaid `flowchart` arrows. Other text
is kept for people to read but isn't interpreted.

### Step 3: Let the automated checks run

You don't need to do anything here. The toolkit:
- **reads the app's code** and flags problems it can see, such as buttons with
  no label, text that can't be enlarged, low-contrast colors, and locked
  screen rotation;
- **links each problem to the screens it affects**;
- **prints a checklist for each screen**, and saves it as a file you'll fill
  in: `a11y-audit/checklist.md`.

The automated checks catch only part of the problems. The manual testing in
the next step finds the rest.

### Step 4: Test each screen by hand

**The easy way: the checklist app.** Run:

```bash
npx bt-a11y checklist
```

This opens `a11y-audit/checklist.html` in your browser. Click **Open
checklist.md…** and pick `a11y-audit/checklist.md`. Then pick iOS or Android
and a screen on the left, and mark each check **Pass**, **Fail**, or **N/A**.
On a fail, type what went wrong and pick a severity. Each check shows the scan's
⚑ findings and a **How to test** note, and the sidebar shows which screens are
done, failed, or still to go. Keyboard shortcuts: `P` pass, `F` fail, `N` N/A,
`J`/`K` next/previous check, `]`/`[` next/previous screen, `?` for help.

- **Use Chrome or Edge.** They save every mark straight back to
  `checklist.md` as you go. In other browsers, your work is kept in the
  browser until you click **Download .md** and replace the file.
- **It writes the normal checklist format**, so everything below still
  applies: you can switch between the app and a text editor at any time, and
  `npx bt-a11y report` reads the result as usual. If the file changes while
  the app has it open (for example, you re-run `npx bt-a11y`), the app stops
  saving and asks whether to reload or overwrite.
- **Scan pre-fills:** a check the scan already failed shows *Scan found issues
  · not reviewed yet*. Test the screen, then click **Fail** to confirm it
  (adding anything else you found), or change the mark if the scan is wrong.
- **Other issues** you add on a screen go under *Other findings* at the end of
  the file.
- **Can't reach a screen?** Tick **Blocked** under its name and say why (no
  test account, feature turned off, crashes).

**Or edit the file by hand.** Open `a11y-audit/checklist.md` in any text editor (VS Code works well). It has
**one section per platform**: iOS, then Android. Within each, you go **screen
by screen**, and on each screen do every check, grouped by tool in this order:

1. **Screen reader** (VoiceOver / TalkBack)
2. **Voice & switch control**
3. **Visual, text size & orientation**
4. **Touch & gestures**
5. **Cognitive: content, forms & behavior** (wording, forms and errors, consistency, sign-in)
6. **Media, motion & timing** (only on screens with audio, video, or animation)
7. **Keyboard**

The **Setup** line at the top of each platform has you pair a keyboard once
and set the triple-click shortcut, so VoiceOver, Voice Control, and Full
Keyboard Access (or TalkBack and Voice Access on Android) switch on and off in
a second. Next comes the list of checks, each labeled with the **WCAG success
criteria** it covers (e.g. **3.3.2**, or **1.3.2, 2.4.3** when a check covers
two), their names and levels, and **how to test** it.
Under each screen's heading are the checks to do on that screen, grouped by
tool.

Screens only get the checks that apply to them. Form checks appear only on
screens with forms, and gesture checks only on screens with swipe actions.
Whole-app checks, like screen rotation and language, are listed once under
**App-wide** at the end of each platform. The **Screens in scope** list at the top shows each screen's
deep link, how it's reached, and what the scan found there.

For each screen in a pass:
1. **Open the screen** (its deep link and how it's reached are shown under its
   heading).
2. **Do each listed check**, on a real phone. The pass's check list at the top
   has the "how to test" steps.
3. **Look at any ⚑ lines** under a screen. They show what the automated checks
   already found there, one line per issue with its severity and where it is,
   e.g. `⚑ Medium · Touchable has no accessibility role — HeaderBackButton.js:29, LiveChatButton.js:10 +3 more`.
   Every file, why it matters, and how to fix it are in
   **`a11y-audit/scan-details.md`**, organized by screen:
   - **Lines the scan already failed start as
     `[!] **Login** — scan found issues · not reviewed yet`.** The scan's
     finding is already in the report, so don't write it up again. But **the
     screen still needs testing**: the scan only sees what's literally in the
     code, not labels built at runtime, misleading wording, or custom
     components. Test the rest of the screen and add anything else you find
     after a colon (`- [!] **Login**: Date picker reads "button 4" (high)`),
     then **delete "— scan found issues · not reviewed yet"**. Until you do,
     the report counts the line as *not reviewed*: the coverage table shows
     e.g. "❌ Fail (3) · 2 not reviewed", and `npx bt-a11y report` prints how
     many are left. Untouched pre-filled lines are rebuilt from the latest
     scan on each re-run, so they disappear once the client fixes the code.
   - **`⚑ Verify:` lines** point at code worth checking by hand (gestures,
     video, modals). The result is up to you.
   - If you mark a line `[x]` but the scan found an issue there,
     `npx bt-a11y report` warns you. The scan finding still counts, so change
     it to `[!]` unless you've confirmed the scan is wrong.
4. **Mark each check:**

| You type | Meaning |
| --- | --- |
| `- [x] **3.3.2** Every input has a label… · `input-labels`` | Passed on this screen |
| `- [!] **3.3.2** … · `input-labels`: what went wrong (high)` | Failed. Describe what happened after a colon; severity is optional |
| `- [-] **3.3.2** …` | Not applicable (e.g. no videos on this screen) |
| `- [ ] **3.3.2** …` | Not tested yet (leave as is) |

**Example:**
```
### Signup

*deep link `signup` · reached from Login*

- [x] **4.1.2** Screen reader announces the name, role, and state of every control · `sr-name-role-value`
- [x] **1.3.2, 2.4.3** Reading and focus order is logical and matches the visual layout · `focus-order`
- [!] **3.3.2** Every input has a label or instructions (not just placeholder text) · `input-labels`: Email field is read out as "edit box" with no label (high)
  - Password field has no label either (medium)
- [ ] **2.4.4** Link and button purpose is clear from its text or context · `link-purpose`
```

**Severity guide:**
- **critical:** someone can't complete the task at all
- **high:** a major barrier that's hard to work around
- **medium:** annoying, but there's a workaround
- **low:** minor

**Issues and notes under a check.** Indented lines under a check are read
like this:

- **Counted as issues:** `  - Password field has no label (medium)`, and
  also `  High - Header doesn't work` without the dash.
- **Kept as notes, not counted:** lines starting with `Note:` or `N/A -`, and
  lines saying a check couldn't be tested ("Can't test without zoom").
- **Under a `[x]` or `[-]` check:** any text is kept as a note.
- **Check marked `[!]` but couldn't be tested:** the report warns about it.
  Leave the check `[ ]` until it's tested.

Re-running `npx bt-a11y` rewrites these lines in the standard form
(`  - … (high)`, `  Note: …`) and doesn't drop any of them.

**Can't reach or test a screen?** Add a Blocked line under its heading,
with the reason if you know it. Blocked screens are listed in `report.md`,
in the terminal, and in the PDF (with how many checks are still open), so the
client can see what wasn't covered:
```
### PaymentDetail

> **Blocked:** Test account has no open invoices
```
For any other note about a whole screen, add `> **Note:** …` the same way.
**Don't rename the heading:** answers are matched to screens by it. (Headings
that were already renamed, like `PaymentDetail - BLOCKED` or
`PAPQuestions (step 1)`, are recognized and converted to these lines on the
next run.)

**Found something that doesn't fit any check?** Add it under **Other
findings** at the bottom of the file:
```
- [!] iOS, Android · Welcome · 1.4.3 · Subtitle text is light grey on white (medium)
```

**Splitting the work?** iOS and Android are separate parts of the file, so one
person can do the iOS part and another the Android part at the same time.

Save the file as you go. You can stop and come back any time.

### Optional: measure touch targets automatically (Android)

The 2.5.8 target-size check (24×24) doesn't need to be done by hand on
Android. Connect a phone with USB debugging on (or start an emulator),
open the app, sign in, and run:

```bash
npx bt-a11y target-size
```

The first time, it asks you to confirm the app's package and deep link scheme.
It finds both itself and remembers them. Then choose which screens to measure:

- **Screens with a deep link** open one after another on their own.
- **All screens**: deep links open on their own, and for the rest it asks you to
  open the screen on the phone and press Enter (`s` skips, `q` stops).
- **Just the screen on the device now**, for a single screen.

It reads the real size of every tappable control in dp. Controls under
24×24 dp pass only if they're far enough from other controls (WCAG's spacing
exception). Each measured screen's target-size line on the Android part of
`checklist.md` is filled in as pass or fail, ending in *— measured on device*,
with the too-small controls listed under it. Run it again after fixes and the
lines update. If you edit a line yourself, it's yours, and the command leaves it
alone. Blocked screens are skipped. iOS is still checked by hand.

A few things it can't see: `hitSlop` (an extra tap area outside the view)
doesn't show in the measurement, so re-check flagged controls that use it.
If a deep link doesn't change the screen, that screen is skipped. Use
`--wait 4000` if screens load slowly.

### Step 5: Build the report

When you're done (or any time you want to see progress), run:

```bash
npx bt-a11y report
```

This creates:

- **`a11y-audit/a11y-audit-summary-<date>.pdf`**: the client-ready executive
  summary. It has a one-page cover (score, issue counts, key takeaway, top
  priorities), results by WCAG principle, iOS vs Android, a plain-language
  WCAG reference table, what to fix first, the remediation path, and every
  finding with its screens and fix.
- **`a11y-audit/report.md`**: the working report, with an overall score, a
  summary of problems by severity, every finding (automated and yours) with
  the screen and platform it was found on, and a **WCAG coverage table**
  showing the status of every requirement: passed, failed, not applicable, or
  not yet tested, plus a **Blocked screens** table if any screens were marked
  blocked.

**iOS vs Android.** When the audit covers both, the report and the PDF compare
them side by side: issues by severity, checklist progress, WCAG criteria
passing, failing, and not tested yet, and blocked screens. Then they list what's
**only on iOS** and **only on Android** (problems are matched by check and
screen; code-scan findings come from shared code, so they count for both), and
which **WCAG criteria differ by platform**, with real differences (passes on
one, fails on the other) first. Every finding's heading in `report.md` ends in
*· iOS only*, *· Android only*, or *· iOS + Android*.

**Fix these first.** The report (and the PDF, and the terminal) ranks the
fixes that clear the most failures for the least code, three ways:

- **Components:** one shared file, e.g. *QuantityStepper*, which renders on 39 screens.
- **Component families:** every component of one kind, e.g. *all modals* or
  *all dropdowns & pickers*, recognized by name (`…Modal`, `…Picker`, `…Button`).
- **Issue types:** one pattern everywhere, e.g. *text inputs with no label*,
  or *font scaling turned off or capped*.

Each one is worked out by removing its scan findings and recounting. It shows
how many **failing checks** it clears (checklist lines, per screen and
platform, that fail only because of it), which **WCAG criteria stop failing**,
and the **score** change. Effort is the number of code locations to change; ⚡
*quick win* marks 5 or fewer. Lines a tester failed with their own notes don't
count as cleared, because that problem isn't in the scan.

**Shared component issues.** Components rendered on two or more screens
(a text component, a checkbox, a modal) that the code scan found problems in
are listed once, with every issue, its line numbers and WCAG criteria, and how
many screens use the component. The list is in `report.md`, in the PDF (top 12),
and at the top of `checklist.md` (the **Shared components** button in the
checklist app). Testers log a shared component's problem once, naming the
component, instead of failing it on every screen.

**How each WCAG criterion is reported** (in `report.md` and the PDF's WCAG
reference table, with its level, plus a "Results by WCAG level" table):

| Result | Meaning |
| --- | --- |
| **Pass** | Tested on every platform it applies to, with no failures |
| **Fail** | A scan or a tester found a problem (with severity and how many findings) |
| **N/A** | Testers marked it `[-]` because the app has none of that content, e.g. "No audio/video". The reason comes from the check (captions → audio/video, error messages → form inputs) |
| **Web only** | Doesn't apply to native apps (Bypass Blocks, Multiple Ways, Text Spacing), so it isn't tested on iOS/Android |
| **Not yet verified** | Testing isn't finished on every platform |

N/A and Web only don't count for or against the score. Mark a check `[-]`
only when the content doesn't exist; if it exists but you couldn't test it,
leave it `[ ]` or mark the screen Blocked.

The PDF's "key takeaway" and principle summaries are written automatically
from the findings. To use your own wording, create
`a11y-audit/summary-overrides.json` and run the report again:

```json
{
  "keyTakeaway": "Screen reader users can't sign in. Fix the login form labels first.",
  "title": "Acme Mobile App"
}
```

Any field in `a11y-audit/a11y-audit-summary.json` (the data the PDF is built
from) can be overridden this way, including `principleSummaries`, `phases`,
and `preparedBy`. Add `--no-pdf` to skip the PDF.

**Making sure the PDF passes accessibility checks.** The PDF itself has to be
accessible (the PDF/UA-1 standard). The first time you build one, the toolkit
installs what it needs automatically (about 20 seconds, once per computer).
If veraPDF is installed, every report then ends with:

```
✓ PDF/UA-1: PASS (veraPDF)
```

If you see **✗ FAIL** or a ⚠ warning instead, run `npx bt-a11y pdf-setup` and
fix whatever it marks with ✗. Don't send a PDF to a client until it shows
PASS.

If you made a typo in the checklist (for example `[y]` instead of `[x]`), it
tells you which line to fix.

To also create Jira tickets for the serious issues:
```bash
npx bt-a11y report --jira --min-severity high
```
This needs your Jira login details set up first. See the Jira step in
[Team setup](#team-setup).

### Step 6: After the client fixes things

Run `npx bt-a11y` again and choose **"Re-run the scans and refresh the
checklist."** The automated checks run again on the updated code, and
**everything you already marked is kept**. Re-test the items that failed,
update their marks, and run `npx bt-a11y report` for the updated report.

### Quick reference

| I want to… | Run |
| --- | --- |
| Start an audit or re-run the scans | `npx bt-a11y` |
| Build or refresh the report | `npx bt-a11y report` |
| Check the PDF tools are set up | `npx bt-a11y pdf-setup` |
| Get the latest version of the toolkit | `npx bt-a11y update` |
| Fill in the checklist in the browser | `npx bt-a11y checklist` |
| Measure touch targets on Android | `npx bt-a11y target-size` |
| Find the checklist to fill in | `a11y-audit/checklist.md` |
| See every scan finding for a screen | `a11y-audit/scan-details.md` |
| Find the client PDF | `a11y-audit/a11y-audit-summary-<date>.pdf` |
| Find the working report | `a11y-audit/report.md` |

## Guided audit

The fastest way to run an audit: install the toolkit into the repo you're
auditing and let it walk you through everything.

```bash
cd path/to/client-repo
npm install -D github:nwelsh-bluetread/bt-a11y-toolkit
npx bt-a11y
```

> No repo to audit (e.g. a native app you only have a TestFlight build of)?
> Run it from any empty folder: `mkdir acme-audit && cd acme-audit && npm init -y`,
> then the two commands above.

`npx bt-a11y` (same as `npx bt-a11y start`) works in three parts:

**1. A few questions** — the only interactive part:

- Context docs (optional): a navigation map, screen list, or flow notes. See
  [What a context doc adds](#what-a-context-doc-adds).
- Project / client name
- **Mobile app (iOS + Android)**, **website**, or **both**
- Target **WCAG level** (A / AA / AAA)
- **Screens** — for a React Native repo, it finds them in the navigation code
  (`<Stack.Screen>`, static navigator configs, or expo-router's `app/` folder)
  and shows what each one contains (form inputs, images, gestures…). With a
  context doc, the list is merged with the doc, grouped by section, and you
  tick which sections are in scope. Confirm the list or edit it. For other
  mobile apps, the context doc supplies the list, or you type the screen names.
- **Pages** (websites) — URLs, a sitemap URL, or a URL list file. If the axe /
  Lighthouse packages aren't installed, it offers to install them.

**2. Automated checks run on their own** — the React Native
[code scan](#react-native-code-scan) (iOS + Android) and/or axe + Lighthouse
on each page. Code findings are mapped to every screen that renders the
affected file.

**3. The manual checklist** — printed in the terminal and written to
`a11y-audit/checklist.md`, organized to minimize switching tools:
**platform → screen → checks**. Each platform (iOS, Android, Website) is one
section that goes screen by screen in navigation order. On each screen, the
checks are grouped by tool: screen reader; voice & switch control; visual, text
size & orientation; touch & gestures; cognitive; media, motion & timing; and
keyboard last. The section opens with a one-time setup (keyboard paired,
shortcuts for toggling assistive tech) and a numbered list of its checks
(criteria + how to test). Each screen lists only the checks that apply to it: every screen gets the basics, screens with inputs get the form checks,
screens with swipes get the gesture checks, and whole-app checks go under
"App-wide" at the end. ⚑ lines under a check show what the scans
found or flagged there. A "Screens in scope" index at the top gives each
screen's deep link, how it's reached, its file, and its contents.

Testers fill in `checklist.md`, marking each check under each screen:

```markdown
# iOS

## All checks, screen by screen

> **Setup:** Pair a Bluetooth keyboard and leave it connected. Set the Accessibility Shortcut to VoiceOver, Voice Control, and Full Keyboard Access …

**Checks in this pass — how to test each:**

*Screen reader*

- **4.1.2** Screen reader announces the name, role, and state of every control — *Name, Role, Value (A).* Swipe right through every control…
- **3.3.2** Every input has a label or instructions (not just placeholder text) — *Labels or Instructions (A).* Focus each field…

### Signup

*deep link `signup` · reached from Login*

#### Screen reader

- [x] **4.1.2** Screen reader announces the name, role, and state of every control · `sr-name-role-value`
- [!] **3.3.2** Every input has a label or instructions (not just placeholder text) · `input-labels`: Email field is announced as "edit box" (high)
  - Password field has no label either (medium)
  ⚑ High · Text input has no accessible label — Signup.tsx:12

#### Visual, text size & orientation

- [ ] **1.4.3, 1.4.11** Text contrast is 4.5:1 (3:1 large text); icons and UI borders 3:1 · `contrast`

#### Keyboard

- [ ] **2.1.1, 2.1.2** Everything works with a keyboard, and there are no keyboard traps · `keyboard-operable`
```

`[x]` pass · `[!]` fail (describe the issue after the check, following a
colon, with optional `(severity)` and `[criterion]`) · `[-]` not applicable ·
`[ ]` not checked yet. Issues that don't fit a check go under **Other
findings** at the bottom. Checklists in earlier layouts are converted, with
their answers, the next time `npx bt-a11y` runs.

Then **`npx bt-a11y report`** reads the scans + checklist and writes
`a11y-audit/report.md` and `report.json` (score, findings with screen and
platform, and the [WCAG 2.2 coverage matrix](#wcag-22-coverage-all-86-criteria)),
plus the executive-summary PDF `a11y-audit/a11y-audit-summary-<date>.pdf`.
It warns about lines it can't read (with line numbers). Run it as often as you
like; add `--jira --min-severity high` to file tickets, or `--no-pdf` to skip
the PDF.

**About the PDF.** It's rendered by `assets/pdf/render.mjs` (vendored from the
`a11y-report-pdf` Claude skill) with headless Chrome; set `CHROME_PATH` if
Chrome isn't in a standard location. Chrome's output is then post-processed by
`assets/pdf/pdfua_fix.py` to pass **PDF/UA-1**. That needs Python's `pikepdf`,
which the toolkit installs into its own environment at `~/.bt-a11y/pdf-venv`
the first time it's needed (or use an existing one via `PDFUA_PYTHON`). If
`verapdf` is on the PATH, each PDF is validated and `report` prints PASS, or
FAIL with the failed rules and a non-zero exit code. `npx bt-a11y pdf-setup`
installs and checks everything up front. Code findings are
merged per rule, listing every screen and file they appear in; manual
findings stay separate per issue.

Running `npx bt-a11y` again offers to re-run the scans (e.g. after the client
ships fixes) and regenerates the checklist **keeping every answer already
filled in**.

## React Native code scan

`bt-a11y code [folder]` (or step 1 of the guided audit) statically reads a
React Native project — JS/TS/JSX source plus `app.json` / `app.config.*`,
`ios/*/Info.plist`, and `android/.../AndroidManifest.xml`. Nothing is run or
built; it doesn't need a device, simulator, or the app's dependencies
installed. A ~100-file app scans in well under a second.

| Rule | Checks | WCAG |
| --- | --- | --- |
| `rn-control-name` | Pressable/Touchable with no text and no `accessibilityLabel` (icon-only buttons) | 4.1.2, 1.1.1 |
| `rn-control-role` | Pressable/Touchable with no `accessibilityRole` / `role` | 4.1.2 |
| `rn-control-state` | `checkbox` / `switch` / `radio` / `tab` role with no `accessibilityState` | 4.1.2 |
| `rn-label-in-name` | `accessibilityLabel` that doesn't contain the visible text | 2.5.3 |
| `rn-hidden-control` | Touchable inside `aria-hidden` / `accessibilityElementsHidden` / `no-hide-descendants` | 4.1.2 |
| `rn-image-alt` | `Image` with no label and not explicitly marked decorative | 1.1.1 |
| `rn-input-label` | `TextInput` with no label (placeholder only) | 3.3.2, 4.1.2, 1.3.1 |
| `rn-input-purpose` | Email/phone/name/password field with no `autoComplete` / `textContentType` | 1.3.5 |
| `rn-paste-blocked` | Password field with `contextMenuHidden` (blocks password managers) | 3.3.8 |
| `rn-font-scaling` / `-cap` / `-global` | `allowFontScaling={false}`, `maxFontSizeMultiplier` < 2, or app-wide `defaultProps` overrides | 1.4.4 |
| `rn-target-size` | Touchable styled smaller than 24×24 (44×44 at AAA) with no `hitSlop` | 2.5.8 / 2.5.5 |
| `rn-contrast` | Text color vs. container background (from inline styles / `StyleSheet.create`) below 4.5:1 / 3:1 | 1.4.3 / 1.4.6 |
| `rn-heading-role` | Text styled as a title/heading without `accessibilityRole="header"` | 1.3.1 |
| `rn-orientation-lock` | Portrait/landscape lock in Expo config, Info.plist, AndroidManifest, or code | 1.3.4 |
| `rn-reduce-motion` *(AAA)* | Animations with no Reduce Motion check anywhere | 2.3.3 |

It also raises **"verify by hand" signals** for code that a person must check:
gesture handlers and long-press (2.5.1 / 2.5.7), video players (1.2.x / 1.4.2),
looping Lottie animations (2.2.2), modals (2.4.3), WebViews, long timers
(2.2.1), and an app with no live regions or announcements at all (4.1.3). In
the guided audit these appear on the matching manual checks.

**How to read the results.** Findings are grouped per rule per file, with line
numbers, so one finding ≈ one fix ≈ one ticket. The scan only reports what's
written literally in code: when text comes from a variable, or props are
spread (`{...props}`) into a component, it skips rather than guesses. That
keeps false positives low, and it means **no findings ≠ passing** — those
criteria show as "Scan clear — verify" until the manual checklist confirms
them.

```bash
npx bt-a11y code                          # scan the current folder
npx bt-a11y code ./mobile --format markdown --out code-scan.md
npx bt-a11y code --level AAA --jira --min-severity high
```

## WCAG 2.2 coverage (all 86 criteria)

WCAG 2.2 has **86 success criteria** (31 A, 24 AA, 31 AAA). No tool can test
all of them automatically — automation reliably covers roughly a quarter to a
third — so the guided audit combines three sources and tracks every criterion:

| Source | Covers |
| --- | --- |
| React Native code scan | 11 criteria at AA (14 at AAA) — see rules above |
| axe / Lighthouse (websites) | ~22 criteria |
| Manual checklist (`src/checklist.ts`) | **All 86** — 70 checks, grouped where criteria are tested together; filtered by level and platform, and tailored per screen |

The report's coverage matrix lists each in-scope criterion (55 at AA) per
platform with one status:

| Status | Meaning |
| --- | --- |
| ❌ Fail (n) | n findings map to it (from any source) |
| ✅ Pass | Every checklist line covering it (on every screen) is answered and none failed it |
| ➖ N/A | The tester marked it not applicable (e.g. no video) |
| 🔎 Scan clear — verify | An automated check covers it and found nothing; still needs manual confirmation |
| ⬜ Not tested | Nothing has looked at it yet |
| — Doesn't apply | Not applicable to the platform (Bypass Blocks, Multiple Ways, and Text Spacing on native apps) |

`report.json` includes the same matrix under `coverage`.

## Why

Manual audits are slow and inconsistent. This toolkit turns the repeatable parts
of an assessment into pure, testable functions that run anywhere (CI, Metro, a
browser), so every engagement starts from the same baseline and produces the same
report shape.

## Time estimates (running on a real client site)

Rough per-engagement effort once the toolkit is wired up. "Tool time" is mostly
unattended machine time; "analyst time" is the human work of reviewing,
validating, and de-duplicating. Estimates assume a **medium site/app (~15–30 key
screens)** and scale roughly linearly with screen count.

### Step 1 — Web tool auditing (issue list + severity + combined score)

Automated scanners run per page; a crawler batches them across the site.

| Tool | Setup | Run time (per page) | Analyst review | Notes |
| --- | --- | --- | --- | --- |
| **Lighthouse** | ~15 min | ~30–60 sec | — | Headless, fully automated |
| **axe DevTools** (axe-core) | ~30 min | ~5–15 sec | — | Injected via Puppeteer/Playwright |
| **WAVE** (API) | ~15 min | ~5–10 sec | — | Optional; needs paid API key |
| **Consolidate + dedupe + score** | — | seconds | ~2–4 hrs | Merge tools, validate severity, map WCAG |

**Step 1 total:** ~**3–5 hours** for a medium site (mostly analyst validation;
the scans themselves finish in minutes even across 30 pages).

### Step 2 — Test suites for code (interaction/state, e.g. `aria-expanded`)

Writing behavioral tests scanners can't do (focus traps, live regions, toggles).

| Activity | Estimate |
| --- | --- |
| Wire the shared matchers into the client repo | ~1–2 hrs |
| Author component interaction tests (per key component) | ~20–40 min each |
| Typical component set (10–20 components) | ~**6–12 hours** |

This is the most variable step — it depends on how many custom interactive
components the client has. Reusable components pay off fastest.

### Step 3 — Full report (automated, manual entered first)

| Activity | Estimate |
| --- | --- |
| Enter manual findings (screen reader, keyboard, gestures) | logged during manual testing |
| Generate consolidated report (automated) | ~**seconds** |
| Executive summary write-up / polish | ~2–4 hrs |

Once manual findings are entered as `Finding[]`, the scored report + scorecard +
Jira tickets generate near-instantly. The human time is the manual testing
itself (see [`docs/MANUAL_TESTING.md`](docs/MANUAL_TESTING.md)) and the exec
summary, not the report generation.

### Filtering (adds negligible time)

Filtering is a config/flag concern, not extra work:

| Filter | Cost |
| --- | --- |
| **Web vs Mobile** (`platforms` tag) | instant — same data, filtered view |
| **AA vs AAA** (`targetLevel`) | instant — re-scores from the same findings |
| **Run parts at a time** (individual `scan:*` / test scripts) | instant — each step is independent |

### Ballpark for a full medium-site engagement

| Phase | Effort |
| --- | --- |
| Step 1 — Web tool auditing | ~3–5 hrs |
| Step 2 — Code test suites | ~6–12 hrs |
| Step 3 — Manual testing + report | ~10–18 hrs (mostly manual AT testing) |
| **Total (Phase 1 assessment)** | **~20–35 hrs** |

> These are automation-inclusive estimates. They align with the ~34–40 hr Phase 1
> figure in [`docs/DEVELOPMENT_CHECKLISTS.md`](docs/DEVELOPMENT_CHECKLISTS.md) —
> the toolkit shifts hours away from repetitive scanning toward analysis and
> manual testing. Large or complex apps scale up; small apps scale down.

## Core concepts

Everything operates on a platform-agnostic `A11yNode` tree. Platform **adapters**
(you provide/serialize these) convert a React Native element tree or a web DOM
into `A11yNode`s, then the shared rules evaluate them identically.

```
A11yNode tree ──► rules ──► findings ──► scoring ──► report / Jira tickets
```

## Mobile app auditing (iOS & Android)

WAVE, Lighthouse, and axe DevTools all require a **web DOM**, so they do **not**
apply to native mobile apps. For a mobile-only project, ignore those tools and
use the mobile toolchain below. The audit is inherently **more manual** than web
— there is no DOM-style automated scanner for native mobile — so budget extra
time for VoiceOver/TalkBack testing.

> **What this repo does for a mobile audit today:** for **React Native** apps,
> an automated [source-code scan](#react-native-code-scan); for every app, the
> full manual checklist (all 86 WCAG 2.2 criteria), scoring, a
> [criteria coverage matrix](#wcag-22-coverage-all-86-criteria), reports, and
> Jira tickets. Screen-reader testing still happens on real devices. Code
> scanners for native Swift/Kotlin and Flutter, and imports for XCUITest /
> Espresso results, are on the [roadmap](#roadmap).

### Team setup

1. **Install and run the [guided audit](#guided-audit)** (Node 18+)
   in the client repo, or in an empty folder if you only have app builds.
   Choose **Mobile app**. For a React Native repo it finds the screens and
   scans the code; then it writes the per-screen checklist for testers to fill
   in.
2. **Skip the browser drivers.** Playwright, Chrome, and Lighthouse only matter
   if the app also has web surfaces (marketing site, web views, account
   portal). The guided audit only asks for them when you scan a website.
3. **Jira (optional)** — each person puts their own credentials in a `.env`
   file in the folder they run `bt-a11y` from. The CLI loads it automatically
   on Node 20.12+; on older Node, `export` the variables instead. Make sure
   `.env` is gitignored and never commit tokens.

   ```bash
   JIRA_BASE_URL=https://bluetread.atlassian.net
   JIRA_EMAIL=you@bluetread.com
   JIRA_API_TOKEN=...
   JIRA_PROJECT_KEY=ACME
   ```

   The guided audit asks for a minimum severity before filing; on the command
   line, always pass `--min-severity` so you don't file a ticket for every
   low-severity finding.

### Devices & tools per tester

| Platform | Required | Helpful |
| --- | --- | --- |
| **iOS** | Mac with Xcode (Accessibility Inspector → Audit), a **physical iPhone** for VoiceOver | XCUITest `performAccessibilityAudit()` if you have source access |
| **Android** | **Physical Android device** with TalkBack and the [Accessibility Scanner](https://play.google.com/store/apps/details?id=com.google.android.apps.accessibility.auditor) app | Android Studio Layout Inspector; Espresso `AccessibilityChecks.enable()` with source access |

Simulators/emulators are fine for Inspector audits, but **screen-reader testing
must be done on real hardware** — gestures, rotor, and announcement timing
differ.

### Before testing starts (get these from the client early)

- **Stack** — React Native, native Swift/Kotlin, or Flutter? This decides the
  toolchain (see the table below).
- **Builds** — TestFlight invites (iOS) and an APK or Play internal-testing
  track (Android). These usually take the longest to arrange.
- **Test accounts** for every role/state you need to reach (new user, paid
  user, empty state, error state).
- **Source access** (optional but valuable) — enables static linting and
  XCUITest/Espresso checks.
- **Screen/flow inventory** — one shared list with the **same screen names on
  both platforms** so iOS and Android findings line up in the report.

### Running the audit as a team

- **Split by platform, not by screen.** One person owns iOS + VoiceOver,
  another owns Android + TalkBack. Behavior diverges enough that per-platform
  ownership keeps findings consistent. `checklist.md` has a separate **iOS**
  part and **Android** part, so each tester fills in only their own part —
  share the one file (shared drive, or a branch; edits in different parts
  merge cleanly) and run `npx bt-a11y report` once both are done.
- **Work one testing pass at a time** through `checklist.md`: set up the tool
  once (e.g. VoiceOver on), test every listed screen, then move to the next
  pass. Optionally run Accessibility Inspector / Accessibility Scanner on each
  screen first and log real issues under the matching check.
- **Follow [`docs/MANUAL_TESTING.md`](docs/MANUAL_TESTING.md)** for what to
  test at each WCAG level, and
  [`docs/DEVELOPMENT_CHECKLISTS.md`](docs/DEVELOPMENT_CHECKLISTS.md) for the
  engagement phases.
- **Capture evidence** as you go — a screenshot or screen recording (with
  VoiceOver/TalkBack captions on) for every finding.

### Logging findings

The guided audit turns `checklist.md` into findings in this shape for you. If
you log findings some other way (a script, a spreadsheet import), record every finding in the
toolkit's `Finding` shape from day one — this is
what makes consolidation, scoring, and Jira tickets near-instant later. Tag the
platform so one report can be filtered to iOS, Android, or both:

```json
{
  "ruleId": "manual-focus-order",
  "title": "Checkout: focus jumps from 'Card number' to 'Place order'",
  "description": "With VoiceOver, swiping right from the card number field skips expiry and CVV.",
  "severity": "high",
  "wcag": [{ "id": "2.4.3", "name": "Focus Order", "level": "A" }],
  "nodeId": "Checkout > Payment",
  "platforms": ["ios"],
  "category": "Screen Reader",
  "source": "manual-voiceover",
  "remediation": "Group the expiry/CVV fields in reading order after card number.",
  "evidence": { "screenshot": "evidence/ios/checkout-focus.mov" }
}
```

Use `source` to record where it came from (`manual-voiceover`,
`manual-talkback`, `ios-inspector`, `android-scanner`, …). `category` is the
scorecard row the finding rolls up into. Reuse the guided audit's categories
(`Screen Reader`, `Keyboard & Focus`, `Forms`, `Images/Icons`, `Contrast`,
`Visual`, `Touch Targets`, `Gestures & Touch`, `Layout & Zoom`, `Content`,
`Media & Motion`, `Semantics`) so rows line up. In code, the
[`wcag()`](src/wcag.ts) helper looks up criteria by id and throws on ids that
aren't in `WCAG` in `src/wcag.ts`; add any missing criterion there. Keep evidence
and generated reports **outside the repo** or under `reports/` (gitignored) so
client data is never committed.

### Pick the toolchain by stack

| Stack | Static / source | On-device automated | Manual (required) |
| --- | --- | --- | --- |
| **React Native** | **`bt-a11y code`** (this toolkit's [code scan](#react-native-code-scan)) | iOS Accessibility Inspector, Android Accessibility Scanner | VoiceOver + TalkBack |
| **Native iOS** (Swift/UIKit/SwiftUI) | — | Xcode Accessibility Inspector Audit, XCUITest `performAccessibilityAudit()` | VoiceOver |
| **Native Android** (Kotlin/Java/Compose) | — | Accessibility Scanner, Espresso `AccessibilityChecks.enable()` | TalkBack |
| **Flutter** | Flutter a11y lints | Semantics debugger + native tools | VoiceOver + TalkBack |

### Three-layer workflow

1. **Static / source analysis** (automated, no device) — for React Native,
   `bt-a11y code` flags missing labels, roles, and states, disabled font
   scaling, locked orientation, low-contrast styles, small targets, and more
   (see [React Native code scan](#react-native-code-scan)).
2. **On-device automated scans** — Xcode Accessibility Inspector / XCUITest on
   iOS; Accessibility Scanner / Espresso on Android. These catch labels,
   contrast, touch-target size, and traits per screen.
3. **Manual assistive-tech testing** (catches what automation can't) — walk every
   primary flow with **VoiceOver** (iOS) and **TalkBack** (Android): focus order,
   announcements, form errors, modal focus, dynamic content.

### Example: React Native app, no web access

```
Discovery ─► confirm RN version, screens, flows, test accounts

Phase 1 Assessment (all inside `npx bt-a11y`):
  1. Code     → bt-a11y code: RN source + native config → Finding[] + signals
  2. iOS      → Accessibility Inspector Audit (optional, logged in the wizard)
  3. Android  → Accessibility Scanner (optional, logged in the wizard)
  4. Manual   → VoiceOver + TalkBack checklist, per platform, all in-scope criteria
  5. Report   → scorecard + findings + WCAG 2.2 coverage matrix + Jira
```

Every layer normalizes into the same `Finding` model, so a mobile-only
engagement still produces one unified scorecard, WCAG rollup, coverage matrix,
and Jira tickets — no web tooling involved.

## Quick start (library)

```ts
import { runAudit, formatConsole, formatMarkdown } from "@bluetread/accessibility-toolkit";

const tree = /* A11yNode from your adapter */;

const assessment = runAudit(tree, { platform: "react-native", targetLevel: "AA" });

console.log(formatConsole(assessment));
// Accessibility Assessment
// ────────────────────────────
// Overall Score: 62%
// Critical: 8
// ...
```

Findings from anywhere else (manual testing, native scanners, a spreadsheet)
can be scored the same way, and the manual checklist is available as data:

```ts
import {
  findingsToAssessment,
  checklistFor,
  howToFor,
  formatMarkdown,
} from "@bluetread/accessibility-toolkit";

const assessment = findingsToAssessment(findings, {
  platforms: ["ios", "android"],
  targetLevel: "AA",
});
console.log(formatMarkdown(assessment));

for (const item of checklistFor("ios", "AA")) {
  console.log(item.title, item.wcag, howToFor(item, "ios"));
}
```

## Quick start (CLI)

Run `bt-a11y` with no arguments for the
[guided audit](#guided-audit). The scripted commands below are for
CI and one-off scans: `audit` (audits an `A11yNode` tree JSON), `lighthouse`
and `axe` (scan live pages or convert a saved result), `code` (scans React
Native source), and `report` (rebuilds the guided audit's report).

```bash
# Audit an exported node tree:
bt-a11y audit ./examples/login-screen.json --platform react-native
bt-a11y audit ./tree.json --format markdown --out a11y-report.md

# Lighthouse — one page, many pages, a URL list, or a whole sitemap:
bt-a11y lighthouse https://example.com
bt-a11y lighthouse https://example.com https://example.com/about
bt-a11y lighthouse --urls ./urls.txt
bt-a11y lighthouse --sitemap https://example.com/sitemap.xml --format markdown --out a11y.md

# Convert a saved Lighthouse result — no Chrome needed:
bt-a11y lighthouse --lhr ./lighthouse-result.json

# axe-core (via Playwright) — same page/URL-list/sitemap options:
bt-a11y axe https://example.com
bt-a11y axe --sitemap https://example.com/sitemap.xml
bt-a11y axe --axe ./axe-result.json      # convert a saved axe result, no browser
```

> **Why `bt-a11y lighthouse` / `bt-a11y axe`?** When you install this package
> into another repo, only the compiled `dist/` ships — the `scripts/` folder does
> not. So the `bt-a11y` binary is how consumers run scans. Live scans need
> optional deps:
> - Lighthouse: `npm install -D lighthouse chrome-launcher`
> - axe: `npm install -D playwright @axe-core/playwright && npx playwright install chromium`

> **Getting only a few URLs from a sitemap?** Many sites publish a *sitemap
> index* (a sitemap of sitemaps). `--sitemap` automatically detects a
> `<sitemapindex>` and follows every child sitemap, so you get all the real page
> URLs instead of just the handful of child-sitemap links.

Options:

| Flag | Description | Default |
| --- | --- | --- |
| `--platform` | `web` \| `ios` \| `android` \| `react-native` (audit) | `web` |
| `--urls` | URL list file, one per line (`lighthouse`/`axe`) | — |
| `--sitemap` | Scan every page in a sitemap or sitemap index (`lighthouse`/`axe`) | — |
| `--lhr` | Read a saved Lighthouse result JSON (`lighthouse`) | — |
| `--axe` | Read a saved axe result JSON (`axe`) | — |
| `--level` | Target WCAG level `A` \| `AA` \| `AAA` | `AA` |
| `--format` | `console` \| `json` \| `markdown` | `console` |
| `--out` | Write report to a file | stdout |
| `--min-target` | Minimum touch target size (px/dp, audit) | `24` (AA) / `44` (AAA) |
| `--jira` | Create Jira tickets from findings | off |
| `--min-severity` | Only ticket findings at/above this severity | all |

## Baseline automated rules

Each rule maps to WCAG success criteria and is a pure function over the node tree.

| Rule id | Check | WCAG |
| --- | --- | --- |
| `interactive-accessible-name` | Interactive elements have an accessible name | 4.1.2 |
| `button-role` | Buttons expose `role="button"` | 4.1.2 |
| `image-accessibility` | Images/icons have alt text or are hidden | 1.1.1 |
| `touch-target-size` | Touch targets meet minimum size (24px AA / 44px AAA) | 2.5.8 / 2.5.5 |
| `input-label` | Inputs have labels | 3.3.2, 1.3.1 |
| `required-state` | Required fields expose their state | 3.3.2 |
| `disabled-state` | Disabled controls expose disabled state | 4.1.2 |
| `selected-state` | Selected controls expose selected state | 4.1.2 |
| `expanded-state` | Expandable controls expose expanded state | 4.1.2 |
| `status-announcement` | Important status changes are announced | 4.1.3 |
| `decorative-hidden` | Decorative elements are hidden from AT | 1.1.1 |
| `custom-component-props` | Custom components forward a11y props | 4.1.2 |
| `text-contrast` | Text meets minimum contrast | 1.4.3 / 1.4.6 |

## Test matchers

Assert accessibility on individual nodes inside unit tests:

```ts
import { expect } from "vitest";
import { a11yMatchers } from "@bluetread/accessibility-toolkit/matchers";

expect.extend(a11yMatchers);

expect(buttonNode).toHaveAccessibleName();
expect(buttonNode).toHaveRole("button");
expect(iconNode).toBeHiddenFromAccessibility();
expect(touchNode).toMeetTouchTargetSize(44);
```

## What unit tests catch that scanners can't

axe and WAVE are **snapshot scanners**: they inspect one rendered DOM state, at
one moment, and check static attributes. They are blind to anything requiring
**interaction, state changes, time, or knowledge of intent**. The unit-test
suite exists to cover exactly that gap.

> **axe / WAVE** — "Is the accessibility attribute present in this DOM snapshot?"
> **Unit tests** — "Does the component behave accessibly when state changes, time passes, or the user interacts?"

### 1. State that only exists after interaction

A scanner sees the page as it loads and can't click anything.

- **Accordion / disclosure** — does `aria-expanded` actually flip `false`→`true`
  when toggled?
- **Modal focus trap** — open a dialog, tab to the last element, tab again → does
  focus wrap back inside?
- **Menu / dropdown** — after opening, is focus moved to the first item? On `Esc`,
  does it close and return focus to the trigger?

```ts
fireEvent.click(getByRole("button", { name: "Details" }));
expect(getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "true");
```

### 2. Dynamic announcements

axe can confirm a `role="alert"` **exists**, but not that your code **puts the
error text into it at the right time**.

- Submit an invalid form → does the error message land in the live region so it's
  announced?
- A "Saved" toast — does it appear in an `aria-live` region *when the save
  completes*, not just exist empty in the DOM?

### 3. Focus management across flows

- After deleting a row, does focus move somewhere sensible (not to `<body>`,
  which strands screen-reader users)?
- After a route change in an SPA, is focus moved to the new page's heading?

### 4. Correct dynamic labels / values

axe checks a label **exists**; it can't verify it's the **right** label as data
changes.

- A "Like" button that toggles to "Unlike" — does the accessible name update with
  state?
- A slider whose `aria-valuenow` must track the actual value as you drag.
- A count badge — is "3 unread messages" announced, or just a bare "3"?

### 5. Conditional / edge-state rendering

Scanners test whatever state happens to be on screen.

- The **error state** of an input (only rendered after validation fails) — assert
  `aria-invalid` + `aria-describedby` point to the error.
- Loading / empty / disabled variants a page scan would never happen to catch.

### 6. Intent / meaning

- axe **can't tell** if an image is decorative or meaningful — it just warns
  "alt missing." A test for your `Avatar` component encodes the rule: *avatars
  must have the user's name as alt*.
- Whether a heading level is *correct* for the hierarchy vs. just *present*.

This is why the [baseline rules](#baseline-automated-rules) include behavioral
checks like `expanded-state`, `selected-state`, `status-announcement`, and
`custom-component-props` — the state/behavior checks a scanner structurally
cannot perform.

## Jira ticket creation

Turn findings into Jira Cloud issues (Atlassian Document Format descriptions,
priority mapped from severity, WCAG references included):

```ts
import { runAudit, createJiraTickets } from "@bluetread/accessibility-toolkit";

const assessment = runAudit(tree, { platform: "web" });

await createJiraTickets(assessment, {
  baseUrl: process.env.JIRA_BASE_URL!,
  email: process.env.JIRA_EMAIL!,
  apiToken: process.env.JIRA_API_TOKEN!,
  projectKey: "A11Y",
}, { minSeverity: "high" });
```

Or from the CLI with `--jira` (reads `JIRA_*` env vars).

## Scripts & tests reference

Everything you can run, what it does, and how. All arguments after `--` are
passed through to the underlying script.

### npm scripts

| Script | What it does | Run |
| --- | --- | --- |
| `build` | Compiles `src/` to `dist/` (JS + type declarations) via `tsc`. | `npm run build` |
| `dev` | Same as `build` but in watch mode — rebuilds on save. Useful with `npm link`. | `npm run dev` |
| `clean` | Deletes the `dist/` output folder. | `npm run clean` |
| `typecheck` | Type-checks `src` + `scripts` + `tests` with no emit. Fast correctness gate. | `npm run typecheck` |
| `lint` | Runs ESLint across the repo. | `npm run lint` |
| `lint:fix` | Runs ESLint and auto-fixes what it can. | `npm run lint:fix` |
| `test` | Runs **all** unit tests once (Vitest). | `npm test` |
| `test:watch` | Runs all tests in watch mode, re-running on change. | `npm run test:watch` |
| `test:coverage` | Runs all tests and produces a coverage report (`text` + `html`). | `npm run test:coverage` |
| `test:lighthouse` | Runs **only** the Lighthouse integration tests. | `npm run test:lighthouse` |
| `scan:lighthouse` | Standalone Lighthouse runner — one or many pages (see below). | `npm run scan:lighthouse -- <url> [<url> ...]` |
| `scan:axe` | Standalone axe-core runner (Playwright) — one or many pages. | `npm run scan:axe -- <url> [<url> ...]` |
| `prepublishOnly` | Cleans + builds before `npm publish`. Runs automatically on publish. | (automatic) |

### CLI (`bt-a11y`)

Available after `npm run build` as `node dist/cli.js` or, once installed, `bt-a11y`.
Reads `./.env` automatically on Node 20.12+ (for `JIRA_*` variables).

```bash
# Guided audit (same as plain `bt-a11y`): questions → scans → per-screen checklist:
node dist/cli.js start

# Build the audit from the scans + filled-in a11y-audit/checklist.md:
node dist/cli.js report
node dist/cli.js report --jira --min-severity high
node dist/cli.js report --no-pdf          # skip the summary PDF

# Install/check what the summary PDF needs (Chrome, pikepdf, veraPDF):
node dist/cli.js pdf-setup

# Update the toolkit in the current project to the latest commit on GitHub
# (respects a pinned version like #v0.4.0). `bt-a11y start` prints a notice
# when an update is available; set BT_A11Y_NO_UPDATE_CHECK=1 to turn it off.
node dist/cli.js update

# Scan a React Native project's source code:
node dist/cli.js code ./path/to/rn-app --format markdown --out code-scan.md

# Audit a node tree, print the console report:
node dist/cli.js audit ./examples/login-screen.json --platform react-native

# Write a Markdown report to a file:
node dist/cli.js audit ./tree.json --format markdown --out a11y-report.md

# Create Jira tickets from findings (reads JIRA_* env vars):
node dist/cli.js audit ./tree.json --jira --min-severity high
```

See [CLI options](#quick-start-cli) above for the full flag list.

### Standalone tool runners (`scripts/`)

These run independently of each other so you only run the tool you need.

#### `scripts/lighthouse.ts` — `npm run scan:lighthouse`

Runs a Lighthouse accessibility scan (or reads a saved result), converts it
through the toolkit, and prints/writes a report. Can also file Jira tickets.
Pass **multiple URLs** (or a URL list / sitemap) to scan every page and get one
combined report.

```bash
# Live scan (needs Chrome + optional deps):
npm install -D lighthouse chrome-launcher
npm run scan:lighthouse -- https://example.com

# Scan MANY pages -> one combined score/report:
npm run scan:lighthouse -- https://example.com https://example.com/about https://example.com/contact

# Scan every URL listed in a file (one URL per line, `#` comments allowed):
npm run scan:lighthouse -- --urls ./urls.txt

# Scan every page in a sitemap.xml:
npm run scan:lighthouse -- --sitemap https://example.com/sitemap.xml

# Convert a saved Lighthouse result — no Chrome needed:
npm run scan:lighthouse -- --lhr ./examples/sample-lighthouse-result.json

# Choose a format and write to a file:
npm run scan:lighthouse -- https://example.com --format markdown --out lh.md

# Save the raw Lighthouse result for offline/later runs:
npm run scan:lighthouse -- https://example.com --save-lhr ./lhr.json

# File Jira tickets from the findings:
npm run scan:lighthouse -- https://example.com --jira --min-severity high
```

When scanning multiple pages, every finding is tagged with the page it came
from (`evidence.page`), the overall score is the **average** of the per-page
accessibility scores, and the WCAG rollups aggregate every audit across all
pages. A page that fails to load is skipped with a warning rather than aborting
the whole run.

| Flag | Description | Default |
| --- | --- | --- |
| `<url> [<url> ...]` | One or more URLs to scan live (requires `lighthouse` + `chrome-launcher`). | — |
| `--urls <file>` | Read URLs to scan from a file (one per line, `#` comments ignored). | — |
| `--sitemap <url>` | Fetch a `sitemap.xml` and scan every `<loc>` URL in it. | — |
| `--lhr <file>` | Read a saved Lighthouse Result JSON instead of scanning. No Chrome needed. | — |
| `--level <A\|AA\|AAA>` | Target WCAG level. | `AA` |
| `--format <console\|json\|markdown>` | Report format. | `console` |
| `--out <file>` | Write the report to a file. | stdout |
| `--save-lhr <file>` | Save the raw Lighthouse result(s). | — |
| `--jira` | Create Jira tickets from findings (needs `JIRA_*` env vars). | off |
| `--min-severity <critical\|high\|medium\|low>` | Only ticket findings at/above this severity. | all |

### Test files (`tests/`)

Each file can be run on its own with `npx vitest run tests/<file>`.

| Test file | Covers | Run just this |
| --- | --- | --- |
| `tests/rules.test.ts` | The baseline automated rules (accessible name, roles, images, touch targets, labels, contrast, etc.). | `npx vitest run tests/rules.test.ts` |
| `tests/contrast.test.ts` | WCAG contrast math (`parseHex`, `contrastRatio`, large-text + threshold helpers). | `npx vitest run tests/contrast.test.ts` |
| `tests/audit.test.ts` | The audit runner, scoring, WCAG rollups, scorecard, and report formatters. | `npx vitest run tests/audit.test.ts` |
| `tests/jira.test.ts` | Jira payload building, severity filtering, and ticket creation (mocked fetch). | `npx vitest run tests/jira.test.ts` |
| `tests/lighthouse.test.ts` | Lighthouse → `Finding`/`Assessment` conversion and mappings. | `npm run test:lighthouse` |
| `tests/lighthouse-runner.test.ts` | URL discovery: URL list files, sitemaps, and sitemap indexes. | `npx vitest run tests/lighthouse-runner.test.ts` |
| `tests/axe.test.ts` | axe-core → `Finding`/`Assessment` conversion, WCAG tag mapping, multi-page merge. | `npx vitest run tests/axe.test.ts` |
| `tests/checklist.test.ts` | Manual checklist data (covers all 86 criteria, valid WCAG ids, level stacking, platform filtering) and `findingsToAssessment`. | `npx vitest run tests/checklist.test.ts` |
| `tests/rn-code-scan.test.ts` | The React Native code scanner against a generated mini-app: every rule, native config, signals, and no-guess cases (dynamic text, spread props). | `npx vitest run tests/rn-code-scan.test.ts` |
| `tests/update.test.ts` | Reading the installed commit from the project's lockfile, and pinned versions, for `bt-a11y update`. | `npx vitest run tests/update.test.ts` |
| `tests/context.test.ts` | Context docs: navigation-map tables (groups, nested stacks, deep links, "opens on"), Mermaid flows, and merging with screens found in code. | `npx vitest run tests/context.test.ts` |
| `tests/screens.test.ts` | Screen discovery: React Navigation (barrels, path aliases, `getComponent`, nested navigators skipped), static configs, expo-router, folder fallback, feature detection. | `npx vitest run tests/screens.test.ts` |
| `tests/checklist-md.test.ts` | The checklist file: planning (feature-tailored checks), the platform → testing pass → screen → checks layout, ⚑ findings under the right check, parsing marks/issues/Other findings, and carrying answers over (including from earlier layouts). | `npx vitest run tests/checklist-md.test.ts` |
| `tests/summary-pdf.test.ts` | Summary PDF data (cover fields, severity totals match the report, findings named by screen + platform, overrides) and reading veraPDF PASS/FAIL results. | `npx vitest run tests/summary-pdf.test.ts` |
| `tests/coverage.test.ts` | The WCAG 2.2 coverage matrix: level scoping and every status. | `npx vitest run tests/coverage.test.ts` |
| `tests/wizard.test.ts` | The guided audit end to end with scripted answers: React Native, non-RN mobile, and web flows; only setup prompts; checklist written and displayed; filled-in checklist → report; re-run keeps answers. | `npx vitest run tests/wizard.test.ts` |
| `tests/fixtures.ts` | Shared sample `A11yNode` tree used by rule/audit tests (not a test itself). | — |
| `tests/fixtures.lighthouse.ts` | Shared sample Lighthouse Result used by the Lighthouse test (not a test itself). | — |
| `tests/fixtures.axe.ts` | Shared sample axe result used by the axe test (not a test itself). | — |

### Common workflows

```bash
# Fast pre-commit gate:
npm run typecheck && npm run lint && npm test

# Iterate on a single area:
npm run test:watch            # everything, re-run on change
npx vitest tests/rules.test.ts  # just the rules, watch mode

# Try the toolkit against sample data (no external tools required):
node dist/cli.js audit ./examples/login-screen.json --platform react-native
npm run scan:lighthouse -- --lhr ./examples/sample-lighthouse-result.json

# Try the guided audit locally (run it from a scratch folder so the
# a11y-audit/ output doesn't land in this repo):
mkdir -p /tmp/demo-audit && cd /tmp/demo-audit && node ~/path/to/bt-a11y-toolkit/dist/cli.js
```

## Adding a new tool integration

The toolkit is the shared **core**. Each external tool (Lighthouse, axe, WAVE, …)
gets its own thin, independently-runnable script plus its own test — so you run
only what you need, not everything at once. To add one, follow this pattern:

1. `src/integrations/<tool>.ts` — a **pure** function converting the tool's
   output into the toolkit's `Finding`/`Assessment` model. No heavy deps, fully
   unit-testable.
2. `scripts/<tool>.ts` — a standalone runner; add a `"scan:<tool>"` npm script.
3. `tests/<tool>.test.ts` — its own test; add a `"test:<tool>"` npm script.
4. *(Optional)* Offer it in the guided audit: add it to `SCANNERS` (web) or
   `MOBILE_SCANNER` (mobile) in `src/wizard/index.ts`, wire its runner into
   `runStartCommand` in `src/cli.ts`, and extend `tests/wizard.test.ts`.

To add a **code-scan rule**, add it to `RN_RULES` and the checks in
`checkElement` in `src/code-scan/react-native.ts`, plus a case in the
`PROJECT` fixture in `tests/rn-code-scan.test.ts`. Its WCAG ids automatically
count toward the coverage matrix.

To add or change a **manual check**, edit `MANUAL_CHECKLIST` in
`src/checklist.ts` *and* the matching table in
[`docs/MANUAL_TESTING.md`](docs/MANUAL_TESTING.md). Any new WCAG criterion must
also be added to `src/wcag.ts` (the checklist test enforces this).

Because every tool normalizes into the same `Finding` model, results from
multiple sources can later be consolidated and deduplicated into one report.

Programmatic use (Lighthouse example):

```ts
import { lighthouseToAssessment, formatConsole } from "@bluetread/accessibility-toolkit";

const assessment = lighthouseToAssessment(lhr); // lhr = a Lighthouse Result
console.log(formatConsole(assessment));
```

## Project structure

```
src/
  types.ts           A11yNode, Finding, Rule, Assessment types
  wcag.ts            All 86 WCAG 2.2 success criteria
  utils.ts           Tree traversal + node predicates
  contrast.ts        WCAG contrast math (no deps)
  rules.ts           The 13 baseline automated rules
  audit.ts           Audit runner, scoring, scorecard, WCAG rollups
  report.ts          console / json / markdown formatters
  checklist.ts       Manual testing checklist as data — covers all 86 criteria
  context.ts         Context docs: parse navigation maps (tables + Mermaid flows), merge with code screens
  code-scan/
    react-native.ts  React Native source-code scanner (bt-a11y code)
    screens.ts       Screen discovery from navigation code + what each screen contains
  wizard/            Guided audit (bt-a11y start)
    index.ts         The flow: setup questions → automated checks → per-screen checklist
    checklist-md.ts  Plan, render, and parse a11y-audit/checklist.md
    session.ts       Setup + scan results (a11y-audit/session.json) + report output
    coverage.ts      WCAG 2.2 coverage matrix (status per criterion per platform)
    prompts.ts       Prompt interface (inquirer in the CLI, scripted in tests)
  integrations/
    jira.ts          Jira ticket creation
    lighthouse.ts    Lighthouse LHR -> Finding/Assessment (pure)
    lighthouse-runner.ts  Live Lighthouse scans + URL/sitemap discovery
    axe.ts           axe-core results -> Finding/Assessment (pure)
    axe-runner.ts    Live axe scans via Playwright
  pdf/
    summary.ts       Audit → executive-summary PDF data, and running the renderer
    pdfua.ts         PDF/UA-1: auto-installs pikepdf (~/.bt-a11y/pdf-venv), validates with veraPDF
  matchers/
    index.ts         Vitest/Jest assertion matchers
  update.ts          Update check (installed commit vs. GitHub) for bt-a11y update
  cli.ts             bt-a11y command line
assets/pdf/          PDF renderer (render.mjs, headless Chrome) + PDF/UA post-processor (pdfua_fix.py)
scripts/             Standalone, per-tool runners
  lighthouse.ts      npm run scan:lighthouse
  axe.ts             npm run scan:axe
tests/               Unit tests + fixtures
examples/            Sample A11yNode trees + Lighthouse/axe results
docs/                Engagement checklists + manual testing guide
```

## Tooling ecosystem (beyond this repo)

This toolkit is the **consolidation + reporting core**. It doesn't try to be a
device lab or replace commercial platforms — it ingests their output into one
branded, WCAG-scored, Jira-integrated report. Here's what a full engagement
stack looks like around it.

### What BrowserStack Accessibility premium would add

BrowserStack Accessibility is built on **axe-core** and adds a real-device cloud
and dashboards on top. Useful additions:

- **Real-device screen readers** — VoiceOver / TalkBack / JAWS on real hardware,
  no physical lab required for the bulk of testing.
- **Website Scanner** — scheduled, recurring axe scans across many URLs.
- **Workflow Analyzer** — record a journey (login → checkout) and scan each step,
  reaching **authenticated / multi-step** pages a plain URL scan can't.
- **Assisted / guided manual tests** — structured pass/fail capture for the
  manual bucket.
- **Real-device / browser matrix** — thousands of device/OS/browser combos for
  cross-platform coverage.
- **Dashboards & trends** — historical tracking and WCAG mapping.
- **CI/CD SDK** — Cypress / Playwright / Selenium / Jest integration.

**Cost:** paid SaaS, contact-sales/enterprise pricing (no free tier for the
accessibility product). Roughly **~$100+/user/month** billed annually at the low
end, scaling up by seats and device-cloud usage — get a current quote from
BrowserStack for exact numbers.

**Caveats:** it's axe-core underneath (same ~30–40% automated ceiling), it's
strongest on web (native app automation is still limited), and its reports live
in **its** dashboard — the branded, consolidated, multi-source report is still
this toolkit's job. It reduces but doesn't fully retire the need for **1–2
physical devices** for nuanced screen-reader gestures and final sign-off.

### What else you'd likely need (outside this repo + BrowserStack)

| Need | Option(s) | Notes |
| --- | --- | --- |
| **1–2 physical devices** | One modern iPhone + one Android | For fluid SR gestures, haptics, and final conformance sign-off — the "last mile" the cloud can't fully replicate |
| **Desktop screen readers** | NVDA (free), JAWS (paid), VoiceOver (macOS built-in) | For web SR testing not run through a cloud |
| **WAVE API** | WebAIM WAVE API | Optional; credit-based (~$0.01–0.04/credit). Only if a client wants WAVE specifically |
| **axe DevTools Pro** | Deque | Optional; adds guided tests + extra rules beyond free axe-core |
| **Color/contrast tooling** | TPGi Colour Contrast Analyser, Stark | For designer-side and edge-state contrast checks |
| **Jira (or tracker)** | Jira Cloud | Already integrated in this toolkit for ticket creation |
| **Design review** | Figma + a contrast/a11y plugin | Catch issues pre-build during Discovery |
| **CI runner** | GitHub Actions / GitLab CI | To run scans + unit tests automatically per PR |
| **Native test infra** | Xcode + XCUITest, Android Studio + Espresso, Maestro/Detox | For scripted on-device audits on mobile projects |
| **Human expertise** | Trained a11y tester(s) | The screen-reader *experience* and cognitive/usability judgment can't be automated |

### How it fits together

```
BrowserStack (real-device scans, SR on real HW, auth flows) ─┐
axe-core / Lighthouse / WAVE (scans) ───────────────────────┤
Unit-test suites (interaction/state) ───────────────────────┼─► Finding[] ─► THIS TOOLKIT
Physical-device + manual SR findings ───────────────────────┘        consolidate → score →
                                                                     scorecard + WCAG + Jira report
```

## Roadmap

- Code scanners for native iOS (Swift/SwiftUI/UIKit), Android (Kotlin/Compose/XML), and Flutter (React Native is done)
- Platform adapters (`@bluetread/accessibility-toolkit/adapters/react-native`, `/web`)
- Native mobile result imports (XCUITest `performAccessibilityAudit`, Android Espresso/ATF)
- WAVE result import (axe and Lighthouse are done)
- Merge guided-audit sessions from multiple testers (e.g. iOS + Android on separate machines) into one report
- PDF / executive-summary export from the guided audit
- BrowserStack result import (`integrations/browserstack.ts`)
- CI reporter (GitHub Actions annotations)
- Before/after comparison for Phase 3 verification

## License

UNLICENSED — internal BlueTread use only.
