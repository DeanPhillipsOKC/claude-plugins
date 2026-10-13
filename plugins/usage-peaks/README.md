# usage-peaks

`/usage` tells you where your plan usage is right now. It doesn't tell you whether you came close to the 5-hour limit yesterday, or how often that happens. This plugin keeps that history.

## What it does

- **Status line:** shows `5h 23% · wk 19%`, updated after each response.
- **`/usage-peaks [days]`:** lists every 5-hour window from the last 14 days (or however many days you pass) with its highest reading, plus how many windows reached 50%, 80% and 90%. Weekly windows are listed under them.
- **`/usage-graph [days]`:** prints a bar graph of 5-hour usage over the last 2 days (up to 30), so the peaks and resets are easy to see. In a terminal it also opens a live pane, with the top two rows (80% and up) in red. From the Claude phone app (Remote Control) it prints a narrow graph that fits the screen. Add `phone` to force that layout.

## How it works

Claude Code tells plugins whenever a plan usage window moves by a whole point. The plugin saves each reading and each window's peak in its own store under `~/.claude`, so the history survives restarts and is shared by every session on the machine. The percentages are account-wide, so usage from other devices and cloud sessions is included in them.

## Limits

- History starts when you install it. Nothing is backfilled.
- A reading is only taken when a Claude Code session on this machine gets a response. A window that starts and ends while Claude Code is closed won't show up.
- It uses Claude Code's function-hook plugin API, which is in early access and may change. Tested on Claude Code 2.1.288.

## Development

```sh
claude plugin validate plugins/usage-peaks
claude plugin test plugins/usage-peaks
```

`tsc -p plugins/usage-peaks` type-checks it once Claude Code has loaded the plugin, since loading writes the engine's typings to `.claude-plugin/types/`.
