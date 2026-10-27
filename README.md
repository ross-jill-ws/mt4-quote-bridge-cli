# mt4-quote-bridge-cli

Command-line client for **QuoteBridge for MetaTrader**. It reads markets, quotes, candles, recorded samples, history,
indicator values, trading accounts, Funds, positions and pending orders, prepares and sends demo trading requests,
and takes screenshots of the app window, all through the app's REST API v1. The full manual, with every command and the API operation it calls, is
`docs/cli.md` in the QuoteBridge repository; the API itself is `docs/rest-api.md`.

```
mt4-quote-bridge <command> <subcommand> [options]
```

Every command has detailed `--help`. The agent skill
[`.agents/skills/mt4-quote-bridge-cli`](.agents/skills/mt4-quote-bridge-cli/SKILL.md) adds the identity model and the
trading protocol for agents.

## Install

Requires Node.js ≥ 22.12 and QuoteBridge with REST API v1.

```sh
npm install
npm run build
npm link            # puts `mt4-quote-bridge` on PATH
```

## Sign in

```sh
mt4-quote-bridge auth server        # prompts; default http://127.0.0.1:5580
mt4-quote-bridge auth login         # prompts for an API key
mt4-quote-bridge auth status
mt4-quote-bridge config show        # effective server, config file, whether a key is saved
```

The app answers on this computer only (`127.0.0.1`, `localhost` or `[::1]`), on the HTTP port in its Settings ›
Connection (5580 by default). Create a key in the **app window › Settings › API keys**: `readonly` reads everything;
`trader` may also preview, execute and review trading requests. Keys, Demo trading, the lot cap and slippage are
managed in the app window only. The key is saved to `~/.mt4-quote-bridge/config.json` with owner-only permissions;
`MT4QB_SERVER`, `MT4QB_API_KEY` and `MT4QB_CONFIG` override the saved values. For scripts, pipe the key to
`auth login --api-key-stdin`.

## Commands

| Family | Subcommands |
| --- | --- |
| `markets` | `list`, `show`, `quote`, `candles`, `samples`, `history`, `export`, `indicator` |
| `accounts` | `list`, `show`, `funds`, `conditions` |
| `positions` | `list`, `show`, `modify` (preview), `close` (preview) |
| `orders` | `list`, `show` (pending orders), `preview` (new order), `modify` (preview), `cancel` (preview) |
| `requests` | `list`, `show`, `execute --confirm`, `review` |
| `indicators` | `list`, `show` |
| `terminals` | `list`, `show`, `feeds` |
| `screenshot` | `feeds`, `chart` (the app window; `trader` key) |
| `auth`, `config` | sign-in and local configuration |

```sh
mt4-quote-bridge markets quote EURUSD --broker EasyForex-Demo
mt4-quote-bridge markets candles EURUSD --broker EasyForex-Demo --timeframe H1
mt4-quote-bridge accounts funds --account <account-id>
mt4-quote-bridge orders preview --account <account-id> --symbol EURUSD --side buy --type market --lots 0.10
mt4-quote-bridge orders preview --account <account-id> --symbol EURUSD --side buy --type market --lots 0.10 --sl-points 200 --tp-points 400
mt4-quote-bridge positions close <ticket> --account <account-id>
mt4-quote-bridge requests execute <request-id> --confirm
mt4-quote-bridge requests show <request-id>
mt4-quote-bridge screenshot chart EURUSD --broker EasyForex-Demo --output chart.png
```

- **Exact identities.** A market is a broker server and a symbol (`SYMBOL --broker <exact server>`, or `--market-id`);
  a symbol alone works only when one broker server has it. An account is its ID, or a login with `--broker`; a bare
  login only when unique. Ambiguity lists the candidates and exits 6. Nothing is matched by substring or case, and
  there is no default account: every account-scoped command names one, and that account fixes the broker server for
  the symbol.
- **Previews, then one execute.** `orders preview|modify|cancel` and `positions modify|close` only preview (valid 30
  seconds). `requests execute <id> --confirm` is the only command that sends anything: it posts once, then only reads
  the request until a definitive result (`--wait`, 25 s by default). It never retries; to find out what happened, run
  `requests show`. An unknown outcome blocks its account, previews included, until a result arrives or you
  `requests review` it after checking MetaTrader.
- **Stops, one form per order.** Absolute prices (`--sl`/`--tp`), distances in points from the entry
  (`--sl-points`/`--tp-points`: a buy's stop loss below it, a sell's above), or a risk plan (one `--risk-*` and
  `--reward-ratio`). Distances and a risk plan are worked out at the previewed entry; mixing forms exits 2.
- **Output.** Tables for people; `--json` prints the REST envelope (`{ data, meta }`) on stdout. Errors and hints go to
  stderr; with `--json`, an error is `{ error: { code, message, details } }` on stderr.
- **Paging.** Collections take `--limit`, `--cursor` (the previous page's `meta.nextCursor`) or `--all`. Candles and
  indicator values page back with `--to`.
- **Exports** need `--output`, never overwrite an existing file without `--force`, and with `--json` print the file's
  metadata, not its bytes.
- **Screenshots** (`screenshot feeds`, `screenshot chart SYMBOL`) check that the app looks healthy. They switch the
  trader's own app window to that view and leave it there, so they need a `trader` key. By default they print the
  window's health (view, market, window state, live link, size, scale, time); `--json` adds the PNG in base64;
  `--output FILE` writes the PNG on this computer under the export rules, and with `--json` prints `path` and `bytes`
  instead of the base64.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success (for `requests show`/`execute`: succeeded, reviewed, or a valid preview) |
| 1 | Other error: the app is unreachable or answered unexpectedly |
| 2 | Usage error, or the app refused a malformed value (400) |
| 3 | Not signed in, or the API key is invalid or revoked (401) |
| 4 | Forbidden (403): readonly key, Demo trading off, symbol not tradable |
| 5 | Not found (404) |
| 6 | Ambiguous symbol or login; the candidates are listed |
| 7 | Conflict (409): cross-broker market, preview expired or invalidated, account unresolved, a real account, no single ready executor, a dialog open in the app window (`window-busy`), no feed for a chart (`no-feed`) |
| 8 | Invalid trading or indicator values (422) |
| 9 | Source or app window unavailable, or the terminal or a screenshot did not answer in time (503, 504); not an order failure |
| 10 | The request's outcome is unknown: never retry; check MetaTrader, then review |
| 11 | The request failed definitively |
| 12 | The request was sent and has no definitive result yet |
| 13 | The output file of an export or screenshot exists and `--force` was not given |

## Development

```sh
npm run typecheck
npm test            # unit tests and the acceptance test
npm run dev -- markets list
```

`tests/acceptance.test.ts` runs the CLI against the real app with simulated EAs, using the QuoteBridge repository's
test fixtures from `QUOTEBRIDGE_REPO` (default `../metatrader-quote-bridge`, whose `npm install` it needs). It is
skipped with a message when that repository is absent.
