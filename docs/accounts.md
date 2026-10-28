# Accounts

[Manual](README.md) › Accounts

An **account** is one broker server and one login, however many terminals share it: a second MT4 on the same login
adds a source, not an account. Every `accounts` subcommand only reads, so a `readonly` key is enough, and real
accounts are readable too.

| Subcommand | Use it for | API |
| --- | --- | --- |
| [`list`](#accounts-list) | Every known account and its exact ID (start here) | `GET /accounts` |
| [`show`](#accounts-show) | Demo or real, connection, the executor, source terminals | `GET /accounts/{id}` |
| [`funds`](#accounts-funds) | Balance, equity, margin, free margin, margin level, profit | `GET /accounts/{id}/funds` |
| [`conditions`](#accounts-conditions) | A symbol's contract on this account: lots, stop levels, margin, swaps | `GET /accounts/{id}/markets/{market}/conditions` |

Open positions and pending orders are under [Positions and orders](positions-and-orders.md).

## Naming the account

| Form | Example | Works when |
| --- | --- | --- |
| `--account ID` | `--account <account-id>` | always: the ID from `accounts list` |
| `--account LOGIN --broker S` | `--account 876543219 --broker EasyForex-Demo` | always |
| `--account LOGIN` | `--account 876543219` | only one broker server has that login |

There is no default, saved or active account: name it on every command. An ambiguous login exits 6 with the
candidates (`ambiguous-account`); an unknown one exits 5 (`unknown-account`).

## accounts list

```text
$ mt4-quote-bridge accounts list
LABEL                         DEMO  CONNECTED  CURRENCY  EXECUTOR      ACCOUNT ID
----------------------------  ----  ---------  --------  ------------  ------------
EasyForex-Demo · 876543219    demo  yes        USD       ready         <account-id>
EasyForex-Real · 112233445    real  yes        USD       real-account  <account-id>
```

Accounts the app has seen stay listed after a restart, offline (`CONNECTED no`) until a terminal reconnects.

**EXECUTOR** says whether the account can trade right now:

| Value | Meaning |
| --- | --- |
| `ready` | exactly one connected chart of the account has demo trading enabled and is ready: previews can go through |
| `zero` | no connected chart of the account has demo trading enabled in its EA |
| `multiple` | more than one chart has it enabled; leave it on exactly one |
| `not-ready` | the trading chart is not ready yet |
| `real-account` | a real account: readable, never trades |

`--json`: `data` is an array of `{ id, brokerServer, login, label, demo, connected, state, currency, executor: {
state, terminalId }, sources: [{ terminalId, connected, executorEnabled, ready, maxLots }] }`. `demo` is `null` while
unknown.

## accounts show

One account in detail. Run it when a preview is refused because of the executor.

```text
$ mt4-quote-bridge accounts show --account <account-id>
Account:     EasyForex-Demo · 876543219
Account ID:  <account-id>
Type:        demo
Connected:   true
Currency:    USD
Executor:    ready (mt4-aaaaaaaaaaaa)
Sources:     mt4-aaaaaaaaaaaa, trading chart, EA cap 0.5
```

`Sources` lists each terminal of the account: `offline` when quiet, `trading chart` on the one with demo trading
enabled, and the EA's lot cap.

## accounts funds

The account's money, read fresh from one connected terminal of it (never balance from one terminal with positions
from another), within five seconds.

```text
$ mt4-quote-bridge accounts funds --account <account-id>
Balance:         1000 USD
Equity:          999 USD
Margin:          10 USD
Free margin:     989 USD
Margin level:    9990 %
Profit:          -1 USD
Leverage:        1:100
State:           fresh
Captured (UTC):  2027-01-15T08:00:00.000Z
```

| State | Meaning |
| --- | --- |
| `fresh` | read now from a connected terminal |
| `stale` | the account is offline; this is its last complete snapshot |
| `unavailable` | no terminal of it has answered since the app started; values are null |

Margin level is empty without margin in use. A terminal that does not answer within five seconds exits 9
(`read-timeout`).

`--json`: `data` is `{ accountId, currency, balance, equity, margin, freeMargin, marginLevel, profit, leverage,
state, capturedAt, capturedBrokerTime, receivedAt, terminalId }`.

## accounts conditions

A market's contract data as the account's own terminal reports it. Use it before sizing or placing an order. It
needs no trading permission and works on real accounts.

```text
mt4-quote-bridge accounts conditions SYMBOL --account A [--json]
mt4-quote-bridge accounts conditions --account A --market-id ID [--json]
```

The account fixes the broker server, so `SYMBOL` is looked up on it and is never ambiguous. A market on another
broker server exits 7 (`cross-broker-market`).

```text
$ mt4-quote-bridge accounts conditions EURUSD --account <account-id>
Market:                        EURUSD · EasyForex-Demo
Bid / ask:                     1.1 / 1.10002
Lots:                          min 0.01, max 100, step 0.01
Tick size:                     0.00001
Stop / freeze level (points):  10 / 5
Trade allowed:                 true
Contract size:                 100000
Margin per lot:                1000 USD
Swap long / short:             -1.25 / 0.5
Quote time (UTC):              2027-01-15T08:00:00.000Z
```

| Field | Use it to |
| --- | --- |
| Lots min, max, step | size an order the broker accepts (`--lots` must be a multiple of the step) |
| Stop level (points) | keep `--sl`/`--tp` at least this far from the price |
| Freeze level (points) | know how close to the price an order can no longer be changed |
| Margin per lot | estimate the margin a size needs, against `accounts funds` free margin |
| Trade allowed | see whether the broker allows trading the symbol at all |

`--json`: `data` is `{ accountId, marketId, symbol, bid, ask, digits, point, tickSize, minLots, maxLots, lotStep,
stopLevel, freezeLevel, tradeAllowed, quoteTime, quoteBrokerTime, tickValue, contractSize, marginRequired, swapLong,
swapShort, swapType, profitCurrency, terminalId, receivedAt }`.
