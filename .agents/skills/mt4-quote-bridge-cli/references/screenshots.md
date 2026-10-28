# Screenshots

`screenshot feeds` and `screenshot chart SYMBOL` capture the user's own QuoteBridge app window. They are a health check of what the app looks like, not a data source. Read `mt4-quote-bridge screenshot <feeds|chart> --help` before the first one in a session.

## When

- Take one when the user asks to see the app, asks whether QuoteBridge looks healthy, or when data looks wrong and the window may explain it.
- Take one per question. Each one switches the user's window to Feeds or to that market's chart and leaves it there, even when the window is minimised or in the tray (it is captured without being shown or focused).
- After taking one, tell the user the window's view changed and to what.
- Prices, candles, indicator values and Funds come from `markets` and `accounts` commands. Report numbers from those, not from reading a picture.

## How

1. Check the key: screenshots need a `trader` key (`auth status --json` → `data.key.scope`).
2. For a chart, name the market exactly first (`SYMBOL --broker S` or `--market-id`), as for any market command.
3. Run it with `--output <file> --json`. stdout is small JSON with the health fields plus `path` and `bytes`; open the file with your image-reading tool to look at it. Without `--output`, `--json` carries the whole PNG in base64: avoid it.
4. The file is never replaced without `--force` (exit 13, before the window is touched). Choose a new file name, or pass `--force` only for a file you wrote yourself.

## Reading the result

| Field | Healthy |
| --- | --- |
| `live` | `live`; `connecting`, `reconnecting` or `session-ended` mean the window has lost its link to the app |
| `view` / `symbol` | the view and market you asked for |
| `window` | how the window was: `visible`, `minimised` or `hidden` (tray); information only |

In the image: on Feeds, every expected terminal's group online and quote times moving; on a chart, candles up to now and every indicator drawn. A chart still loading after six seconds is captured as it is; follow up with `markets candles` and `markets show`.

## Refusals

| Exit / code | Meaning | Do |
| --- | --- | --- |
| `4` `insufficient-scope` | `readonly` key | Tell the user a `trader` key is needed; they create it in the app window |
| `7` `window-busy` | a dialog is open in the window; nothing was switched or taken | Tell the user which dialog (the message names it); wait until they close it, then try once |
| `7` `no-feed` | no terminal streams that market | Check `markets show SYMBOL` and `terminals list`; report it |
| `9` `window-unavailable` | no window yet (starting, being recreated) | Wait briefly, try once more, then report |
| `9` `screenshot-timeout` | not captured within ten seconds | Report it; the window may be stuck on a confirmation |
| `13` `output-exists` | the file exists | Pick another `--output` |
| `6` / `5` | the market name | Resolve the market exactly; ask the user when ambiguous |
