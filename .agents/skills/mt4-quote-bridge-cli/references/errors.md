# Exit codes: what they mean and who acts

With `--json`, the error is `{ error: { code, message, details } }` on stderr; act on `code`, quote `message` to the user. `details.reason` carries the EA's or an indicator's explanation, `details.candidates` the choices of an ambiguous name.

| Exit | Meaning | Who acts, and how |
| --- | --- | --- |
| `1` | unreachable or unexpected answer | The user: is the app running? Check `config show` together. After `requests execute`, see the trading reference's step 6 |
| `2` | usage, or a malformed value (400) | You: reread the subcommand's `--help` and fix the command |
| `3` | not signed in, key invalid, expired or revoked | The user: create a key in the app window, then `auth login` |
| `4` | forbidden: `insufficient-scope`, `trading-disabled`, `demo-only`, `trading-not-allowed` | The user: a `trader` key, Demo trading in Settings; a real account or untradable symbol is final |
| `5` | not found | You: list (`markets list`, `accounts list`, `positions list`…) and use the exact name |
| `6` | ambiguous symbol or login | The user: ask which candidate they mean, then rerun with `--broker` or the ID |
| `7` | conflict: a preview that no longer holds, `account-unresolved`, executor states, `cross-broker-market`, `window-busy`, `no-feed` | Depends on the code: preview again with fresh approval; read the unresolved request; tell the user about a busy window |
| `8` | invalid trading or indicator values (422), `indicator-failed` | You and the user: report the message; for indicators, check `indicators show PACKAGE` |
| `9` | source or window unavailable, a terminal read or screenshot timed out | Report it; try once more later. Not an order failure |
| `10` | a request's outcome is unknown | Stop; the user checks MetaTrader; review with their note. Never retry |
| `11` | a request failed definitively | Report MetaTrader's code and message |
| `12` | a request was sent, no result yet | `requests show <id>` later; never execute again |
| `13` | an output file exists | Choose another `--output`; `--force` only for your own file |
