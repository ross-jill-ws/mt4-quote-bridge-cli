# Positions and orders

[Manual](README.md) › Positions and orders

- A **position** is an open trade. A **pending order** is a limit or stop order waiting at its price.
- Both are named by MetaTrader's **ticket**, which is unique only within its account, so every command here takes
  `--account` (see [Accounts › Naming the account](accounts.md#naming-the-account)).
- `list` and `show` read and need a `readonly` key. Every other subcommand **only previews**: nothing reaches
  MetaTrader until [`requests execute`](trading.md) sends the approved preview.

| Command | Use it for |
| --- | --- |
| [`positions list`](#list-and-show) | an account's open trades and their tickets |
| [`positions show TICKET`](#list-and-show) | one open trade |
| [`positions modify TICKET`](#positions-modify) | preview a new stop loss and/or take profit |
| [`positions close TICKET`](#positions-close) | preview closing a whole position |
| [`orders list`](#list-and-show) | an account's pending limit and stop orders |
| [`orders show TICKET`](#list-and-show) | one pending order |
| [`orders preview`](#orders-preview) | preview a **new** market, limit or stop order |
| [`orders modify TICKET`](#orders-modify) | preview a pending order's new entry, expiry, stop loss or take profit |
| [`orders cancel TICKET`](#orders-cancel) | preview cancelling a pending order |

Trades placed outside QuoteBridge (by hand in MT4, or by another EA) are listed and can be managed too; their
previews carry a warning.

## list and show

```text
$ mt4-quote-bridge positions list --account <account-id>
  TICKET  SYMBOL  SIDE  LOTS  OPEN       SL       TP  PROFIT  ORIGIN
--------  ------  ----  ----  ----  -------  -------  ------  -----------
12345678  EURUSD  buy    0.1   1.1  1.09600           -1.25   QuoteBridge
12345690  GBPUSD  sell   0.2  1.27           1.26500   4.10   outside
```

```text
$ mt4-quote-bridge orders list --account <account-id>
  TICKET  SYMBOL  SIDE        LOTS  PRICE  SL  TP  EXPIRY (UTC)              ORIGIN
--------  ------  ----------  ----  -----  --  --  ------------------------  -----------
12346001  EURUSD  buy limit    0.1    1.1          2027-01-20T12:00:00.000Z  QuoteBridge
```

`show TICKET` prints one such row. A missing stop or expiry is empty (`null` in JSON). An unknown ticket exits 5.

**Offline accounts.** While the account's terminal is offline the list is its last snapshot, and stderr says
`Stale: the account's terminal is offline; this is its last snapshot.`; with no snapshot since the app started it
says `Unavailable: …` and the list is empty. In JSON, read `meta.state` (`fresh`, `stale`, `unavailable`).

`--json` positions: `{ ticket, accountId, marketId, symbol, side, lots, stopLoss, takeProfit, magic, openPrice,
openTime, openBrokerTime, currentPrice, profit, swap, commission }`. Pending orders: `{ ticket, accountId, marketId,
symbol, side, type, lots, stopLoss, takeProfit, magic, price, placedAt, placedBrokerTime, expiry, expiryBrokerTime,
currentPrice }`. `meta` has `currency` and `state`.

## What every preview prints

All five previewing commands answer the same way:

```text
$ mt4-quote-bridge positions close 12345678 --account <account-id>
Request:            9f2c4e1ab7d34c0e8a6b5d4c3b2a1908
Status:             preview
Account ID:         <account-id>
Action:             close ticket 12345678 (EURUSD)
Price:              1.09980
Stop loss:          —
Take profit:        —
Expiry (UTC):       —
Slippage (points):  20
Lot limits:         broker 100, EA 0.5, app 1 → max 0.5
Expires (UTC):      2027-01-15T08:00:30.000Z
Nothing was sent. If the account holder approves this exact preview, send it within 30 s with:
  mt4-quote-bridge requests execute 9f2c4e1ab7d34c0e8a6b5d4c3b2a1908 --confirm
```

- **Request** is the ID that `requests execute`, `requests show` and `requests review` take.
- **Action, Price, Stop loss, Take profit, Expiry** are the normalized order execute will send, exactly.
- **Slippage** comes from the app's Settings; a market order's price is the quote the preview approved.
- **Lot limits** are the broker's, the EA's and the app's caps; the smallest wins.
- **Estimates** (new orders with stops): loss and reward in the account's currency, excluding fees, swaps and
  slippage. They are not loss caps.
- **Warning** lines: a trade placed outside QuoteBridge, an order without a stop loss, and so on.
- The last two lines are on stderr. The preview is **valid for 30 seconds** and is invalidated earlier by a change of
  settings, account, terminal or chart.

`--json`: `{ requestId, status: "preview", createdAt, expiresAt, accountId, marketId, terminalId, normalizedIntent: {
action, ticket, symbol, side, type, lots, price, stopLoss, takeProfit, expiry, slippage }, target, limits, estimates,
warnings }`. `target` is the existing trade as the preview saw it (null for a new order); if it changes before
execute, execute refuses with `target-changed` (exit 7).

What happens next is in [Trading requests](trading.md).

## orders preview

Preview a new order. Every value comes from the account holder's request.

```text
mt4-quote-bridge orders preview --account A (--symbol S | --market-id ID) --side buy|sell
  --type market|limit|stop --lots L [--price P] [--expiry UTC] [stops] [--json]
```

| Option | Meaning |
| --- | --- |
| `--account A` | required: the account ([naming](accounts.md#naming-the-account)) |
| `--symbol S` | the exact symbol, looked up on the account's broker server |
| `--market-id ID` | instead of `--symbol`; must be on the account's broker server |
| `--side` | `buy` or `sell` |
| `--type` | `market`, `limit` or `stop` |
| `--lots L` | volume in lots, such as `0.10`: a multiple of the lot step, within every cap |
| `--price P` | the entry price; required for `limit` and `stop`, refused for `market` |
| `--expiry UTC` | a pending order's expiry, `YYYY-MM-DDTHH:MM:SSZ`; leave it out for none; refused for `market` |

### Order types

| Type | Fills | Price |
| --- | --- | --- |
| `market` | now, at the current price within the slippage | no `--price` |
| `limit` | when the price comes back to `--price`: a buy **below** the market, a sell **above** | `--price` required |
| `stop` | when the price breaks through `--price`: a buy **above** the market, a sell **below** | `--price` required |

### Stops: one form per order

| Form | Options | Example |
| --- | --- | --- |
| Absolute prices | `--sl P`, `--tp P` | `--sl 1.09800 --tp 1.10600` |
| Points from the entry | `--sl-points N`, `--tp-points N` | `--sl-points 200 --tp-points 400` |
| Risk plan | one of `--risk-amount X`, `--risk-percent X`, `--risk-points X`, plus `--reward-ratio R` | `--risk-percent 1 --reward-ratio 2` |

- **Points** are worked out from the previewed entry: a buy's stop loss below it and take profit above, a sell's the
  other way round. Either may be left out.
- A **risk plan** sets both stops for the given lots: the stop loss where the trade would lose `X` (money in the
  account's currency, a percentage of the balance, or points), and the take profit at `R` times that distance.
- Distances and plans are rounded toward the entry; one that cannot be met (past zero, or rounding to the entry) is
  refused, never widened.
- Mixing forms, or a risk option without `--reward-ratio`, is a usage error (exit 2).
- Stops left out entirely: the order has none, and the preview warns.

### Examples

```sh
# Buy 0.10 lots at market, no stops
mt4-quote-bridge orders preview --account <account-id> --symbol EURUSD --side buy --type market --lots 0.10

# Buy at market with a 200-point stop loss and a 400-point take profit
mt4-quote-bridge orders preview --account <account-id> --symbol EURUSD --side buy --type market --lots 0.10 \
  --sl-points 200 --tp-points 400

# Sell limit above the market, expiring, with absolute stops
mt4-quote-bridge orders preview --account <account-id> --symbol EURUSD --side sell --type limit --lots 0.05 \
  --price 1.09500 --expiry 2027-01-20T12:00:00Z --sl 1.09800 --tp 1.08900

# Buy stop risking 1% of the balance for twice the reward
mt4-quote-bridge orders preview --account <account-id> --symbol EURUSD --side buy --type stop --lots 0.10 \
  --price 1.10200 --risk-percent 1 --reward-ratio 2 --json
```

Check the symbol's lot step and stop level first with [`accounts conditions`](accounts.md#accounts-conditions).

## positions modify

Preview a new stop loss and/or take profit for an open position.

```sh
mt4-quote-bridge positions modify 12345678 --account <account-id> --sl 1.08200        # set or move the stop loss
mt4-quote-bridge positions modify 12345678 --account <account-id> --tp none           # remove the take profit
mt4-quote-bridge positions modify 12345678 --account <account-id> --sl 1.08200 --tp 1.09500
```

Options left out stay as they are; `none` clears one (zero is not a clear). Lots cannot change. Giving neither option
is a usage error.

## positions close

Preview closing a whole position at the current price. There are no partial closes.

```sh
mt4-quote-bridge positions close 12345678 --account <account-id>
```

## orders modify

Preview changing a pending order: `--price` (new entry), `--expiry UTC|none`, `--sl P|none`, `--tp P|none`. Options
left out stay as they are; lots cannot change.

```sh
mt4-quote-bridge orders modify 12346001 --account <account-id> --price 1.08350
mt4-quote-bridge orders modify 12346001 --account <account-id> --expiry 2027-01-20T12:00:00Z --sl none
```

## orders cancel

Preview deleting a pending order. To close an open position, use `positions close`.

```sh
mt4-quote-bridge orders cancel 12346001 --account <account-id>
```

## When a preview is refused

| Exit | Code | Meaning |
| --- | --- | --- |
| 4 | `insufficient-scope` | a `readonly` key: create a `trader` key in the app window |
| 4 | `trading-disabled` | Demo trading is off in the app window's Settings; only the user can switch it on |
| 4 | `trading-not-allowed` | the broker does not allow trading this symbol |
| 4 | `demo-only` | the account is real |
| 7 | `executor-real-account` | a real account: read-only, final |
| 7 | `executor-zero`, `executor-multiple`, `executor-not-ready`, `executor-unavailable` | no single ready demo trading chart: check `accounts show` |
| 7 | `account-unresolved` | an earlier request on this account has no definitive result: see [Trading requests](trading.md#unknown-outcomes) |
| 7 | `cross-broker-market` | the market is on another broker server than the account |
| 8 | `invalid-volume`, `invalid-stops`, `insufficient-margin`, `unsatisfiable-risk`… | a value does not fit this account and market; the message says which |
| 9 | `read-timeout` | the account's terminal did not answer within five seconds; nothing was sent |

Every code is in [Troubleshooting](troubleshooting.md).
