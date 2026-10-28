# Troubleshooting

[Manual](README.md) › Troubleshooting

Every command exits with a stable code. Errors go to stderr as `error: <message> (<code>)`, or with `--json` as
`{ "error": { "code", "message", "details" } }`. Find the exit code below, then the error code.

## Exit codes

| Exit | Meaning | Do next |
| --- | --- | --- |
| 0 | Success. For `requests show` and `execute`: succeeded, reviewed, or a valid preview | — |
| 1 | Other error: the app is unreachable, answered unexpectedly (500), or is not QuoteBridge | Is the app running? `auth status`, `config show`. After `requests execute`, read stderr: see [lost answers](#a-lost-answer-after-execute) |
| 2 | Usage error, or the app refused a malformed value (400) | Read the message and the subcommand's `--help` |
| 3 | Not signed in, or the key is invalid, expired or revoked (401) | The user creates a key in the app window; `auth login` |
| 4 | Forbidden (403): a `readonly` key, Demo trading off, a real account, or the broker does not allow the symbol | See the error code below |
| 5 | Not found (404): no such market, account, ticket, request, terminal, feed or indicator | `markets list`, `accounts list`, `positions list`… names are exact |
| 6 | Ambiguous symbol or login | Pick one of the listed candidates; add `--broker` or use the ID |
| 7 | Conflict (409): see the error code | See below |
| 8 | Invalid trading or indicator values (422) | The message says which value; check `accounts conditions` |
| 9 | Source or app window unavailable (503), or the terminal did not answer in five seconds / a screenshot in ten (504). Not an order failure | Check the terminal (`terminals list`); try again later |
| 10 | A trading request's outcome is **unknown**: never retry | [Check MetaTrader, then review](trading.md#unknown-outcomes) |
| 11 | A trading request failed definitively (MetaTrader or the EA refused it) | Report MetaTrader's code and message |
| 12 | A trading request was sent and has no definitive result yet | `requests show ID` later; never execute again |
| 13 | The output file of an export or screenshot exists and `--force` was not given | Choose another `--output`, or add `--force` |

## Error codes

### The CLI's own

| Code | Exit | Meaning |
| --- | --- | --- |
| `usage` | 2 | a missing or invalid argument or option |
| `not-signed-in` | 3 | no saved key and no `MT4QB_API_KEY` |
| `invalid-key` | 3 | not a QuoteBridge key (`qbk_` and 64 hex characters) |
| `unreachable` | 1 | the app cannot be reached at the server URL |
| `redirect` | 1 | the server redirects elsewhere; the key is not sent to another host |
| `ambiguous-market`, `ambiguous-account` | 6 | the candidates are in `details.candidates` |
| `unknown-market`, `unknown-account` | 5 | no exact match |
| `output-exists` | 13 | `--output` exists and no `--force` |
| `cli-error` | 1 | anything else, such as a server that is not QuoteBridge |

### The app's

| Code | Exit | Meaning and what to do |
| --- | --- | --- |
| `invalid-parameter`, `invalid-time`, `invalid-timeframe`, `invalid-cursor`, … | 2 | a malformed value; `invalid-cursor`: send a cursor with the same `--from`/`--to` |
| `invalid-indicator-parameter` | 2 | an indicator parameter is unknown or out of range: `indicators show PACKAGE` |
| `unauthenticated` | 3 | the key is invalid, expired or revoked: `auth login` with a new key |
| `insufficient-scope` | 4 | a `readonly` key tried a screenshot, preview, execute or review: use a `trader` key |
| `trading-disabled` | 4 | Demo trading is off in the app window's Settings; only the user can switch it on |
| `demo-only` | 4 | the account is real; real accounts never trade |
| `trading-not-allowed` | 4 | the broker does not allow trading the symbol |
| `unknown-market`, `unknown-account`, `unknown-position`, `unknown-order`, `unknown-terminal`, `unknown-feed`, `unknown-indicator`, `request-not-found`, `no-candles`, `no-history` | 5 | no such thing |
| `cross-broker-market` | 7 | the market is not on the account's broker server |
| `preview-expired`, `preview-invalidated`, `price-changed`, `target-changed`, `limits-changed`, `settings-changed`, … | 7 | the preview no longer holds: preview again and get a fresh approval |
| `account-unresolved` | 7 | the account has a request without a definitive result: `requests show` it, and review it if unknown |
| `executor-zero`, `executor-multiple`, `executor-not-ready`, `executor-unavailable` | 7 | the account has no single ready demo trading chart: `accounts show` |
| `executor-real-account` | 7 | a real account: final, it never trades |
| `request-not-unknown` | 7 | only an unknown request can be reviewed |
| `window-busy` | 7 | a dialog is open in the app window: the user closes it; don't retry until then |
| `no-feed` | 7 | no terminal streams the market, so there is no chart to capture |
| `invalid-volume`, `invalid-stops`, `invalid-entry`, `insufficient-margin`, `unsatisfiable-distance`, `unsatisfiable-risk`, … | 8 | a trading value does not fit this account and market; the message says which |
| `indicator-failed` | 8 | the indicator's calculation failed; its reason is printed under the message |
| `quote-unavailable` | 9 | no feed and nothing recorded for the market |
| `feed-required` | 9 | indicator values need a terminal's chart of the market |
| `read-failed` | 9 | the terminal refused a read; its reason is printed under the message |
| `read-timeout` | 9 | the terminal did not answer within five seconds; not an order failure |
| `window-unavailable` | 9 | no app window to capture yet |
| `screenshot-timeout` | 9 | the window was not captured within ten seconds |
| `internal-error` | 1 | check the app's logs |

## Common situations

### "Not signed in" or exit 3

```sh
mt4-quote-bridge auth status
mt4-quote-bridge config show      # which server and key source is used?
```

If `MT4QB_API_KEY` is set to an old key, it overrides the saved one. Otherwise the user creates a key in the app
window (Settings › API keys) and runs `auth login`.

### The app is unreachable (exit 1)

- Is QuoteBridge running? Its window, or its tray icon.
- Is the port right? Settings › Connection shows it; `config show` shows what the CLI uses.
- `MT4QB_SERVER` overrides the saved server for every command.

### A symbol "does not exist" (exit 5) or is ambiguous (exit 6)

Names are exact and case-sensitive. `markets list --symbol EURUSD` shows which broker servers have it; some brokers
add suffixes (`EURUSD.m`, `EURUSDpro`), which are different symbols.

### A quote looks old

`markets quote` shows `State: last-known` or `, stale`: the market's terminal is offline or quiet. Follow
[Diagnosing a quiet market](indicators-and-terminals.md#diagnosing-a-quiet-market).

### A lost answer after execute

When `requests execute` exits 1, stderr says which case it is:

- **"Nothing was sent."** The app could not be reached at all, or no key is saved. Fix that, then preview again.
- **"The answer was lost; the request may have been sent."** Run `requests show ID`. Never execute or preview the same
  order again to find out.

### The account is blocked (`account-unresolved`)

An earlier request on this account has no definitive result. `requests list --account A` finds it; `requests show ID`
reads it. If it is `unknown`, follow [Unknown outcomes](trading.md#unknown-outcomes).
