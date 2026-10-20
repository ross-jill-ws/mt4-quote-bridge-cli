---
name: mt4-quote-bridge-cli
description: Read MT4 market data and place demo orders with the `mt4-quote-bridge` CLI. Use when asked for MT4 quotes, candles, indicator values, price history or CSV exports, positions, balance or margin, or to buy or sell on a demo account.
---

# mt4-quote-bridge CLI

The CLI talks to a Quote Bridge server (REST API v1), which relays live data from MT4 terminals running the QuoteBridge EA. `--help` on every command and subcommand is the reference: arguments, output columns, JSON shape, exit codes and examples. Read a command's `--help` before its first use in a session; this skill covers what the help cannot.

If `mt4-quote-bridge` is not on PATH, run `node dist/cli.js` from this repository (after `npm run build`).

## 1. Check the connection

Run `mt4-quote-bridge auth status --json`. Exit `0` means signed in with a valid key; note `key.scope`.

Otherwise stop and hand over to the human:

- Exit `3` (no key, or invalid, expired or revoked): only the human can create a key, in the dashboard under user icon → **API keys**. Then they run `auth login`, which prompts for it.
- Exit `1` (server unreachable): ask whether the server is running, and check the URL with them (`auth server`).

A `read` (query only) key reads everything. Buying and selling needs a `trade` key.

## 2. Find the exact symbol

Run `mt4-quote-bridge symbol list --json` first. Symbol names are the broker's own (`GOLD30`, `US500`), so map the user's wording to a listed name. The list also gives each symbol's **live periods** (served from an open MT4 chart) and **history periods** (imported). A symbol missing from the list has no MT4 chart with the QuoteBridge EA attached. Tell the user to open one.

For contract details (lot min/step/max, contract size, margin, swaps, expiry), run `symbol <SYMBOL> info --json`. `spec: null` means the EA is older than 1.07; the user must recompile and re-attach it to get those fields.

## 3. Read the data

- Pass `--json` whenever you parse the output; tables are for people.
- Times are MT4 broker-server time, with no time-zone conversion, in both output and `--start` / `--end`. Convert only when the user asks, and say which zone you used.
- When the same symbol comes from several terminals, the command fails with exit `1` and lists the candidates. Narrow it with the flag the error names (`--broker`, `--terminal`, `--feed`, `--history-source` or `--file`) and rerun.

There are two kinds of history, and choosing between them is the usual branch:

| Need | Command | Reads |
| --- | --- | --- |
| Bars already imported on the dashboard | `hist list`, `hist <SYMBOL> <PERIOD>` | the server database |
| Everything MT4 has on disk, or a CSV file | `hist files`, `hist download <SYMBOL> <PERIOD>` | the `.hst` file directly; no import step, no row limit |

When the history is shorter than the user needs, tell them: in MT4, raise **Max bars in history** (Tools → Options → Charts), then scroll the chart back so MT4 downloads older bars into the `.hst` file.

## 4. Place an order (only when the user asks to trade)

Orders are demo-account only, and every one needs the user's explicit go-ahead for that exact order.

1. Run the order with `--dry-run --json`. Show the user the preview: symbol, side, lots, entry, SL/TP and account.
2. Wait for the user to confirm that preview. Then rerun the same command with `--yes`. A preview expires after 30 seconds, so the confirmed run previews again.
3. Read the exit code:
   - `0`: executed. Report the ticket.
   - `1`: rejected. Report the server's reason.
   - `4`: nothing was sent.
   - `5`: result unknown. Stop and report it. Check `position --all` and ask the user to look in MT4; a retry could open a second position.

Modifying, closing and cancelling orders is dashboard-only. Point the user there.
