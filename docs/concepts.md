# Concepts

[Manual](README.md) › Concepts

The rules every command shares: how things are named, what is printed where, how numbers, times and pages work, and
how files are written.

## Identities

QuoteBridge names everything exactly. Nothing is matched by substring, case, alias or a remembered default, and there
is no interactive picker: when a name could mean two things, the CLI lists the candidates and stops.

| Thing | Is | Name it with |
| --- | --- | --- |
| **Market** | one broker server + one symbol | `SYMBOL --broker <broker server>`, or `--market-id <id>`; `SYMBOL` alone only when one broker server has it |
| **Account** | one broker server + one login, however many terminals share it | `--account <account-id>`, or `--account <login> --broker <broker server>`; a bare login only when one broker server has it |
| **Ticket** | MetaTrader's number for a position or pending order, unique only within its account | `TICKET --account …` (always both) |
| **Request** | one preview and, once executed, its journal record | its 32-character hexadecimal request ID |
| **Terminal** | one running MT4 with the QuoteBridge EA | its terminal ID, such as `mt4-aaaaaaaaaaaa` |
| **Feed** | one chart of one terminal | its feed ID, such as `["mt4-aaaaaaaaaaaa","EURUSD"]` |
| **Indicator package** | an enabled indicator | its package ID, such as `quotebridge.macd` |

Symbols and broker servers are case-sensitive: `EURUSD` and `eurusd` are two markets, and `EasyForex-Demo` is not
`easyforex-demo`. Discover the exact names first:

```sh
mt4-quote-bridge markets list --symbol EURUSD
mt4-quote-bridge accounts list
```

### When a name is ambiguous

```text
$ mt4-quote-bridge markets quote EURUSD
error: "EURUSD" is on 2 broker servers. Add --broker <exact broker server> or use --market-id. (ambiguous-market)
  - <market-id-1>  EasyForex-Demo  EURUSD
  - <market-id-2>  EasyForex-Real  EURUSD
$ echo $?
6
```

With `--json`, the candidates are in `error.details.candidates` on stderr:

```json
{ "error": { "code": "ambiguous-market", "message": "\"EURUSD\" is on 2 broker servers. …",
  "details": { "candidates": [ { "marketId": "…", "brokerServer": "EasyForex-Demo", "symbol": "EURUSD" },
                               { "marketId": "…", "brokerServer": "EasyForex-Real", "symbol": "EURUSD" } ] } } }
```

Pick one and run the command again with the exact identity. An agent asks the user which one they meant.

### The account fixes the broker server

Commands that take both an account and a symbol (`accounts conditions`, `orders preview`) look the symbol up on the
**account's** broker server, so `--account <id> --symbol EURUSD` is never ambiguous. A market from another broker
server is refused with `cross-broker-market` (exit 7).

### No default account

There is no saved, active or default account. Every account-scoped command names its account, every time. A script
or agent that works on one account passes the same `--account` to each command.

## Output

| Stream | Carries |
| --- | --- |
| **stdout** | Results only: a table or `label: value` lines for people, or with `--json` the API's envelope |
| **stderr** | Everything else: errors, hints such as the next page's `--cursor`, staleness notes, the execute command after a preview |

So `mt4-quote-bridge markets list --json > markets.json` always gives valid JSON, and a hint never ends up in a pipe.

### `--json`

`--json` prints the REST API's envelope exactly as the app answers it:

```json
{ "data": { … } , "meta": { … } }
```

- `data` is an object for one thing and an array for a collection.
- `meta` carries paging (`count`, `limit`, `nextCursor`, or `next.to`) and context such as an account's `currency`
  and `state`, or an indicator's `outputs`.
- With `--json`, an error is `{ "error": { "code", "message", "details" } }` on **stderr**, and stdout stays empty.

`code` is stable; `message` is for people and may change. The codes are listed in
[Troubleshooting](troubleshooting.md#error-codes).

### Tables

Tables are for reading, not parsing: their columns may change. Parse `--json`. An error's `details.reason` (an
indicator's or the EA's explanation) is printed on the line below its message.

## Numbers and times

- **Prices, lots and money are decimal strings** (`"1.10015"`, `"0.1"`, `"-1.25"`), never JSON numbers, so nothing
  is rounded on the way. Pass decimals as plain digits on the command line: `--lots 0.10`, `--price 1.08500`.
- **Unavailable values are `null`**, never zero. MetaTrader's "no stop loss" is `null`.
- **Times are UTC ISO-8601** (`2027-01-15T08:00:00.000Z`). Where MetaTrader stamps broker time, a sibling
  `brokerTime` (or `…BrokerTime`) gives the broker server's wall clock without an offset (`2027-01-15T10:00:00`).
- **`--from` and `--to`** take UTC as `YYYY-MM-DDTHH:MM:SS[.sss]Z`, or a date `YYYY-MM-DD`: the start of that UTC
  day for `--from`, its last second for `--to`. `--from 2027-01-01 --to 2027-01-31` is all of January.
- **`--expiry`** takes UTC whole seconds, `YYYY-MM-DDTHH:MM:SSZ`; on a modify, `none` removes it.
- **Spreads, stop levels and distances** are in points (the market's smallest price step).

## Paging

Two kinds of collection page differently.

**Cursor-paged** (markets, accounts, positions, orders, the request journal, indicators, terminals, feeds, samples):

| Option | Effect |
| --- | --- |
| `--limit N` | items per page (100 by default, 500 at most; samples 1,000 by default, 10,000 at most) |
| `--cursor C` | the page after the one whose `meta.nextCursor` was `C` (the table output prints it on stderr) |
| `--all` | follow every cursor and print one envelope with everything |

`--all` keeps the last page's other `meta` (such as an account's `currency` and `state`) and replaces paging with
`count`, `pages` and `nextCursor: null`. `--all` and `--cursor` together are a usage error.

**Time-paged** (`markets candles`, `markets indicator`): the newest `--limit` bars (900 by default, 5,000 at most)
whose start is between `--from` and `--to`, oldest first. To go further back, pass `--to` with `meta.next.to`; the
table output prints `Older: add --to …` on stderr. `meta.next` is null once `--from` or the oldest bar is reached.

## Files

`markets export` and `screenshot … --output` write files on the CLI's own computer under the same rules:

- `--output FILE` names the file; a relative path is taken from the current directory and reported as absolute.
- An existing file is **never replaced** unless `--force` is given: without it the command exits 13
  (`output-exists`), and a screenshot refuses before the app window is touched.
- A refused or interrupted write leaves **no new file**. With `--force`, a screenshot replaces the old file only once
  the new PNG is complete; an export overwrites it as it streams, and an interrupted export removes it.
- With `--json`, stdout gets the file's metadata (`path`, `bytes`, …), never its bytes.

## Freshness

Data says how fresh it is; read it before you trust a number.

| Where | Field | Values |
| --- | --- | --- |
| `markets quote` | `state`, `stale` | `connected`, `last-known` (offline), `recorded` (from samples); `stale` when offline, silent or unchanged for ten seconds |
| Funds, positions, orders | `state` (`meta.state` for lists) | `fresh` read now, `stale` the last snapshot of an offline account, `unavailable` none since the app started |
| `terminals`, feeds | `connected`, `online`, `stale` | a terminal is connected with a hello in the last seven seconds |
| screenshots | `live` | `live`, `connecting`, `reconnecting`, `session-ended` |

## Exit codes

Every command exits with a stable code: 0 for success, 1–9 and 13 for errors, and 10–12 for a trading request's
outcome. Each subcommand's `--help` ends with the list, and [Troubleshooting](troubleshooting.md) explains each one
and what to do next.

## Configuration

The server URL and API key are saved in `~/.mt4-quote-bridge/config.json`. `MT4QB_CONFIG` moves that file, and
`MT4QB_SERVER` and `MT4QB_API_KEY` override the saved values for one run. See
[Sign-in and configuration](auth-and-config.md).
