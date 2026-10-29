# Trading protocol

Trading is demo-only and always the user's decision. The agent prepares previews; the user approves each one. Read the `--help` of the preview command and of `requests execute` before the first trade in a session.

## Preconditions

- A `trader` key (`auth status --json` → `data.key.scope`).
- The account is demo and can trade: `accounts list --json` shows `demo: true` and `executor.state: "ready"`. Otherwise report the state; enabling Demo trading or an EA chart is the user's job in the app window and MT4.

## Steps

1. Act only when the user asks for a specific trade: account, market, side, type, size and stops come from them. Fill nothing in on their behalf. Stops take the user's form, one form per order: prices (`--sl`/`--tp`), points from the entry (`--sl-points`/`--tp-points`) or a risk plan (one `--risk-*` with `--reward-ratio`). When a value is missing, ask.
2. Check the symbol's lot step, minimum lots and stop level with `accounts conditions SYMBOL --account A --json` when the size or stops are close to a limit.
3. Preview with `--json`: `orders preview` (new), `orders modify|cancel` (pending), `positions modify|close` (open). A preview sends nothing.
4. Show the user the preview: account, the normalized order (`normalizedIntent`: action, symbol, side, type, lots, price, stops, expiry), the lot limits, the estimates and every warning (an outside trade, a missing stop loss). It expires 30 seconds after `createdAt`.
5. Run `requests execute <request-id> --confirm` only after the user explicitly approves that exact preview in this conversation. `--confirm` records their approval; it never replaces it. An expired or changed preview (exit `7`) needs a fresh preview and fresh approval.
6. Read the exit status and report it:
   - `0` succeeded: report the ticket (`data.result.ticket`).
   - `11` failed: report MetaTrader's code and message (`data.result`).
   - `12` sent, no result yet: check later with `requests show <request-id>`.
   - `10` unknown: stop. Report it and ask the user to check MetaTrader's open orders and account history. The account stays blocked until a result arrives or the user reviews it.
   - `1`: read stderr. "Nothing was sent" means the app was unreachable: fix that, then preview again. "The answer was lost; the request may have been sent" means `requests show <request-id>`.

## Once per request ID

Every request ID is executed at most once. To learn what happened to one, read it with `requests show <request-id>`: a new preview or execute could open a second trade. A lost answer, a timeout and an unknown outcome are all answered by reading, never by sending again.

## Review

`requests review <id> --note "…" --acknowledge` records what the user found in MetaTrader after an unknown outcome. Run it only with the user's own note after they say they checked; it lifts the account's block and never resends. Only an unknown request can be reviewed (`request-not-unknown`, exit `7`).

## Refusals that end the attempt

- `7` `executor-real-account` or `4` `demo-only`: a real account, read-only. Final.
- `4` `trading-disabled`: Demo trading is off in the app window's Settings, which only the user can switch on.
- `4` `insufficient-scope`: a `readonly` key.
- `7` `account-unresolved`: an earlier request on this account has no definitive result; `requests list --account A --json` finds it, `requests show` reads it.
- `7` `executor-zero|multiple|not-ready|unavailable`: the account has no single ready trading chart; report `accounts show --account A`.
- `8`: a value does not fit (lots, stops, margin); report the message and ask the user how to change the order.
