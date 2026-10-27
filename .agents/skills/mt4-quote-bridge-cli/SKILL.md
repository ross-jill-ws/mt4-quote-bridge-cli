---
name: mt4-quote-bridge-cli
description: Read MetaTrader market and account data, and prepare demo trades, with the `mt4-quote-bridge` CLI for QuoteBridge. Use when asked for MT4 quotes, candles, indicator values, history exports, Funds, positions or pending orders, to place, modify, close or cancel a demo trade, or to check that the QuoteBridge app looks healthy.
---

# mt4-quote-bridge CLI

The CLI speaks QuoteBridge's REST API v1. Every command's `--help` is the reference for arguments, JSON shape and exit codes; read it before a command's first use in a session. This skill covers what the help cannot: the identity model and the trading protocol.

If `mt4-quote-bridge` is not on PATH, run `node dist/cli.js` from this repository after `npm run build`.

## 1. Check the connection

Run `mt4-quote-bridge auth status --json`. Exit `0` means signed in; note `key.scope` (`readonly` reads, `trader` may also preview, execute and review).

Otherwise hand over to the human: exit `3` means they create a key in the QuoteBridge app window (Settings › API keys) and run `auth login`; exit `1` means the app is unreachable, so confirm it is running and check `config show` with them. Keys, settings, demo-trading enablement and caps belong to the app window alone.

## 2. Name things exactly

- A **market** is a broker server plus a symbol; an **account** is a broker server plus a login. Both are exact and case-sensitive.
- Discover with `markets list --json` and `accounts list --json`, then pass what they return: `SYMBOL --broker <brokerServer>` or `--market-id`, and `--account <id>`.
- Exit `6` lists the candidates in `error.details.candidates`. Ask the user which one they mean, then rerun with the exact identity. The account the user names is the account you use: every account-scoped command carries its own `--account`.
- Pass `--json` whenever you parse output. Prices, lots and money are decimal strings; times are UTC with a `brokerTime` sibling.

## 3. Screenshots move the trader's window

`screenshot feeds` and `screenshot chart SYMBOL` capture the user's own app window. Use them to check that the app looks healthy (feeds streaming, a chart drawn, the live link up), not to read data: quotes, candles and indicator values come from the `markets` commands.

- A screenshot switches the window to Feeds or to that market's chart and leaves it there, even when it is minimised or in the tray. Take one when the user asks to see the app or when data looks wrong, not routinely, and tell them the window's view changed.
- It needs a `trader` key; a `readonly` key exits `4`. Exit `7` `window-busy` means a dialog is open in the window: tell the user, don't retry until they close it. Exit `7` `no-feed`: no terminal streams that market. Exit `9`: no window to capture or the capture timed out.
- To look at the image, pass `--output <file>` (add `--force` to replace one); `--json` then reports `path` and `bytes`. Without `--output`, `--json` carries the PNG in base64.

## 4. Trade only with explicit authorization

Trading is demo-only and always the user's decision. The agent prepares previews; the user approves each one.

1. Act only when the user asks for a specific trade: account, market, side, size and stops come from them. Fill nothing in on their behalf. Stops take the user's form: prices (`--sl`/`--tp`), points from the entry (`--sl-points`/`--tp-points`) or a risk plan (`--risk-*` with `--reward-ratio`), one form per order.
2. Preview with `--json` (`orders preview`, `orders modify|cancel`, `positions modify|close`). A preview sends nothing.
3. Show the user the preview: account, normalized intent, limits, estimates and every warning (an outside trade, missing stops). It expires 30 seconds after `createdAt`.
4. Run `requests execute <request-id> --confirm` only after the user explicitly approves that exact preview in this conversation. `--confirm` records their approval; it never replaces it. An expired or changed preview (exit `7`) needs a fresh preview and fresh approval.
5. Read the exit status and report it:
   - `0` succeeded: report the ticket.
   - `11` failed: report MetaTrader's code and message.
   - `12` sent, no result yet: check later with `requests show <request-id>`.
   - `10` unknown: stop. Report it and ask the user to check MetaTrader's open orders and account history. The account stays blocked until a result arrives or the user reviews it.

Every request ID is executed at most once. To learn what happened to one, read it with `requests show <request-id>`: a new preview or execute could open a second trade. A lost answer, a timeout and an unknown outcome are all answered by reading, never by sending again.

Review (`requests review <id> --note "…" --acknowledge`) records what the user found in MetaTrader. Run it only with the user's own note after they say they checked; it lifts the block and never resends.

Real accounts are read-only: their exit `7` `executor-real-account` is final. Exit `4` `trading-disabled` means Demo trading is off in the app window's Settings, which only the user can switch on.
