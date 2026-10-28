// Accounts, positions, pending orders and trading requests. Every mutation command only previews; the one command
// that sends anything is `requests execute <id> --confirm`, and nothing is ever retried.
import { Command, Option } from "commander";
import {
  ApiClient,
  ApiError,
  CliError,
  EXIT,
  UnreachableError,
  usage,
  type Envelope,
} from "../client.js";
import { emit, fields, note, table } from "../output.js";
import { resolveAccount, resolveMarket, type Account } from "../resolve.js";
import {
  api,
  clearable,
  cleared,
  decimal,
  describe,
  familyGuide,
  guide,
  jsonOption,
  listCollection,
  MARKET_HELP,
  pageOptions,
  section,
  utcExpiry,
} from "./common.js";

const ACCOUNT_HELP = `
Account selection:
  --account takes the account's exact ID, or a login with --broker <exact
  broker server>. A bare login works only when one broker server has it.
  There is no default or saved account; ambiguity lists the candidates and
  exits 6.`;

const PREVIEW_HELP = `
This only previews: nothing is sent to MetaTrader. The preview lasts 30 seconds.
To send it, after the account holder approves this exact preview:
  mt4-quote-bridge requests execute <request-id> --confirm
Demo accounts only; real accounts are read-only. Needs a trader key, and Demo
trading switched on in the app window's Settings.`;

/** What a preview prints, for every previewing command's help. */
const PREVIEW_OUTPUT = `Request (its ID), Status (preview), Account ID, Action, Price, Stop loss,
Take profit, Expiry (UTC), Slippage (points), Lot limits (broker, EA, app →
max), Estimates (loss, reward), Expires (UTC) and every Warning (a trade
placed outside QuoteBridge, no stop loss…); on stderr, the execute command.
--json: data is { requestId, status: "preview", createdAt, expiresAt,
accountId, marketId, terminalId, normalizedIntent: { action, ticket, symbol,
side, type, lots, price, stopLoss, takeProfit, expiry, slippage }, target,
limits, estimates, warnings }. Show all of it to the account holder.`;

const TICKET = /^[1-9]\d{0,9}$/;

function accountOptions(cmd: Command) {
  return cmd
    .option(
      "--account <id|login>",
      "the account: its ID, or its login with --broker"
    )
    .option(
      "--broker <server>",
      "exact broker server of a login (and of a symbol)"
    )
    .addHelpText("after", ACCOUNT_HELP);
}

const accountPath = (a: Account, rest = "") =>
  `/api/v1/accounts/${encodeURIComponent(a.id)}${rest}`;

function ticketArg(ticket: string) {
  if (!TICKET.test(ticket))
    throw usage(
      `"${ticket}" is not a ticket; tickets are MetaTrader's order numbers, such as 12345678.`
    );
  return ticket;
}

const ACCOUNT_COLUMNS = [
  { header: "LABEL", value: (a: any) => a.label },
  {
    header: "DEMO",
    value: (a: any) => (a.demo === null ? "?" : a.demo ? "demo" : "real"),
  },
  { header: "CONNECTED", value: (a: any) => (a.connected ? "yes" : "no") },
  { header: "CURRENCY", value: (a: any) => a.currency },
  { header: "EXECUTOR", value: (a: any) => a.executor.state },
  { header: "ACCOUNT ID", value: (a: any) => a.id },
];

export function accountsCommand() {
  const accounts = familyGuide(
    new Command("accounts"),
    "trading accounts (broker server + login): discovery, Funds and symbol conditions",
    "An account is one broker server and one login, however many terminals share it. These commands only read; a readonly key is enough, and real accounts are readable too.",
    `list        every known account with its exact ID (start here)
show        one account: demo or real, connection, executor, sources
funds       balance, equity, margin, free margin, margin level, profit
conditions  a symbol's contract on the account: lot limits and step, stop
            and freeze levels, margin per lot, swaps

Name an account as --account <account-id>, or --account <login> --broker
<exact broker server>. There is no default account.
Open trades: positions list. Pending orders: orders list.`,
    [
      "accounts list",
      "accounts funds --account <account-id>",
      "accounts conditions EURUSD --account <account-id>",
    ]
  );

  accounts.addCommand(
    guide(
      jsonOption(
        pageOptions(
          describe(
            new Command("list"),
            "list known trading accounts (GET /api/v1/accounts)",
            "Use it first: it gives the exact account ID every account-scoped command takes, and shows which accounts are demo or real, connected, and able to trade (EXECUTOR ready). Accounts the app has seen stay listed, offline, after a restart."
          )
        )
      ).addHelpText(
        "after",
        "\nEXECUTOR: ready (exactly one connected chart with demo trading enabled and\nready), zero, multiple, not-ready or real-account."
      ),
      {
        output: `Table: LABEL (broker server · login), DEMO (demo, real or ?), CONNECTED,
CURRENCY, EXECUTOR, ACCOUNT ID.
--json: data is an array of { id, brokerServer, login, label, demo,
connected, state, currency, executor: { state, terminalId }, sources:
[{ terminalId, connected, executorEnabled, ready, maxLots }] }.`,
        examples: ["accounts list", "accounts list --all --json"],
        seeAlso: ["accounts show --account A"],
      }
    ).action(async (o) => {
      await listCollection(
        await api(),
        "/api/v1/accounts",
        {},
        o,
        ACCOUNT_COLUMNS
      );
    })
  );

  accounts.addCommand(
    guide(
      jsonOption(
        accountOptions(
          describe(
            new Command("show"),
            "one account's identity, connection, executor and sources (GET /api/v1/accounts/{accountId})",
            "Use it to see whether an account can trade and through which terminal: demo or real, its executor (ready, zero, multiple, not-ready, real-account) and each source terminal with its trading chart and EA lot cap. Run it when a preview is refused for the executor."
          )
        )
      ),
      {
        output: `Account, Account ID, Type (demo, real (read-only) or unknown), Connected,
Currency, Executor (state and terminal) and Sources (terminal, "offline",
"trading chart", "EA cap N").
--json: data is the account as accounts list gives it.`,
        examples: [
          "accounts show --account <account-id>",
          "accounts show --account <login> --broker EasyForex-Demo --json",
        ],
      }
    ).action(async (o) => {
      const client = await api();
      const envelope = await client.get(
        accountPath(await resolveAccount(client, o.account, o.broker))
      );
      const a = envelope.data;
      emit(o.json, envelope, () =>
        fields([
          ["Account", a.label],
          ["Account ID", a.id],
          [
            "Type",
            a.demo === null ? "unknown" : a.demo ? "demo" : "real (read-only)",
          ],
          ["Connected", a.connected],
          ["Currency", a.currency],
          [
            "Executor",
            `${a.executor.state}${a.executor.terminalId ? ` (${a.executor.terminalId})` : ""}`,
          ],
          [
            "Sources",
            a.sources
              .map(
                (s: any) =>
                  `${s.terminalId}${s.connected ? "" : " offline"}${s.executorEnabled ? ", trading chart" : ""}${s.maxLots ? `, EA cap ${s.maxLots}` : ""}`
              )
              .join("; ") || null,
          ],
        ])
      );
    })
  );

  accounts.addCommand(
    guide(
      jsonOption(
        accountOptions(
          describe(
            new Command("funds"),
            "balance, equity, margin, free margin, margin level and profit (GET …/funds)",
            "Use it for an account's money: what it holds, what is in use as margin and what is free for a new trade. Check State: fresh is read now; stale is the last snapshot of an offline account; unavailable means none since the app started."
          )
        )
      ).addHelpText(
        "after",
        "\nRead fresh from one connected terminal of the account; offline, the last\nsnapshot (stale) or nulls. Values are in the account's currency."
      ),
      {
        output: `Balance, Equity, Margin, Free margin, Margin level (%; empty without
margin in use), Profit, Leverage (1:N), State, Captured (UTC).
--json: data is { accountId, currency, balance, equity, margin, freeMargin,
marginLevel, profit, leverage, state, capturedAt, capturedBrokerTime,
receivedAt, terminalId }; money is decimal strings, null when unavailable.
A terminal that does not answer within five seconds: exit 9.`,
        examples: [
          "accounts funds --account <account-id>",
          "accounts funds --account <login> --broker EasyForex-Demo --json",
        ],
      }
    ).action(async (o) => {
      const client = await api();
      const envelope = await client.get(
        accountPath(await resolveAccount(client, o.account, o.broker), "/funds")
      );
      const f = envelope.data;
      const money = (v: string | null) =>
        v === null ? null : `${v} ${f.currency ?? ""}`.trim();
      emit(o.json, envelope, () =>
        fields([
          ["Balance", money(f.balance)],
          ["Equity", money(f.equity)],
          ["Margin", money(f.margin)],
          ["Free margin", money(f.freeMargin)],
          [
            "Margin level",
            f.marginLevel === null ? null : `${f.marginLevel} %`,
          ],
          ["Profit", money(f.profit)],
          ["Leverage", f.leverage === null ? null : `1:${f.leverage}`],
          ["State", f.state],
          ["Captured (UTC)", f.capturedAt],
        ])
      );
    })
  );

  accounts.addCommand(
    guide(
      jsonOption(
        accountOptions(
          describe(
            new Command("conditions"),
            "a market's contract data from the account's own terminal (GET …/markets/{marketId}/conditions)",
            "Use it before sizing or placing an order: the smallest, largest and step of lots, stop and freeze levels (how close stops may be), tick size, contract size, margin per lot and swaps, as the account's own terminal reports them."
          )
        )
      )
        .argument("[symbol]", "exact symbol on the account's broker server")
        .option("--market-id <id>", "the market's exact ID")
        .addHelpText(
          "after",
          "\nThe account fixes the broker server: SYMBOL is looked up on it. Works on real\naccounts and without trading permission."
        ),
      {
        output: `Market, Bid / ask, Lots (min, max, step), Tick size, Stop / freeze level
(points), Trade allowed, Contract size, Margin per lot, Swap long / short,
Quote time (UTC).
--json: data is { accountId, marketId, symbol, bid, ask, digits, point,
tickSize, minLots, maxLots, lotStep, stopLevel, freezeLevel, tradeAllowed,
quoteTime, quoteBrokerTime, tickValue, contractSize, marginRequired,
swapLong, swapShort, swapType, profitCurrency, terminalId, receivedAt }.
A market on another broker server: exit 7 (cross-broker-market).`,
        examples: [
          "accounts conditions EURUSD --account <account-id>",
          "accounts conditions --account <account-id> --market-id <market-id> --json",
        ],
        seeAlso: ["orders preview --account A --symbol S ..."],
      }
    ).action(async (symbol: string | undefined, o) => {
      const client = await api();
      const account = await resolveAccount(client, o.account, o.broker);
      const market = await resolveMarket(
        client,
        o.marketId
          ? { marketId: o.marketId }
          : { symbol, broker: account.brokerServer }
      );
      const envelope = await client.get(
        accountPath(
          account,
          `/markets/${encodeURIComponent(market.id)}/conditions`
        )
      );
      const k = envelope.data;
      emit(o.json, envelope, () =>
        fields([
          ["Market", `${k.symbol} · ${account.brokerServer}`],
          ["Bid / ask", `${k.bid} / ${k.ask}`],
          ["Lots", `min ${k.minLots}, max ${k.maxLots}, step ${k.lotStep}`],
          ["Tick size", k.tickSize],
          ["Stop / freeze level (points)", `${k.stopLevel} / ${k.freezeLevel}`],
          ["Trade allowed", k.tradeAllowed],
          ["Contract size", k.contractSize],
          [
            "Margin per lot",
            `${k.marginRequired} ${account.currency ?? ""}`.trim(),
          ],
          ["Swap long / short", `${k.swapLong} / ${k.swapShort}`],
          ["Quote time (UTC)", k.quoteTime],
        ])
      );
    })
  );
  return accounts;
}

const TRADE_COLUMNS = (kind: "positions" | "orders") => [
  { header: "TICKET", value: (t: any) => t.ticket, align: "right" as const },
  { header: "SYMBOL", value: (t: any) => t.symbol },
  {
    header: "SIDE",
    value: (t: any) => (kind === "orders" ? `${t.side} ${t.type}` : t.side),
  },
  { header: "LOTS", value: (t: any) => t.lots, align: "right" as const },
  {
    header: kind === "orders" ? "PRICE" : "OPEN",
    value: (t: any) => (kind === "orders" ? t.price : t.openPrice),
    align: "right" as const,
  },
  { header: "SL", value: (t: any) => t.stopLoss, align: "right" as const },
  { header: "TP", value: (t: any) => t.takeProfit, align: "right" as const },
  ...(kind === "orders"
    ? [{ header: "EXPIRY (UTC)", value: (t: any) => t.expiry }]
    : [
        {
          header: "PROFIT",
          value: (t: any) => t.profit,
          align: "right" as const,
        },
      ]),
  {
    header: "ORIGIN",
    value: (t: any) => (t.magic === 27012026 ? "QuoteBridge" : "outside"),
  },
];

/** Says on stderr when an account's positions or orders are not a fresh read (`meta.state`). */
function snapshotNote(meta: Record<string, any> | undefined) {
  if (meta?.state === "stale")
    note(
      "Stale: the account's terminal is offline; this is its last snapshot."
    );
  else if (meta?.state === "unavailable")
    note(
      "Unavailable: no terminal of this account has answered since the app started."
    );
}

/** What a positions or orders table and its --json carry. */
const TRADE_OUTPUT = (kind: "positions" | "orders") =>
  kind === "positions"
    ? `Table: TICKET, SYMBOL, SIDE, LOTS, OPEN, SL, TP, PROFIT, ORIGIN
(QuoteBridge, or outside for trades placed elsewhere); "Stale" or
"Unavailable" on stderr when the account's terminal is offline.
--json: data holds { ticket, accountId, marketId, symbol, side, lots,
stopLoss, takeProfit, magic, openPrice, openTime, openBrokerTime,
currentPrice, profit, swap, commission }; meta has currency and state
(fresh, stale or unavailable). A missing stop is null.`
    : `Table: TICKET, SYMBOL, SIDE (buy limit, sell stop…), LOTS, PRICE, SL, TP,
EXPIRY (UTC), ORIGIN (QuoteBridge, or outside); "Stale" or "Unavailable" on
stderr when the account's terminal is offline.
--json: data holds { ticket, accountId, marketId, symbol, side, type, lots,
stopLoss, takeProfit, magic, price, placedAt, placedBrokerTime, expiry,
expiryBrokerTime, currentPrice }; meta has currency and state.`;

function tradeList(kind: "positions" | "orders") {
  return guide(
    jsonOption(
      accountOptions(
        pageOptions(
          describe(
            new Command("list"),
            kind === "positions"
              ? "open positions of one account (GET …/positions)"
              : "pending limit and stop orders of one account (GET …/orders)",
            kind === "positions"
              ? "Use it to see an account's open trades and their tickets, before positions show, modify or close. Trades placed outside QuoteBridge are listed too. Pending orders are under orders list; closed trades are not listed."
              : "Use it to see an account's pending limit and stop orders and their tickets, before orders show, modify or cancel. Orders placed outside QuoteBridge are listed too. Open positions are under positions list."
          )
        )
      )
    ),
    {
      output: TRADE_OUTPUT(kind),
      examples: [
        `${kind} list --account <account-id>`,
        `${kind} list --account <login> --broker EasyForex-Demo --all --json`,
      ],
      seeAlso: [`${kind} show TICKET --account A`],
    }
  ).action(async (o) => {
    const client = await api();
    const account = await resolveAccount(client, o.account, o.broker);
    const meta = await listCollection(
      client,
      accountPath(account, `/${kind}`),
      {},
      o,
      TRADE_COLUMNS(kind)
    );
    if (!o.json) snapshotNote(meta);
  });
}

function tradeShow(kind: "positions" | "orders") {
  return guide(
    jsonOption(
      accountOptions(
        describe(
          new Command("show"),
          kind === "positions"
            ? "one open position (GET …/positions/{ticket})"
            : "one pending order (GET …/orders/{ticket})",
          `Use it to read one ${kind === "positions" ? "open position" : "pending order"} by its ticket, for instance to check it before a preview or after an execute. A ticket is unique only within its account, so --account is always needed; an unknown ticket exits 5.`
        )
      )
    ).argument(
      "<ticket>",
      "the ticket; tickets are unique only within an account"
    ),
    {
      output: `One row of the ${kind} list table.
--json: data is one ${kind === "positions" ? "position" : "order"} as ${kind} list gives it; meta has
currency and state.`,
      examples: [
        `${kind} show 12345678 --account <account-id>`,
        `${kind} show 12345678 --account <account-id> --json`,
      ],
    }
  ).action(async (ticket: string, o) => {
    const client = await api();
    const account = await resolveAccount(client, o.account, o.broker);
    const envelope = await client.get(
      accountPath(account, `/${kind}/${ticketArg(ticket)}`)
    );
    emit(o.json, envelope, () => table([envelope.data], TRADE_COLUMNS(kind)));
    if (!o.json) snapshotNote(envelope.meta);
  });
}

/** POST /requests/preview and shows what it approved. Sends nothing to MetaTrader. */
async function preview(
  client: ApiClient,
  body: Record<string, unknown>,
  json: boolean | undefined
) {
  const envelope = await client.post("/api/v1/requests/preview", body);
  emit(json, envelope, () => renderRequest(envelope.data));
  if (!json)
    note(
      `Nothing was sent. If the account holder approves this exact preview, send it within 30 s with:\n  mt4-quote-bridge requests execute ${envelope.data.requestId} --confirm`
    );
}

/** A preview or a journal record, for people. */
export function renderRequest(r: any) {
  const i = r.normalizedIntent;
  const what =
    i.action === "place"
      ? `${i.side} ${i.type} ${i.lots} ${i.symbol}`
      : `${i.action} ticket ${i.ticket} (${i.symbol})`;
  const pairs: [string, unknown][] = [
    ["Request", r.requestId],
    ["Status", `${r.status}${r.reviewed ? " (reviewed)" : ""}`],
    ["Account ID", r.accountId],
    ["Action", what],
    ["Price", i.price],
    ["Stop loss", i.stopLoss],
    ["Take profit", i.takeProfit],
    ["Expiry (UTC)", i.expiry],
    ["Slippage (points)", i.slippage],
    [
      "Lot limits",
      r.limits
        ? `broker ${r.limits.broker}, EA ${r.limits.ea}, app ${r.limits.app} → max ${r.limits.maxLots}`
        : null,
    ],
  ];
  if (r.estimates && (r.estimates.loss !== null || r.estimates.reward !== null))
    pairs.push([
      "Estimates",
      `loss ${r.estimates.loss ?? "—"}, reward ${r.estimates.reward ?? "—"} ${r.estimates.currency ?? ""}`.trim(),
    ]);
  if (r.status === "preview") pairs.push(["Expires (UTC)", r.expiresAt]);
  if (r.result)
    pairs.push([
      "Result",
      `${r.result.status}${r.result.ticket ? `, ticket ${r.result.ticket}` : ""}, code ${r.result.code}: ${r.result.message}`,
    ]);
  for (const w of r.warnings ?? []) pairs.push(["Warning", w]);
  return fields(pairs);
}

export function positionsCommand() {
  const positions = familyGuide(
    new Command("positions"),
    "open positions of an account; modify and close only preview",
    "list and show read; modify and close only preview a change. Nothing reaches MetaTrader until requests execute ID --confirm, after the account holder approves that exact preview.",
    `list    an account's open trades and their tickets (start here)
show    one open trade by ticket
modify  preview a new stop loss and/or take profit (none clears one)
close   preview closing a whole position (no partial closes)

Then: mt4-quote-bridge requests execute <request-id> --confirm
Every subcommand takes --account (there is no default account).
Pending orders are under: mt4-quote-bridge orders --help`,
    [
      "positions list --account <account-id>",
      "positions modify 12345678 --account <account-id> --sl 1.08200 --tp none",
      "positions close 12345678 --account <account-id>",
    ]
  );
  positions.addCommand(tradeList("positions"));
  positions.addCommand(tradeShow("positions"));
  positions.addCommand(
    modifyCommand(
      "preview a stop loss / take profit change of a position (POST /requests/preview, action modify)",
      false
    )
  );
  positions.addCommand(
    guide(
      jsonOption(
        accountOptions(
          describe(
            new Command("close"),
            "preview closing a whole position (POST /requests/preview, action close)",
            "Use it when the account holder asks to close an open trade. It previews closing the whole position at the current price; send it with requests execute. A position opened outside QuoteBridge can be closed too, with a warning."
          )
        )
      )
        .argument("<ticket>", "the position's ticket")
        .addHelpText("after", "\nNo partial closes." + PREVIEW_HELP),
      {
        output: PREVIEW_OUTPUT,
        examples: [
          "positions close 12345678 --account <account-id>",
          "positions close 12345678 --account <account-id> --json",
        ],
        seeAlso: ["requests execute <request-id> --confirm"],
      }
    ).action(async (ticket: string, o) => {
      const client = await api();
      const account = await resolveAccount(client, o.account, o.broker);
      await preview(
        client,
        { accountId: account.id, action: "close", ticket: ticketArg(ticket) },
        o.json
      );
    })
  );
  return positions;
}

function modifyCommand(description: string, pending: boolean) {
  const cmd = jsonOption(
    accountOptions(
      describe(
        new Command("modify"),
        description,
        pending
          ? "Use it when the account holder asks to move a pending order's entry price or expiry, or to set, move or remove its stop loss or take profit. Only the options given change."
          : "Use it when the account holder asks to set, move or remove an open position's stop loss or take profit. Only the options given change; lots cannot change."
      )
    )
  )
    .argument(
      "<ticket>",
      pending ? "the pending order's ticket" : "the position's ticket"
    )
    .option(
      "--sl <price|none>",
      "new stop loss; none removes it",
      clearable(decimal)
    )
    .option(
      "--tp <price|none>",
      "new take profit; none removes it",
      clearable(decimal)
    );
  if (pending)
    cmd
      .option("--price <price>", "new entry price", decimal)
      .option(
        "--expiry <utc|none>",
        "new expiry, UTC whole seconds (YYYY-MM-DDTHH:MM:SSZ); none removes it",
        utcExpiry
      );
  const kind = pending ? "orders" : "positions";
  return guide(
    cmd.addHelpText(
      "after",
      "\nOptions left out stay as they are; none clears. No lot changes." +
        PREVIEW_HELP
    ),
    {
      output: PREVIEW_OUTPUT,
      examples: pending
        ? [
            `${kind} modify 12345678 --account <account-id> --price 1.08350`,
            `${kind} modify 12345678 --account <account-id> --expiry 2027-01-20T12:00:00Z --sl none`,
          ]
        : [
            `${kind} modify 12345678 --account <account-id> --sl 1.08200`,
            `${kind} modify 12345678 --account <account-id> --tp 1.09500 --sl none --json`,
          ],
      seeAlso: ["requests execute <request-id> --confirm"],
    }
  ).action(async (ticket: string, o) => {
    const body: Record<string, unknown> = {};
    if (o.sl !== undefined) body.stopLoss = cleared(o.sl);
    if (o.tp !== undefined) body.takeProfit = cleared(o.tp);
    if (o.price !== undefined) body.price = o.price;
    if (o.expiry !== undefined) body.expiry = cleared(o.expiry);
    if (!Object.keys(body).length)
      throw usage(
        `Say what to change: ${pending ? "--price, --expiry, " : ""}--sl or --tp.`
      );
    const client = await api();
    const account = await resolveAccount(client, o.account, o.broker);
    await preview(
      client,
      {
        accountId: account.id,
        action: "modify",
        ticket: ticketArg(ticket),
        ...body,
      },
      o.json
    );
  });
}

export function ordersCommand() {
  const orders = familyGuide(
    new Command("orders"),
    "pending orders of an account, and new orders; preview, modify and cancel only preview",
    "list and show read pending (limit and stop) orders. preview, modify and cancel only preview; nothing reaches MetaTrader until requests execute ID --confirm, after the account holder approves that exact preview.",
    `list     an account's pending limit and stop orders (start here)
show     one pending order by ticket
preview  preview a NEW order: market, limit or stop, with optional stops
modify   preview a pending order's new entry, expiry, stop loss, take profit
cancel   preview cancelling a pending order

Then: mt4-quote-bridge requests execute <request-id> --confirm
Every subcommand takes --account (there is no default account).
Open positions are under: mt4-quote-bridge positions --help`,
    [
      "orders list --account <account-id>",
      "orders preview --account <account-id> --symbol EURUSD --side buy --type market --lots 0.10 --sl-points 200 --tp-points 400",
      "orders cancel 12345678 --account <account-id>",
    ]
  );
  orders.addCommand(tradeList("orders"));
  orders.addCommand(tradeShow("orders"));
  orders.addCommand(
    jsonOption(
      accountOptions(
        describe(
          new Command("preview"),
          "preview a new market, limit or stop order (POST /requests/preview, action place)",
          "Use it when the account holder asks for a new trade: account, symbol, side, type, lots and stops all come from them. The app checks lots, prices, stops and margin against the account's terminal and answers the exact order execute would send, with estimates and warnings. A market order fills at the current price; a limit or stop order waits at --price."
        )
      )
    )
      .option(
        "--symbol <symbol>",
        "exact symbol on the account's broker server"
      )
      .option("--market-id <id>", "the market's exact ID (instead of --symbol)")
      .addOption(
        new Option("--side <side>", "buy or sell")
          .choices(["buy", "sell"])
          .makeOptionMandatory()
      )
      .addOption(
        new Option("--type <type>", "market, limit or stop")
          .choices(["market", "limit", "stop"])
          .makeOptionMandatory()
      )
      .requiredOption("--lots <lots>", "volume in lots, e.g. 0.10", decimal)
      .option(
        "--price <price>",
        "entry price of a limit or stop order",
        decimal
      )
      .option(
        "--expiry <utc>",
        "expiry of a limit or stop order, UTC whole seconds (YYYY-MM-DDTHH:MM:SSZ)",
        utcExpiry
      )
      .option("--sl <price>", "absolute stop loss", decimal)
      .option("--tp <price>", "absolute take profit", decimal)
      .option(
        "--sl-points <points>",
        "stop loss distance in points from the entry",
        decimal
      )
      .option(
        "--tp-points <points>",
        "take profit distance in points from the entry",
        decimal
      )
      .option(
        "--risk-amount <money>",
        "risk plan: loss in the account's currency",
        decimal
      )
      .option(
        "--risk-percent <percent>",
        "risk plan: loss as a percentage of the balance",
        decimal
      )
      .option(
        "--risk-points <points>",
        "risk plan: loss distance in points",
        decimal
      )
      .option(
        "--reward-ratio <ratio>",
        "risk plan: take profit as a multiple of the loss",
        decimal
      )
      .addHelpText(
        "after",
        MARKET_HELP +
          `

Stops take one form: absolute (--sl/--tp), distances in points from the
entry (--sl-points/--tp-points: a buy's stop loss below it, a sell's above),
or a risk plan (one --risk-* and --reward-ratio). Distances and a risk plan
are worked out from the previewed entry, rounded toward it; one that cannot
be met is refused, not widened.
Estimates exclude fees, swaps and slippage and are not loss caps.` +
          PREVIEW_HELP +
          `

Order types:
  market  fills now at the current price; no --price or --expiry
  limit   waits at --price: a buy below the market, a sell above it
  stop    waits at --price: a buy above the market, a sell below it

Stop forms (one per order):
  --sl P / --tp P                      absolute prices
  --sl-points N / --tp-points N        points from the entry
  --risk-amount|--risk-percent|--risk-points X --reward-ratio R
                                       a risk plan: the stop loss loses X, the
                                       take profit wins R times as much`
      )
      .addHelpText("after", section("Output", PREVIEW_OUTPUT))
      .addHelpText(
        "after",
        section(
          "Examples",
          `mt4-quote-bridge orders preview --account <account-id> --symbol EURUSD --side buy --type market --lots 0.10
mt4-quote-bridge orders preview --account <account-id> --symbol EURUSD --side buy --type market --lots 0.10 --sl-points 200 --tp-points 400
mt4-quote-bridge orders preview --account <account-id> --symbol EURUSD --side sell --type limit --lots 0.05 --price 1.09500 --expiry 2027-01-20T12:00:00Z --sl 1.09800 --tp 1.08900
mt4-quote-bridge orders preview --account <account-id> --symbol EURUSD --side buy --type stop --lots 0.10 --price 1.10200 --risk-percent 1 --reward-ratio 2 --json`
        )
      )
      .addHelpText(
        "after",
        section(
          "See also",
          `mt4-quote-bridge accounts conditions SYMBOL --account A   (lot step, stop level)
mt4-quote-bridge requests execute <request-id> --confirm`
        )
      )
      .action(async (o) => {
        if (
          o.type === "market" &&
          (o.price !== undefined || o.expiry !== undefined)
        )
          throw usage(
            "A market order takes no --price or --expiry: it fills at the current price."
          );
        if (o.type !== "market" && o.price === undefined)
          throw usage(`A ${o.type} order needs --price, its entry price.`);
        const client = await api();
        const account = await resolveAccount(client, o.account, o.broker);
        // The account fixes the broker server the symbol is looked up on.
        const market = await resolveMarket(
          client,
          o.marketId
            ? { marketId: o.marketId, symbol: o.symbol }
            : { symbol: o.symbol, broker: account.brokerServer }
        );
        const body: Record<string, unknown> = {
          accountId: account.id,
          action: "place",
          marketId: market.id,
          side: o.side,
          type: o.type,
          lots: o.lots,
        };
        if (o.price !== undefined) body.price = o.price;
        if (o.expiry === "none")
          throw usage(
            "A new order's --expiry takes a time; leave it out for none."
          );
        if (o.expiry !== undefined) body.expiry = o.expiry;
        if (o.sl !== undefined) body.stopLoss = o.sl;
        if (o.tp !== undefined) body.takeProfit = o.tp;
        if (o.slPoints !== undefined || o.tpPoints !== undefined) {
          const others = [
            o.sl,
            o.tp,
            o.riskAmount,
            o.riskPercent,
            o.riskPoints,
            o.rewardRatio,
          ];
          if (others.some((v) => v !== undefined))
            throw usage(
              "Give stops one way: --sl/--tp, --sl-points/--tp-points or a risk plan."
            );
          body.distance = {
            ...(o.slPoints !== undefined && { stopLoss: o.slPoints }),
            ...(o.tpPoints !== undefined && { takeProfit: o.tpPoints }),
          };
        }
        const losses = [
          ["amount", o.riskAmount],
          ["balancePercent", o.riskPercent],
          ["points", o.riskPoints],
        ].filter(([, v]) => v !== undefined);
        if (losses.length > 1)
          throw usage(
            "Give one of --risk-amount, --risk-percent or --risk-points."
          );
        if (losses.length || o.rewardRatio !== undefined) {
          if (!losses.length || o.rewardRatio === undefined)
            throw usage(
              "A risk plan needs one --risk-* option and --reward-ratio."
            );
          body.risk = {
            loss: { [losses[0][0]]: losses[0][1] },
            rewardRatio: o.rewardRatio,
          };
        }
        await preview(client, body, o.json);
      })
  );
  orders.addCommand(
    modifyCommand(
      "preview changing a pending order's entry, expiry, stop loss or take profit (POST /requests/preview, action modify)",
      true
    )
  );
  orders.addCommand(
    guide(
      jsonOption(
        accountOptions(
          describe(
            new Command("cancel"),
            "preview cancelling a pending order (POST /requests/preview, action cancel)",
            "Use it when the account holder asks to delete a pending limit or stop order. To close an open position instead, use positions close."
          )
        )
      )
        .argument("<ticket>", "the pending order's ticket")
        .addHelpText("after", PREVIEW_HELP),
      {
        output: PREVIEW_OUTPUT,
        examples: [
          "orders cancel 12345678 --account <account-id>",
          "orders cancel 12345678 --account <account-id> --json",
        ],
        seeAlso: ["requests execute <request-id> --confirm"],
      }
    ).action(async (ticket: string, o) => {
      const client = await api();
      const account = await resolveAccount(client, o.account, o.broker);
      await preview(
        client,
        {
          accountId: account.id,
          action: "cancel",
          ticket: ticketArg(ticket),
        },
        o.json
      );
    })
  );
  return orders;
}

const REQUEST_ID = /^[0-9a-f]{32}$/;
function requestIdArg(id: string) {
  if (!REQUEST_ID.test(id))
    throw usage(
      `"${id}" is not a request ID (32 lowercase hexadecimal characters).`
    );
  return id;
}

/** The exit status a request's state implies: the command itself worked, but the order may not have. */
function outcomeExit(record: any): number {
  if (record.status === "succeeded" || record.status === "preview")
    return EXIT.ok;
  if (record.status === "failed") return EXIT.failed;
  if (record.status === "unknown")
    return record.reviewed ? EXIT.ok : EXIT.unknown;
  return EXIT.dispatching;
}

function outcomeNote(record: any) {
  const id = record.requestId;
  if (record.status === "unknown" && !record.reviewed) {
    note(`The outcome is UNKNOWN. Do not execute, retry or preview this order again.
Check MetaTrader's open orders and account history first, then record that you did:
  mt4-quote-bridge requests review ${id} --note "<what you found>" --acknowledge`);
  } else if (record.status === "dispatching") {
    note(
      `Sent; no definitive result yet. Do not execute it again. Check later with:\n  mt4-quote-bridge requests show ${id}`
    );
  } else if (record.status === "failed") {
    note("MetaTrader refused it; nothing was changed.");
  }
}

export function requestsCommand() {
  const requests = familyGuide(
    new Command("requests"),
    "trading requests: the journal, status, execute (the only send) and review",
    "Every change to an account is a request: a preview (orders preview|modify|cancel, positions modify|close), then one execute. execute is the only command in this CLI that sends anything to MetaTrader.",
    `show     what happened to a request, or a preview while still valid; the
         answer to a lost reply, a timeout or an unknown outcome
execute  send an approved preview once (--confirm); never retried
review   record what the account holder found in MetaTrader after an
         unknown outcome, which lifts the account's block
list     the journal of executed requests, oldest first

Flow: preview → account holder approves → requests execute ID --confirm →
exit 0 succeeded, 11 failed, 12 still dispatching (requests show later),
10 unknown (check MetaTrader, then requests review).`,
    [
      "requests execute <request-id> --confirm",
      "requests show <request-id>",
      'requests review <request-id> --note "No order in MT4 history" --acknowledge',
      "requests list --account <account-id>",
    ]
  );

  requests.addCommand(
    guide(
      jsonOption(
        pageOptions(
          describe(
            new Command("list"),
            "the journal of executed requests, oldest first (GET /api/v1/requests)",
            "Use it to look back over what was sent: every executed request with its status and ticket, kept indefinitely. Previews that were never executed are not in the journal. To follow one request, use requests show."
          )
        )
      )
        .option(
          "--account <id|login>",
          "only this account (its ID, or login with --broker)"
        )
        .option("--broker <server>", "exact broker server of a login"),
      {
        output: `Table: CREATED (UTC), STATUS (succeeded, failed, dispatching, unknown,
"(reviewed)"), ACTION, TICKET, REQUEST ID.
--json: data is an array of request records, as requests show gives them.`,
        examples: [
          "requests list",
          "requests list --account <account-id> --all --json",
        ],
      }
    ).action(async (o) => {
      const client = await api();
      const accountId =
        o.account === undefined
          ? undefined
          : (await resolveAccount(client, o.account, o.broker)).id;
      await listCollection(client, "/api/v1/requests", { accountId }, o, [
        { header: "CREATED (UTC)", value: (r: any) => r.createdAt },
        {
          header: "STATUS",
          value: (r: any) => `${r.status}${r.reviewed ? " (reviewed)" : ""}`,
        },
        {
          header: "ACTION",
          value: (r: any) =>
            `${r.normalizedIntent.action} ${r.normalizedIntent.side} ${r.normalizedIntent.lots} ${r.normalizedIntent.symbol}`,
        },
        {
          header: "TICKET",
          value: (r: any) => r.result?.ticket ?? r.normalizedIntent.ticket,
        },
        { header: "REQUEST ID", value: (r: any) => r.requestId },
      ]);
    })
  );

  requests.addCommand(
    guide(
      jsonOption(
        describe(
          new Command("show"),
          "a request's record, or its preview while still valid (GET /api/v1/requests/{requestId})",
          "Use it to find out what happened to a request: after execute exits 12, after a lost answer or timeout, or to check on an unknown outcome. It only reads, so it is always safe to repeat."
        )
      )
        .argument(
          "<request-id>",
          "the request ID (32 hex characters) a preview printed"
        )
        .addHelpText(
          "after",
          "\nThe way to find out what happened to an executed request: never execute or preview again for that.\nExit status: 0 succeeded, reviewed or a valid preview; 10 unknown (not reviewed); 11 failed; 12 still dispatching."
        ),
      {
        output: `The preview's fields, plus Status and Result (status, ticket, MetaTrader's
code and message); on stderr, what to do next for unknown, dispatching or
failed.
--json: data is { requestId, status, reviewed, origin, createdAt, updatedAt,
accountId, marketId, terminalId, normalizedIntent, target, limits,
estimates, warnings, result: { status, ticket, code, message } | null,
events: [{ type, at, … }] }.`,
        examples: [
          "requests show <request-id>",
          "requests show <request-id> --json",
        ],
      }
    ).action(async (id: string, o) => {
      const envelope = await (
        await api()
      ).get(`/api/v1/requests/${requestIdArg(id)}`);
      emit(o.json, envelope, () => renderRequest(envelope.data));
      if (!o.json) outcomeNote(envelope.data);
      process.exitCode = outcomeExit(envelope.data);
    })
  );

  requests.addCommand(
    jsonOption(
      describe(
        new Command("execute"),
        "send a previewed request to MetaTrader, once (POST /api/v1/requests/{requestId}/execute)",
        "Use it only after the account holder has approved this exact preview, within its 30 seconds. It sends the request once, then reads it until MetaTrader answers or --wait passes. Whatever happens next, find out with requests show, never by executing or previewing again."
      )
    )
      .argument("<request-id>", "the preview's requestId")
      .option("--confirm", "required: confirms this exact preview")
      .option(
        "--wait <seconds>",
        "how long to wait for a definitive result by reading the request (0–60, default 25)",
        (v: string) => {
          if (!/^\d+$/.test(v) || Number(v) > 60)
            throw usage("--wait takes whole seconds from 0 to 60.");
          return Number(v);
        }
      )
      .addHelpText(
        "after",
        `
--confirm is required and is not a substitute for the account holder's
approval of this exact preview. Execute posts once and never retries; it then
only reads the request (GET) until a definitive result or --wait passes.
A lost answer is recovered with: mt4-quote-bridge requests show <request-id>

Exit status: 0 succeeded; 10 unknown (check MetaTrader, then review; never
retry); 11 failed (refused); 12 sent but no definitive result yet; 7 the
preview expired or no longer holds (preview again); 1 the app could not be
reached (nothing was sent) or the answer was lost (it may have been sent:
requests show, never execute again).`
      )
      .addHelpText(
        "after",
        section(
          "Output",
          `The request record as requests show prints it, with Result once MetaTrader
answers; on stderr, what to do next. --json: the record (see requests show).`
        )
      )
      .addHelpText(
        "after",
        section(
          "Examples",
          `mt4-quote-bridge requests execute <request-id> --confirm
mt4-quote-bridge requests execute <request-id> --confirm --wait 60 --json`
        )
      )
      .action(async (id: string, o) => {
        requestIdArg(id);
        if (!o.confirm)
          throw usage(
            "Nothing was sent. Executing needs --confirm, after the account holder approves this exact preview."
          );
        const client = await api();
        let sent: Envelope;
        try {
          sent = await client.post(`/api/v1/requests/${id}/execute`, {
            confirm: true,
          });
        } catch (e) {
          // Without the server's answer the request may still have been sent: read it, never execute again.
          // One error carries the warning, so --json readers get it in the envelope too.
          if (e instanceof ApiError) throw e;
          // Errors before anything left (no key, a refused connection) sent nothing: say so, with their own code.
          if (e instanceof CliError && e.code === "not-signed-in") throw e;
          if (e instanceof UnreachableError && e.neverConnected)
            throw new CliError(
              `Nothing was sent. ${e.message}`,
              e.exitCode,
              e.code
            );
          throw new CliError(
            `The answer was lost; the request may have been sent. Do not execute again. Check with:\n  mt4-quote-bridge requests show ${id}`,
            EXIT.error,
            e instanceof CliError ? e.code : "cli-error"
          );
        }
        let envelope = sent;
        const deadline = Date.now() + (o.wait ?? 25) * 1000;
        while (
          envelope.data.status === "dispatching" &&
          Date.now() < deadline
        ) {
          await new Promise((r) => setTimeout(r, 500));
          try {
            envelope = await client.get(`/api/v1/requests/${id}`);
          } catch (e) {
            // Reading failed; the request was still sent once. Report what is known.
            note(
              `Could not read the request's status (${(e as Error).message}). Check with: mt4-quote-bridge requests show ${id}`
            );
            break;
          }
        }
        emit(o.json, envelope, () => renderRequest(envelope.data));
        if (!o.json) outcomeNote(envelope.data);
        process.exitCode = outcomeExit(envelope.data);
      })
  );

  requests.addCommand(
    jsonOption(
      describe(
        new Command("review"),
        "acknowledge an unknown outcome after checking MetaTrader (POST /api/v1/requests/{requestId}/review)",
        "Use it only for a request whose outcome is unknown (exit 10), after the account holder has checked MetaTrader's open orders and account history; the note records what they found. It lifts the block on the account's new previews. Any other request exits 7 (request-not-unknown)."
      )
    )
      .argument("<request-id>", "the unknown request's ID")
      .requiredOption(
        "--note <text>",
        "what you found in MetaTrader (8–500 characters)"
      )
      .option(
        "--acknowledge",
        "required: confirms MetaTrader's open orders and account history were checked"
      )
      .addHelpText(
        "after",
        "\nReview lifts the account's block. It does not invent an outcome (the status stays unknown) and never resends."
      )
      .addHelpText(
        "after",
        section(
          "Output",
          `The request record, Status "unknown (reviewed)". --json: the record.`
        )
      )
      .addHelpText(
        "after",
        section(
          "Examples",
          `mt4-quote-bridge requests review <request-id> --note "Checked MT4: no such order in history" --acknowledge
mt4-quote-bridge requests review <request-id> --note "Filled as ticket 12345678 in MT4" --acknowledge --json`
        )
      )
      .action(async (id: string, o) => {
        requestIdArg(id);
        if (!o.acknowledge)
          throw usage(
            "Review needs --acknowledge: check MetaTrader's open orders and account history first."
          );
        const envelope = await (
          await api()
        ).post(`/api/v1/requests/${id}/review`, {
          note: o.note,
          acknowledged: true,
        });
        emit(o.json, envelope, () => renderRequest(envelope.data));
      })
  );
  return requests;
}
