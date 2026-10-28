# Markets

[Manual](README.md) › Markets

A **market** is one broker server and one exact symbol: `EURUSD` on `EasyForex-Demo` and `EURUSD` on
`EasyForex-Real` are two markets. Every `markets` subcommand only reads, so a `readonly` key is enough.

| Subcommand | Use it for | API |
| --- | --- | --- |
| [`list`](#markets-list) | Finding a market's exact symbol, broker server and ID (start here) | `GET /markets` |
| [`show`](#markets-show) | Digits, connection, recording and source terminals | `GET /markets/{id}` |
| [`quote`](#markets-quote) | The price now, with its age and source | `GET /markets/{id}/quote` |
| [`candles`](#markets-candles) | OHLC bars of a timeframe | `GET /markets/{id}/candles` |
| [`samples`](#markets-samples) | Every recorded bid/ask | `GET /markets/{id}/samples` |
| [`history`](#markets-history) | How much closed-bar history each timeframe has | `GET /markets/{id}/history` |
| [`export`](#markets-export) | A CSV or MetaTrader HST file of closed bars | `GET /markets/{id}/export` |
| [`indicator`](#markets-indicator) | An indicator's values over the same bars as candles | `GET /markets/{id}/indicators/{package}` |

## Choosing between them

```text
Need a price right now?                  → markets quote
Need bars to analyse or chart?           → markets candles   (newest N, page back with --to)
Need every tick that was recorded?       → markets samples   (only recorded markets)
Need to know how far back data goes?     → markets history
Need a file for Excel, Python or MT4?    → markets export
Need RSI, MACD, moving averages…?        → indicators list → indicators show → markets indicator
Does a terminal stream this market?      → markets show       (and terminals feeds for detail)
```

## Naming the market

Every subcommand but `list` takes one market, named one of two ways:

| Form | Example | Works when |
| --- | --- | --- |
| `SYMBOL` | `markets quote EURUSD` | only one broker server has `EURUSD` |
| `SYMBOL --broker S` | `markets quote EURUSD --broker EasyForex-Demo` | always: the exact symbol on the exact broker server |
| `--market-id ID` | `markets quote --market-id <market-id>` | always: the ID from `markets list` |

`--market-id` cannot be combined with `SYMBOL` or `--broker`. An ambiguous symbol exits 6 with the candidates; an
unknown one exits 5. See [Concepts › Identities](concepts.md#identities).

Every subcommand also takes `--json` (print the API's envelope) and `-h, --help`.

## markets list

List every known market: those with a feed now, recorded, saved, or in a terminal's HST folder; ordered by symbol,
then broker server.

```text
mt4-quote-bridge markets list [--broker S] [--symbol S] [--limit N] [--cursor C | --all] [--json]
```

| Option | Meaning |
| --- | --- |
| `--broker S` | only markets on this exact broker server |
| `--symbol S` | only this exact symbol |
| `--limit N` | markets per page, 1–500 (100 by default) |
| `--cursor C` / `--all` | the next page / every page ([paging](concepts.md#paging)) |

```text
$ mt4-quote-bridge markets list --symbol EURUSD
SYMBOL  BROKER SERVER   DIGITS  CONNECTED  RECORDING  MARKET ID
------  --------------  ------  ---------  ---------  -----------
EURUSD  EasyForex-Demo       5  yes        yes        <market-id>
EURUSD  EasyForex-Real       5  no         no         <market-id>
```

`--json`: `data` is an array of `{ id, brokerServer, symbol, label, digits, connected, recording, sources }`.

## markets show

One market's identity and the terminals that feed it.

```text
$ mt4-quote-bridge markets show EURUSD --broker EasyForex-Demo
Market:     EURUSD · EasyForex-Demo
Market ID:  <market-id>
Digits:     5
Connected:  true
Recording:  true
Sources:    mt4-aaaaaaaaaaaa, mt4-bbbbbbbbbbbb (offline)
```

`--json`: `data` is `{ id, brokerServer, symbol, label, digits, connected, recording, sources: [{ terminalId, feedId,
connected }] }`.

## markets quote

The best source's current quote. Within the market, the app picks the connected source with the newest broker quote
(then the newest receipt), and fails over by itself; you never choose a terminal.

```text
$ mt4-quote-bridge markets quote EURUSD --broker EasyForex-Demo
Market:           EURUSD · EasyForex-Demo
Bid:              1.10000
Ask:              1.10015
Spread (points):  15.0
Time (UTC):       2027-01-15T08:00:00.000Z
Broker time:      2027-01-15T10:00:00
State:            connected
Quote age:        0 ms
Source:           mt4-aaaaaaaaaaaa
```

**Read `State` before trusting the price:**

| State | Meaning |
| --- | --- |
| `connected` | a connected terminal is streaming it |
| `last-known` | no source is connected; this is the last quote one sent |
| `recorded` | no feed at all; this is the last recorded sample |
| `…, stale` | offline, silent for five seconds, or the quote time has not moved for ten seconds |

A weekend's old quote is not a disconnection. With no feed and nothing recorded, the command exits 9
(`quote-unavailable`).

`--json`: `data` is `{ marketId, brokerServer, symbol, digits, bid, ask, spread, time, brokerTime, state, stale,
quoteAgeMs, sourceSilenceMs, sourceSilent, provenance: { terminalId, feedId, receivedAt } }`.

For one account's own bid/ask and its contract (lot sizes, stop levels), use
[`accounts conditions`](accounts.md#accounts-conditions).

## markets candles

The chart's bars, as the app's Charts view shows them: the newest `--limit` bars whose start is between `--from` and
`--to`, oldest first. The newest live bar is still forming.

```text
mt4-quote-bridge markets candles SYMBOL --timeframe TF [--from UTC] [--to UTC] [--limit N] [--json]
```

| Option | Meaning |
| --- | --- |
| `--timeframe TF` | required: `M1 M5 M15 M30 H1 H4 D1 W1 MN1`, exactly |
| `--from UTC` | the first bar's start (inclusive) |
| `--to UTC` | the last bar's start (inclusive) |
| `--limit N` | the newest N bars in that range, 1–5000 (900 by default) |

```text
$ mt4-quote-bridge markets candles EURUSD --broker EasyForex-Demo --timeframe H1 --limit 3
TIME (UTC)                BROKER TIME          OPEN     HIGH      LOW    CLOSE
------------------------  -------------------  -------  -------  -------  -------  -------
2027-01-15T06:00:00.000Z  2027-01-15T08:00:00  1.10010  1.10060  1.09990  1.10040
2027-01-15T07:00:00.000Z  2027-01-15T09:00:00  1.10020  1.10070  1.10000  1.10050
2027-01-15T08:00:00.000Z  2027-01-15T10:00:00  1.10000  1.10000  1.10000  1.10000  forming
Older: add --to 2027-01-15T05:59:59.000Z
```

To page back, run it again with `--to` set to the printed value (`meta.next.to` in JSON).

`--json`: `data` is an array of `{ time, brokerTime, open, high, low, close, complete }`; `meta` has `marketId`,
`timeframe`, `digits`, `source` (the feed whose chart history answered), `count`, `limit` and `next.to`.

## markets samples

Every bid/ask the app recorded for a market, tick by tick, oldest first. Only markets with recording switched on in
the app's Feeds view have samples (`RECORDING yes` in `markets list`).

```text
mt4-quote-bridge markets samples SYMBOL [--from UTC] [--to UTC] [--limit N] [--cursor C | --all] [--json]
```

`--from` and `--to` are inclusive; `--limit` is 1–10,000 (1,000 by default). A cursor only works with the same
`--from` and `--to` it was given with (otherwise `invalid-cursor`, exit 2).

```text
$ mt4-quote-bridge markets samples EURUSD --broker EasyForex-Demo --limit 2
TIME (UTC)                BROKER TIME              BID      ASK
------------------------  -------------------  -------  -------
2027-01-15T08:00:00.000Z  2027-01-15T10:00:00  1.10000  1.10015
2027-01-15T08:00:00.412Z  2027-01-15T10:00:00  1.10001  1.10016
More: add --cursor <cursor> (or --all for everything).
```

`--json`: `data` is an array of `{ time, brokerTime, bid, ask, receivedAt }`.

## markets history

Closed-bar coverage per timeframe: MetaTrader's HST file joined with the app's saved history, as the History page
shows it. It answers with no terminal running once history is saved. Run it before `candles` or `export` to see what
range there is.

```text
$ mt4-quote-bridge markets history EURUSD --broker EasyForex-Demo
TIMEFRAME   BARS  FROM (UTC)                TO (UTC)
---------  -----  ------------------------  ------------------------
M1         43200  2026-12-16T00:00:00.000Z  2027-01-15T07:59:00.000Z
H1          2880  2026-09-17T00:00:00.000Z  2027-01-15T07:00:00.000Z
D1           520  2025-01-15T00:00:00.000Z  2027-01-14T00:00:00.000Z
```

`--json`: `data` is `{ marketId, digits, timeframes: [{ timeframe, bars, from, fromBrokerTime, to, toBrokerTime }] }`.

## markets export

Saves closed bars to a file, the same file the app's History page downloads. The forming bar is never included, and
the whole range is streamed with no row limit.

```text
mt4-quote-bridge markets export SYMBOL --timeframe TF --format csv|hst --output FILE [--force] [--from UTC] [--to UTC] [--json]
```

| Option | Meaning |
| --- | --- |
| `--timeframe TF` | required |
| `--format csv` | text: broker time plus a `time_utc` column, for spreadsheets and scripts |
| `--format hst` | MetaTrader's v401 history file (broker time), to load into MT4 |
| `--output FILE` | required: the file to write |
| `--force` | replace `FILE` if it exists (otherwise exit 13) |
| `--from`, `--to` | keep only the bars that start between them |

```text
$ mt4-quote-bridge markets export EURUSD --broker EasyForex-Demo --timeframe H1 --format csv --output eurusd-h1.csv
Saved EURUSD H1 (EasyForex-Demo) to C:\work\eurusd-h1.csv: 183244 bytes.
```

The CSV starts:

```text
time,open,high,low,close,tick_volume,spread,real_volume,time_utc
2027-01-15 07:00:00,1.10000,1.10050,1.09980,1.10030,10,0,0,2027-01-15T05:00:00Z
```

`--json` prints the file's metadata, never its bytes: `{ path, bytes, contentType, marketId, brokerServer, symbol,
timeframe, format, from, to }`. File rules: [Concepts › Files](concepts.md#files).

## markets indicator

An indicator's values over exactly the bars `markets candles` answers for the same `--timeframe`, `--from`, `--to`
and `--limit`, read from the cache the charts use: you get the very values a chart shows.

```text
mt4-quote-bridge markets indicator PACKAGE SYMBOL --timeframe TF [--param id=value]... [--from UTC] [--to UTC] [--limit N] [--json]
```

1. Find the package ID: `mt4-quote-bridge indicators list` (`quotebridge.macd`, not `macd`).
2. Read its parameters and outputs: `mt4-quote-bridge indicators show quotebridge.macd`.
3. Ask for values, overriding only the parameters you need; the rest take their defaults.

```text
$ mt4-quote-bridge markets indicator quotebridge.ma EURUSD --broker EasyForex-Demo --timeframe H1 --limit 2 --param period=2
TIME (UTC)                                MA
------------------------  ------------------  -------
2027-01-15T07:00:00.000Z  1.1004500000000002
2027-01-15T08:00:00.000Z  1.1002500000000002  forming
Older: add --to 2027-01-15T06:59:59.000Z
```

- Values are the calculated doubles written out exactly: round them to the market's digits for display.
- A value is empty (`null`) where the indicator has none, such as during its warm-up. The package also runs over
  the warm-up bars it needs before the first bar, so the first value is as correct as the last (`meta.barsUsed`).
- A closed-bars-only package has no row for the forming bar.
- Values need a terminal's chart of the market: without one, exit 9 (`feed-required`).
- A parameter out of range exits 2 (`invalid-indicator-parameter`); a calculation that fails exits 8
  (`indicator-failed`, its reason printed below the message).

`--json`: `data` is an array of `{ time, brokerTime, complete, values: { <output id>: "<decimal>" | null } }`;
`meta` has `indicatorId`, `version`, `parameters` (as used), `outputs` (`[{ id, label }]`), `timeframe`, `source`,
`count`, `limit`, `barsUsed` and `next.to`.
