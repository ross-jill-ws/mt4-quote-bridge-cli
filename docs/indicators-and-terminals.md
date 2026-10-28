# Indicators and terminals

[Manual](README.md) › Indicators and terminals

Two read-only families: `indicators` describes the indicator packages the app has enabled, and `terminals` diagnoses
the MT4 terminals and charts behind the data. A `readonly` key is enough for both.

## Indicators

`indicators` only **describes** packages; the values come from
[`markets indicator`](markets.md#markets-indicator).

| Subcommand | Use it for |
| --- | --- |
| `indicators list` | the enabled packages and their exact IDs |
| `indicators show PACKAGE` | one package's parameters (type, default, range or choices) and outputs |

```text
$ mt4-quote-bridge indicators list
PACKAGE ID        NAME             VERSION  PLACEMENT
----------------  ---------------  -------  ---------
quotebridge.ma    Moving average   1.0.0    overlay
quotebridge.macd  MACD             1.0.0    pane
```

`PLACEMENT` is `overlay` (drawn on the price chart) or a separate pane. Only enabled packages are listed; a disabled
or unknown one exits 5 (`unknown-indicator`). IDs are exact: `quotebridge.macd`, not `macd`.

```text
$ mt4-quote-bridge indicators show quotebridge.ma
Package:           Moving average (quotebridge.ma 1.0.0)
Placement:         overlay
Closed bars only:  false

PARAMETER  TYPE     DEFAULT  RANGE / CHOICES
---------  -------  -------  ------------------
period     integer  20       1–500
type       choice   simple   simple exponential

OUTPUT  LABEL
------  -----
ma      MA
```

Each `PARAMETER` is what `--param id=value` takes; each `OUTPUT` is a column of `markets indicator`:

```sh
mt4-quote-bridge markets indicator quotebridge.ma EURUSD --broker EasyForex-Demo --timeframe H1 \
  --param period=50 --param type=exponential
```

`--json` for `show`: `{ id, version, name, description, placement, closedBarsOnly, parameters, outputs, hash }`. A
parameter is `{ id, label, type, default, min, max }`, or `{ id, label, type: "choice", default, choices: [{ value,
label }] }`; an output is `{ id, label, render, styles }`.

A closed-bars-only package has no value for the forming bar. To write your own packages or convert MT4 indicators,
see the QuoteBridge manual's *Indicator packages*.

## Terminals

A **terminal** is one running MT4 with the QuoteBridge EA; its **feeds** are its own charts. These commands are for
diagnosis: market and account commands already choose the best source, and terminals never route trading.

| Subcommand | Use it for |
| --- | --- |
| `terminals list` | every terminal the app has heard from, connected or not |
| `terminals show ID` | one terminal: broker server, EA version, last hello, number of feeds |
| `terminals feeds ID` | that terminal's feeds and their latest quotes |
| `terminals feeds ID FEED` | one feed in full |

```text
$ mt4-quote-bridge terminals list
TERMINAL ID       NAME              BROKER SERVER   EA     CONNECTED  FEEDS
----------------  ----------------  --------------  -----  ---------  -----
mt4-aaaaaaaaaaaa  Demo terminal     EasyForex-Demo  1.4.0  yes            3
mt4-bbbbbbbbbbbb  Second terminal   EasyForex-Demo  1.4.0  no             1
```

A terminal is `connected` when it said hello within the last seven seconds.

```text
$ mt4-quote-bridge terminals feeds mt4-aaaaaaaaaaaa
SYMBOL  BROKER SERVER   ONLINE      BID      ASK  FEED ID
------  --------------  ------  -------  -------  -----------------------------
EURUSD  EasyForex-Demo  yes     1.10000  1.10015  ["mt4-aaaaaaaaaaaa","EURUSD"]
GBPUSD  EasyForex-Demo  stale   1.27010  1.27028  ["mt4-aaaaaaaaaaaa","GBPUSD"]
```

`ONLINE` is `yes`, `stale` (online but its quotes stopped moving) or `no`. A feed ID contains quotes and brackets, so
quote it in the shell:

```sh
mt4-quote-bridge terminals feeds mt4-aaaaaaaaaaaa '["mt4-aaaaaaaaaaaa","EURUSD"]' --json
```

One feed's `--json`: `{ id, terminalId, marketId, brokerServer, symbol, digits, timeframe, online, stale, instances,
quoteStatus, recording, bid, ask, time, brokerTime, receivedAt }`.

### Diagnosing a quiet market

```sh
mt4-quote-bridge markets quote EURUSD --broker EasyForex-Demo   # State last-known or stale?
mt4-quote-bridge markets show EURUSD --broker EasyForex-Demo    # which terminals feed it, which are offline
mt4-quote-bridge terminals list                                 # is that terminal connected? which EA version?
mt4-quote-bridge terminals feeds mt4-aaaaaaaaaaaa               # is its chart of EURUSD online or stale?
mt4-quote-bridge screenshot feeds --output feeds.png            # how the app window looks (trader key)
```
