# Manual Accessibility Testing

Automated tooling (this toolkit, Lighthouse, axe, WAVE, native scanners) catches
only **~30–40% of WCAG issues** — presence and measurable thresholds. The rest
requires a human to judge **meaning and experience**. This document lists what to
test manually after the automated scans and tests have run, organized by WCAG
level.

> **Rule of thumb**
> **Automated = presence & thresholds** (label exists, contrast ratio, target size).
> **Manual = meaning & experience** (does it make sense, is it operable with AT).

## How WCAG levels stack

- **A** — minimum / blocking barriers.
- **AA** — the standard target (ADA, Section 508, EN 301 549). **Includes all A.**
- **AAA** — enhanced. Rarely a full target; usually cherry-picked. **Includes A + AA.**

So if the engagement targets **AA**, test every **A + AA** item below. Only test
**AAA** items when the client explicitly sets AAA as the target (often for
specific criteria, not the whole app).

Log every manual finding as a `Finding` with `source: "manual"` so it flows into
the same scorecard, WCAG rollup, and Jira tickets as the automated results.

> The guided audit (`bt-a11y start`) turns these checks into a per-screen
> checklist (`a11y-audit/checklist.md`), tailored to what each screen contains;
> `bt-a11y report` turns the filled-in file into findings. Together the tables cover **all 86 WCAG 2.2
> success criteria** (the checklist test enforces this), and the guided audit's
> report shows each criterion's status per platform. Its checklist lives in
> [`src/checklist.ts`](../src/checklist.ts) — **update both files together**
> when adding or changing a check.

---

## Level A — must pass (minimum)

| Manual check | WCAG SC | How to test |
| --- | --- | --- |
| Screen reader announces name, role, and value | 4.1.2 | VoiceOver / TalkBack / NVDA on every control |
| Reading & focus order is logical | 1.3.2 / 2.4.3 | Swipe/Tab through each screen; order matches visual flow |
| Everything operable by keyboard; no keyboard trap | 2.1.1 / 2.1.2 | Keyboard-only pass (web); external keyboard (mobile) |
| Alt text is **meaningful**, not just present | 1.1.1 | Listen to how images/icons are announced |
| Information not conveyed by color alone | 1.4.1 | Check errors, required fields, statuses, chart series |
| Errors are identified and described in text | 3.3.1 | Trigger validation; confirm error is announced & associated |
| Labels/instructions present for inputs | 3.3.2 | Confirm each field has a spoken label |
| Captions for prerecorded video/audio | 1.2.2 | Play media; verify captions |
| Content meaning doesn't rely on shape/position/sound alone | 1.3.3 | "Tap the round button" style instructions have text equivalents |
| Link/button purpose clear in context | 2.4.4 | "Read more" etc. makes sense to a screen reader user |
| Gestures (swipe/pinch/drag) have a single-pointer alternative | 2.5.1 | Try each gesture's tap/button alternative |
| Actions fire on release; dragging off cancels | 2.5.2 | Press, slide off the control, release — nothing should happen |
| Text alternatives for audio-only / video-only; audio description or transcript for video | 1.2.1 / 1.2.3 | Check every prerecorded clip |
| Structure exposed: headings, lists, groups, label–field links | 1.3.1 | Navigate by headings; cards/rows read as one item |
| Autoplaying audio (>3s) can be paused or muted | 1.4.2 | Open screens that may autoplay sound |
| Single-key shortcuts can be turned off or remapped | 2.1.4 | Press letter keys outside text fields |
| Time limits can be turned off, adjusted, or extended | 2.2.1 | Session timeouts, OTP countdowns, auto-advance |
| Moving/auto-updating content can be paused, stopped, or hidden | 2.2.2 | Carousels, looping animations, tickers |
| Nothing flashes more than 3 times per second | 2.3.1 | Watch animations and video |
| Skip link / landmarks bypass repeated content *(web only)* | 2.4.1 | Tab on page load; list landmarks |
| Every page/screen has a descriptive title | 2.4.2 | Browser tab title; screen title announced on navigation |
| Accessible name includes the visible label | 2.5.3 | Voice Control / Voice Access: "Tap <visible label>" |
| Shake/tilt actions have a UI alternative and can be disabled | 2.5.4 | Look for motion-triggered features |
| Language of page/app is set correctly | 3.1.1 | Screen reader uses the right voice; app follows device locale |
| Focus or input changes don't cause unexpected context changes | 3.2.1 / 3.2.2 | Move focus and change pickers/toggles |
| Help appears in the same place on every screen | 3.2.6 | Support link, chat, phone number |
| No re-entering information already given in the same flow | 3.3.7 | Multi-step checkout / sign-up |

## Level AA — standard target (also requires all A)

| Manual check | WCAG SC | How to test |
| --- | --- | --- |
| Visible focus indicator on every control | 2.4.7 | Tab/navigate; confirm focus is always visible |
| Text contrast 4.5:1 (3:1 large); UI/graphics 3:1 | 1.4.3 / 1.4.11 | Check hover, focus, disabled, over images/gradients |
| Reflow at 320px width (web) / largest text + landscape (mobile), no two-way scrolling | 1.4.10 | Zoom/narrow viewport or max text size; content wraps, nothing clipped |
| Text resizes to 200% without loss | 1.4.4 | Increase system/browser text size |
| Text spacing overrides don't break layout *(web only)* | 1.4.12 | Apply spacing bookmarklet |
| Status messages announced without stealing focus | 4.1.3 | Trigger toasts/loading/results; confirm polite announcement |
| Headings & labels are descriptive | 2.4.6 | Review heading text and control labels for clarity |
| Orientation not locked (unless essential) | 1.3.4 | Rotate device portrait ⇄ landscape |
| Touch target minimum 24×24 | 2.5.8 | Measure small/closely-spaced controls |
| Consistent navigation & identification | 3.2.3 / 3.2.4 | Nav and components behave the same across screens |
| Error suggestions provided when known | 3.3.3 | Validation tells the user how to fix it |
| Live captions; audio description for prerecorded video | 1.2.4 / 1.2.5 | Live streams and video with important visuals |
| Personal-data fields identify their purpose (autofill works) | 1.3.5 | Name/email/phone/address/password fields offer AutoFill |
| Real text, not images of text | 1.4.5 | Banners, buttons, headings rendered as images |
| Tooltips/popovers dismissible, hoverable, persistent | 1.4.13 | Hover/focus each tooltip; Esc dismisses |
| More than one way to find a page *(web only)* | 2.4.5 | Navigation plus search, sitemap, or related links |
| Focused element not hidden by sticky headers/footers/overlays | 2.4.11 | Tab through long screens |
| Dragging has a single-pointer alternative | 2.5.7 | Reorder, sliders, swipe-to-dismiss, map panning |
| Other-language passages marked with their language | 3.1.2 | Screen reader switches voice |
| Legal/financial/data submissions can be reviewed, corrected, or reversed | 3.3.4 | Payments, purchases, deletions, agreements |
| No memory/puzzle test to sign in; paste and password managers work | 3.3.8 | Paste into password/OTP fields; use AutoFill |

## Level AAA — enhanced (only if targeted; also requires A + AA)

| Manual check | WCAG SC | How to test |
| --- | --- | --- |
| Enhanced contrast 7:1 (4.5:1 large) | 1.4.6 | Re-measure text contrast to the higher bar |
| Touch target 44×44 (enhanced) | 2.5.5 | Measure interactive targets |
| Motion from interaction can be disabled | 2.3.3 | Respect reduced-motion; no unavoidable animation |
| Sign language for prerecorded audio | 1.2.6 | Verify signed track where required |
| No timing / re-authentication data loss | 2.2.3 / 2.2.5 | Remove or extend time limits |
| Context-sensitive help available | 3.3.5 | Help text/affordances present where needed |
| Extended audio description, media alternatives, live audio alternatives | 1.2.7 / 1.2.8 / 1.2.9 | Check all media |
| Purpose of icons, regions, components is programmatically determinable | 1.3.6 | Roles, landmarks, labels |
| Little or no background audio behind speech | 1.4.7 | Listen to recordings |
| Text blocks customizable and readable | 1.4.8 | Colors, ≤80 chars, not justified, 1.5 spacing |
| No images of text at all | 1.4.9 | Except logos/essential |
| Keyboard with no exceptions | 2.1.3 | Including path-based input |
| Interruptions postponable; data-loss timeouts disclosed | 2.2.4 / 2.2.6 | Alerts, popups, inactivity |
| No flashing at all (3 flashes) | 2.3.2 | No size/brightness exception |
| Location shown, link text alone clear, section headings | 2.4.8 / 2.4.9 / 2.4.10 | Breadcrumbs, selected tab, headings |
| Focus never partially obscured; strong focus indicator | 2.4.12 / 2.4.13 | ≥2px outline-equivalent, 3:1 |
| Switch input methods at any time | 2.5.6 | Touch + keyboard + switch + voice |
| Unusual words, abbreviations, reading level, pronunciation | 3.1.3–3.1.6 | Definitions, expansions, simpler version |
| Context changes only on request | 3.2.5 | No auto-redirects or surprise windows |
| All submissions reviewable/reversible | 3.3.6 | Every form |
| Sign-in with no cognitive test at all | 3.3.9 | Not even object recognition |

---

## Manual test areas checklist

Work these per **primary user flow**, per platform.

### Screen reader (iOS VoiceOver / Android TalkBack / Web NVDA)
- [ ] Names read correctly for all controls
- [ ] Roles announced (button, link, heading, image, etc.)
- [ ] States announced (selected, expanded, disabled, checked, busy)
- [ ] Reading / focus order is logical
- [ ] Dynamic content & status messages announced (no focus steal)
- [ ] Errors announced and associated with the correct field
- [ ] Modals: focus moves in, is trapped, restores on close

### Keyboard / switch / external keyboard
- [ ] All interactive elements reachable and operable
- [ ] Visible focus indicator everywhere
- [ ] No unexpected focus trap; focus never lost
- [ ] Modals manage focus; `Esc` closes where applicable
- [ ] Menus, tabs, sliders, comboboxes support expected key patterns

### Gestures & touch (mobile)
- [ ] Targets reliably tappable; closely-spaced controls don't misfire
- [ ] Complex gestures (swipe/pinch/drag) have a single-pointer alternative
- [ ] Pointer cancellation — action on release; drag-off cancels

### Cognitive / content
- [ ] Alt text is meaningful
- [ ] Heading structure logical and matches visual hierarchy
- [ ] Link/button text makes sense out of context
- [ ] Error messages are clear and actionable
- [ ] Labels don't rely on placeholder text alone

### Visual & sensory
- [ ] Info not conveyed by color alone
- [ ] Contrast holds in hover/focus/disabled and over images
- [ ] Meaning via shape/position/sound has a text equivalent

### Responsive / reflow / zoom
- [ ] Text resize to 200% — no clipping/overlap
- [ ] Text spacing overrides don't break layout
- [ ] Reflow at 320px — no horizontal scroll
- [ ] Orientation works and isn't locked
- [ ] No truncated/overlapping content at large font sizes

### Motion, media & timing
- [ ] Captions/transcripts for media
- [ ] Reduced-motion respected; no unexpected autoplay
- [ ] Time limits can be extended or turned off

---

## Toolkit note: touch-target thresholds are level-aware

`runAudit` sets the touch-target minimum from the target level automatically:

- **A / AA → 24×24** (WCAG 2.5.8, Target Size Minimum)
- **AAA → 44×44** (WCAG 2.5.5, Target Size Enhanced)

Findings are mapped to the matching success criterion, so a 30px target passes
an **AA** audit but is flagged under **AAA**. Override with
`runAudit(tree, { minTouchTargetSize: N })` or the CLI `--min-target N`.
