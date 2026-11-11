# Screen reader workflows

Runs real VoiceOver (macOS) through scripted steps on a page and saves what it
said. Built on [Guidepup](https://www.guidepup.dev/) + Playwright.

```bash
npm run sr:test                    # run every workflow
npm run sr:test -- -g "Login"      # only workflows whose name contains "Login"
```

Keep hands off the keyboard and mouse while it runs: VoiceOver drives the whole Mac.
Transcripts are saved to `reports/screen-reader/<workflow-file-name>.json`.

## Writing a workflow

Add a JSON file to `workflows/`. One file = one workflow = one transcript.

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

### Steps

Each step has exactly one action, plus an optional `expect`.

| Step | What it does |
|---|---|
| `{ "read": "page" }` | Moves through every item to the end of the page (VO+→ repeatedly) |
| `{ "next": 3 }` | Moves to the next item, N times |
| `{ "find": "heading" }` | Jumps to the next `heading`, `link`, `control`, `table`, `list` or `graphic` |
| `{ "focus": "#email" }` | Moves keyboard focus (and the VoiceOver cursor) to a CSS selector |
| `{ "type": "text", "into": "#email" }` | Types text; `into` focuses the field first (optional) |
| `{ "press": "Tab" }` | Presses a key: `Tab`, `Enter`, `Space`, `Escape`, `ArrowDown`, `Shift+Tab`… |
| `{ "activate": "button.save" }` | Activates an element (VO+Space); `true` activates the current item |
| `{ "wait": 1000 }` | Waits N milliseconds |

`"expect": "text"` checks that VoiceOver said that text (case-insensitive)
during the step. Failed checks and failed steps are reported at the end; they
never stop the run, so the transcript always covers the whole workflow.
