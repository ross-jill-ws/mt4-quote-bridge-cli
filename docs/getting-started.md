# Getting started

[Manual](README.md) › Getting started

## What you need

- **QuoteBridge for MetaTrader** running on the same computer, with REST API v1. The app answers on this computer
  only (`127.0.0.1`, `localhost` or `[::1]`), on the HTTP port shown in its **Settings › Connection** (5580 by
  default).
- **Node.js 22.12 or newer.**
- For market and account data, at least one MT4 terminal running the QuoteBridge EA and connected to the app.

## Install

From a clone of this repository:

```sh
npm install
npm run build
npm link            # puts `mt4-quote-bridge` on your PATH
mt4-quote-bridge --version
```

`--version` prints the CLI's version and the REST API version it speaks, such as `0.2.0 (REST API v1)`. Without
`npm link`, run `node dist/cli.js …` from the repository instead.

## Create an API key (in the app window)

Every command but `auth` and `config` needs an API key, and keys are made **only in the QuoteBridge app window**:
**Settings › API keys › create a key**. The key looks like `qbk_` followed by 64 hexadecimal characters and is shown
once; copy it straight into `auth login`.

Choose its scope for what the CLI should be allowed to do:

| Scope | Allows |
| --- | --- |
| `readonly` | Every read: markets, quotes, candles, samples, history, exports, indicator values, accounts, Funds, conditions, positions, orders, the request journal, indicators, terminals |
| `trader` | Everything `readonly` does, plus **screenshots** (they change the window's view) and trading: **previews**, `requests execute` and `requests review` |

Trading also needs **Demo trading** switched on in the app window's Settings, and works on demo accounts only. Keys,
Demo trading, the lot cap and slippage are managed in the app window; no command changes them.

## Sign in

```sh
mt4-quote-bridge auth server        # prompts: Server URL [http://127.0.0.1:5580]:   (Enter keeps it)
mt4-quote-bridge auth login         # prompts: API key:   (input hidden)
mt4-quote-bridge auth status        # checks the key with the app
```

A successful `auth status` looks like:

```text
Server:   http://127.0.0.1:5580
User:     admin
API key:  laptop-cli (qbk_1a2b…)
Scope:    trader: reads, screenshots, previews, execute, review
Expires:  never
Source:   C:\Users\you\.mt4-quote-bridge\config.json
```

The key is saved in `~/.mt4-quote-bridge/config.json` with owner-only permissions. Details, prompts, redirects and
environment variables are in [Sign-in and configuration](auth-and-config.md).

### In scripts and CI

No prompt is needed when the key comes from stdin or the environment:

```sh
echo "$QB_API_KEY" | mt4-quote-bridge auth login --server http://127.0.0.1:5580 --api-key-stdin
# or, without saving anything:
MT4QB_API_KEY="$QB_API_KEY" mt4-quote-bridge markets list --json
```

## First commands

```sh
# 1. Which markets exist? Note the exact symbol and broker server.
mt4-quote-bridge markets list

# 2. The price now, and the last 24 hourly bars.
mt4-quote-bridge markets quote EURUSD --broker EasyForex-Demo
mt4-quote-bridge markets candles EURUSD --broker EasyForex-Demo --timeframe H1 --limit 24

# 3. Which accounts exist? Note the account ID.
mt4-quote-bridge accounts list

# 4. That account's money and open trades.
mt4-quote-bridge accounts funds --account <account-id>
mt4-quote-bridge positions list --account <account-id>

# 5. Does the app look healthy? (trader key; switches the window to Feeds)
mt4-quote-bridge screenshot feeds --output feeds.png
```

Add `--json` to any of them for machine-readable output (see [Concepts › Output](concepts.md#output)).

## Where next

- Unsure which command fits? `mt4-quote-bridge --help` has a *Which command* table, and every family's `--help` has a
  *Which subcommand* list.
- Before using a subcommand for the first time, read its own `--help`: options, output, examples and exit codes.
- To trade, read [Trading requests](trading.md) first.
