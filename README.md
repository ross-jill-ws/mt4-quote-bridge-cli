# mt4-quote-bridge-cli

Command-line client for the **MT4 Quote Bridge** server
(`mt4-server-zeromq`). It reads symbols, live candles and quotes,
server-calculated indicators and imported history, and places demo orders,
all through the server's REST API v1 (`docs/rest-api.md` in the server repo).

```
mt4-quote-bridge <command-main> [command-sub] [options]
```

Command names are always singular (`symbol`, `position`, `indicator`, …).
Every command and subcommand has detailed `--help`, written so that agent
skills can rely on it: arguments, output columns, JSON shape, exit codes and
examples. The agent skill
[`.agents/skills/mt4-quote-bridge-cli`](.agents/skills/mt4-quote-bridge-cli/SKILL.md)
adds the workflow on top: sign-in checks, symbol lookup, which history
command to use, and confirming orders with the user.

## Install

Requires Node.js ≥ 22.12 and a Quote Bridge server with REST API v1.

```sh
npm install
npm run build
npm link            # puts `mt4-quote-bridge` on PATH
# or run without linking: node dist/cli.js ... / npm run dev -- ...
```

## Sign in

```sh
mt4-quote-bridge auth server        # prompts: Server URL [http://localhost:3000]:
mt4-quote-bridge auth login         # prompts for an API key
mt4-quote-bridge auth status
mt4-quote-bridge auth logout
```

`auth server` saves the server URL. When you run it without a URL it prompts,
with the saved server (or `http://localhost:3000`) as the default. You can
also pass the URL directly: `auth server http://192.168.1.20:3000`. The URL is
checked against `/api/v1/info` before it is saved. Switching to another server
removes the old API key. If no server is saved yet, `auth login` prompts for
one too. `auth logout` keeps the server and removes only the saved key.

Login asks only for an **API key**. Create one in the dashboard: user icon (top
right) → **API keys** → **Create key**. Choose a scope:

| Scope            | Allows                                                            |
| ---------------- | ----------------------------------------------------------------- |
| Query only       | symbols, quotes, candles, indicators, history, positions, budget  |
| Query + buy/sell | everything above, plus `symbol buy` / `symbol sell` (demo orders) |

Expiry is optional (1 week, 1, 3, 6 or 12 months). The key (`qbk_…`) is shown
once. `auth login` checks it with the server, then saves it to
`~/.mt4-quote-bridge/config.json` with owner-only permissions. For scripts,
pipe the key in with `--api-key-stdin`. `MT4QB_SERVER`, `MT4QB_API_KEY` and
`MT4QB_CONFIG` override the saved values. `auth logout` deletes the key only
locally; revoke it in the dashboard to disable it everywhere.

## Commands

| Command | What it does |
| --- | --- |
| `symbol list [--online]` | Symbols with broker, status, last bid/ask, **live periods** and **history periods** |
| `symbol AUDUSD 1H [30]` | Last N OHLC candles (live EA chart, else imported history; `--source`) |
| `symbol AUDUSD` / `symbol AUDUSD ask` / `bid` | Current quote, or a single price for scripts |
| `symbol XAUUSD info` | Lot min/step/max, tick value, stop levels; contract size, margin, swaps and expiry (EA 1.07+) |
| `symbol AUDUSD buy\|sell <lots> [--sl P] [--tp P]` | Market order (demo accounts only) |
| `symbol AUDUSD buy-limit\|sell-limit\|buy-stop\|sell-stop <lots> <price> [--sl] [--tp] [--expiration]` | Pending order |
| `indicator list` | Enabled indicators and their parameters |
| `indicator macd` | One indicator's parameters/ranges/outputs |
| `indicator macd AUDUSD 1H [30] [-p fast=8,slow=21]` | Last N values, calculated on the server |
| `hist list` | Imported history: symbol, period, bar count, time range |
| `hist AUDUSD 1H --start 20260901 --end 20261017 [--json\|--csv]` | Imported bars for a range (auto-paged) |
| `hist files [--symbol S] [--period P]` | MT4 `.hst` files on the server (imported or not), bar count and range |
| `hist download GOLD30 M30 [--start D] [--end D] [-o FILE\|-]` | Save a `.hst` file as CSV, read directly: no import, no row limit (`--file` when several terminals match) |
| `position [list] [--pending\|--all] [--symbol S]` | Open positions (or pending orders) across online accounts, with net P/L and per-account totals |
| `position <ticket>` | Every field of one position or pending order |
| `budget [login]` | Balance, equity, floating P/L, used/free margin, margin level, trading permission |
| `account list` / `account show <login>` | Accounts, trading permission, balance and orders |

The shorthand (subject before action) is rewritten to canonical subcommands,
so `symbol AUDUSD buy --help` and `symbol buy --help` both show the buy help.

Output is a table by default. `--json` prints the full server response and
`--csv` prints row data. Bar times are MT4 broker-server time, shown without
time-zone conversion. Dates passed to `--start` / `--end` are read the same
way.

### Orders

Orders go through the same server-side preview and validation as the
dashboard: lot limits, `DEMO_MAX_ORDER_LOTS`, SL/TP side and distance,
demo-only, and exactly one executor EA. After the preview, the CLI asks for
confirmation. `--yes` skips the prompt and `--dry-run` only validates. With
no terminal and no `--yes`, nothing is sent (exit code 4).

### Exit codes

`0` success · `1` error · `3` not signed in / API key invalid or expired ·
`4` order not executed · `5` order result unknown (check MT4 before retrying).

## Remote use (outside your network)

Expose the server over HTTPS, for example with ngrok (`ngrok http 3000`; see
"Remote CLI access through ngrok" in the server README). Then on any machine:

```sh
mt4-quote-bridge auth server https://<name>.ngrok-free.dev
mt4-quote-bridge auth login
```

If you enter an `http://` URL and the server redirects to `https://` on the
same host, the CLI saves the `https://` URL automatically. It never follows
any other redirect, so your API key is only ever sent to the server you
configured.

## Development

```sh
npm run typecheck
npm test            # unit tests (node:test via tsx)
npm run dev -- symbol list
```

Not yet available from the CLI (dashboard only): adding/removing recorded
symbols, HST import, indicator package management, and modifying, closing or
cancelling orders.
