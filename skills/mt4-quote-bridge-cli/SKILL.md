---
name: mt4-quote-bridge-cli
description: Read MetaTrader market and account data, prepare demo trades and check QuoteBridge's health with the `mt4-quote-bridge` CLI. Use when asked for MT4 quotes, candles, indicator values, history exports, Funds, positions or pending orders; to place, modify, close or cancel a demo trade; or to see whether the QuoteBridge app looks healthy.
---

# mt4-quote-bridge CLI

The CLI speaks QuoteBridge's REST API v1. Its `--help` is the reference, at every level; this skill says which command to reach for and the rules the help cannot enforce.

## 0. Make sure the CLI is installed

Once per session, before the first command, run the script that ships in this skill's folder:

```sh
node <this skill's folder>/scripts/ensure-cli.mjs
```

It prints `ready <version>` when `mt4-quote-bridge` is on PATH and current. Otherwise it first builds the CLI from GitHub and installs or updates it with npm, so the first run can take a minute. If it exits `1`, show the user its message and stop: it names what they need to fix (Node.js 22.12+, a writable global npm folder, or PATH).

## 1. Let `--help` lead

Every command and every subcommand has `--help`. Drill down only as far as the task needs:

```sh
mt4-quote-bridge --help                    # "Which command": a task → its command
mt4-quote-bridge <command> --help          # "Which subcommand": when to use each, examples
mt4-quote-bridge <command> <sub> --help    # arguments, options, Output (--json shape), Examples, exit codes
```

Read a subcommand's `--help` before its first use in a session, and take flags, value formats and the JSON shape from it rather than from memory.

## 2. Check the connection

Run `mt4-quote-bridge auth status --json`. Exit `0` means signed in; note `data.key.scope`: `readonly` reads; `trader` also takes screenshots and previews, executes and reviews demo trades.

Otherwise hand over to the human: exit `3` means they create a key in the QuoteBridge app window (Settings › API keys) and run `auth login`; exit `1` means the app is unreachable, so confirm it is running and check `config show` with them. Keys, settings, Demo trading and caps belong to the app window alone.

## 3. Pick the command

| The user wants | Command |
| --- | --- |
| which markets or accounts exist | `markets list`, `accounts list` |
| the price now | `markets quote SYMBOL` |
| bars | `markets candles SYMBOL --timeframe TF` |
| every recorded tick | `markets samples SYMBOL` |
| how much history there is, or a CSV/HST file | `markets history SYMBOL`, `markets export …` |
| indicator values | `indicators list` → `indicators show PACKAGE` → `markets indicator PACKAGE SYMBOL …` |
| money, margin | `accounts funds --account A` |
| lot step, stop level, margin per lot | `accounts conditions SYMBOL --account A` |
| open trades, pending orders | `positions list`, `orders list` (`--account A`) |
| a new trade or a change to one | a preview command, then section 6 |
| what happened to a request | `requests show ID` |
| to see the app, or whether it looks healthy | `screenshot feeds`, `screenshot chart SYMBOL`, then section 5 |
| why a market is quiet | `markets show SYMBOL`, `terminals list`, `terminals feeds ID` |

## 4. Name things exactly, read JSON

- A **market** is a broker server plus a symbol; an **account** is a broker server plus a login. Both are exact and case-sensitive. Discover with `markets list --json` and `accounts list --json`, then pass what they return: `SYMBOL --broker <brokerServer>` or `--market-id`, and `--account <id>`.
- Exit `6` lists the candidates in `error.details.candidates`. Ask the user which one they mean, then rerun with the exact identity. The account the user names is the account you use: every account-scoped command carries its own `--account`.
- Pass `--json` whenever you parse output: results on stdout, errors as `{ error: { code, message, details } }` on stderr. Prices, lots and money are decimal strings; times are UTC with a `brokerTime` sibling.
- Before reporting a value, read its freshness: a quote's `state`/`stale`, Funds' and positions' `state` (`fresh`, `stale`, `unavailable`). Say so when it is not fresh.

## 5. Screenshots move the user's window

Before any `screenshot` command, read [references/screenshots.md](references/screenshots.md). A screenshot switches the user's own app window to Feeds or a chart and leaves it there; numbers come from the data commands, never from a picture.

## 6. Trading needs the user's explicit approval of each preview

Before any preview (`orders preview|modify|cancel`, `positions modify|close`), `requests execute` or `requests review`, read [references/trading.md](references/trading.md). The one rule to hold even before reading it: run `requests execute <id> --confirm` only after the user approves that exact preview in this conversation, and answer every uncertain outcome with `requests show <id>`, never with a second execute or preview.

## 7. On an error exit

For any exit code other than `0`, read [references/errors.md](references/errors.md) for what it means and who acts next. Every subcommand's `--help` also ends with its exit codes.

The human-facing manual, with sample output and pictures, is [docs/](https://github.com/ross-jill-ws/mt4-quote-bridge-cli/tree/main/docs) on GitHub.
