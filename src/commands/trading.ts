// Accounts, positions, pending orders and trading requests. Every mutation command only previews; the one command
// that sends anything is `requests execute <id> --confirm`, and nothing is ever retried.
import { Command, Option } from "commander";
import {
  ApiClient,
  ApiError,
  CliError,
  EXIT,
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
  jsonOption,
  listCollection,
  MARKET_HELP,
  pageOptions,
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
  const accounts = new Command("accounts").description(
    "trading accounts (broker server + login): discovery, Funds and symbol conditions"
  );

  accounts.addCommand(
    jsonOption(pageOptions(new Command("list")))
      .description("list known trading accounts (GET /api/v1/accounts)")
      .addHelpText(
        "after",
        "\nEXECUTOR: ready (exactly one connected chart with demo trading enabled and ready), zero, multiple, not-ready or real-account."
      )
      .action(async (o) =>
        listCollection(await api(), "/api/v1/accounts", {}, o, ACCOUNT_COLUMNS)
      )
  );

  accounts.addCommand(
    jsonOption(accountOptions(new Command("show")))
      .description(
        "one account's identity, connection, executor and sources (GET /api/v1/accounts/{accountId})"
      )
      .action(async (o) => {
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
              a.demo === null
                ? "unknown"
                : a.demo
                  ? "demo"
                  : "real (read-only)",
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
    jsonOption(accountOptions(new Command("funds")))
      .description(
        "balance, equity, margin, free margin, margin level and profit (GET …/funds)"
      )
      .addHelpText(
        "after",
        "\nRead fresh from one connected terminal of the account; offline, the last snapshot (stale) or nulls. Values are in the account's currency."
      )
      .action(async (o) => {
        const client = await api();
        const envelope = await client.get(
          accountPath(
            await resolveAccount(client, o.account, o.broker),
            "/funds"
          )
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
    jsonOption(accountOptions(new Command("conditions")))
      .description(
        "a market's contract data from the account's own terminal (GET …/markets/{marketId}/conditions)"
      )
      .argument("[symbol]", "exact symbol on the account's broker server")
      .option("--market-id <id>", "the market's exact ID")
      .addHelpText(
        "after",
        "\nThe account fixes the broker server: SYMBOL is looked up on it. Works on real accounts and without trading permission."
      )
      .action(async (symbol: string | undefined, o) => {
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
            [
              "Stop / freeze level (points)",
              `${k.stopLevel} / ${k.freezeLevel}`,
            ],
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

function tradeList(kind: "positions" | "orders") {
  return jsonOption(accountOptions(pageOptions(new Command("list"))))
    .description(
      kind === "positions"
        ? "open positions of one account (GET …/positions)"
        : "pending limit and stop orders of one account (GET …/orders)"
    )
    .action(async (o) => {
      const client = await api();
      const account = await resolveAccount(client, o.account, o.broker);
      await listCollection(
        client,
        accountPath(account, `/${kind}`),
        {},
        o,
        TRADE_COLUMNS(kind)
      );
    });
}

function tradeShow(kind: "positions" | "orders") {
  return jsonOption(accountOptions(new Command("show")))
    .description(
      kind === "positions"
        ? "one open position (GET …/positions/{ticket})"
        : "one pending order (GET …/orders/{ticket})"
    )
    .argument(
      "<ticket>",
      "the ticket; tickets are unique only within an account"
    )
    .action(async (ticket: string, o) => {
      const client = await api();
      const account = await resolveAccount(client, o.account, o.broker);
      const envelope = await client.get(
        accountPath(account, `/${kind}/${ticketArg(ticket)}`)
      );
      emit(o.json, envelope, () => table([envelope.data], TRADE_COLUMNS(kind)));
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
  const positions = new Command("positions").description(
    "open positions of an account; modify and close only preview"
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
    jsonOption(accountOptions(new Command("close")))
      .description(
        "preview closing a whole position (POST /requests/preview, action close)"
      )
      .argument("<ticket>", "the position's ticket")
      .addHelpText("after", "\nNo partial closes." + PREVIEW_HELP)
      .action(async (ticket: string, o) => {
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
  const cmd = jsonOption(accountOptions(new Command("modify")))
    .description(description)
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
  return cmd
    .addHelpText(
      "after",
      "\nOptions left out stay as they are; none clears. No lot changes." +
        PREVIEW_HELP
    )
    .action(async (ticket: string, o) => {
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
  const orders = new Command("orders").description(
    "pending orders of an account, and new orders; preview, modify and cancel only preview"
  );
  orders.addCommand(tradeList("orders"));
  orders.addCommand(tradeShow("orders"));
  orders.addCommand(
    jsonOption(accountOptions(new Command("preview")))
      .description(
        "preview a new market, limit or stop order (POST /requests/preview, action place)"
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

Stops are either absolute (--sl/--tp) or a risk plan (one --risk-* and
--reward-ratio), never both. A risk plan works the stops out for --lots,
rounded toward the entry; a plan that cannot be met is refused, not widened.
Estimates exclude fees, swaps and slippage and are not loss caps.` +
          PREVIEW_HELP +
          `

Example:
  mt4-quote-bridge orders preview --account <account-id> --symbol EURUSD --side buy --type market --lots 0.10`
      )
      .action(async (o) => {
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
    jsonOption(accountOptions(new Command("cancel")))
      .description(
        "preview cancelling a pending order (POST /requests/preview, action cancel)"
      )
      .argument("<ticket>", "the pending order's ticket")
      .addHelpText("after", PREVIEW_HELP)
      .action(async (ticket: string, o) => {
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
  const requests = new Command("requests").description(
    "trading requests: the journal, status, execute (the only send) and review"
  );

  requests.addCommand(
    jsonOption(pageOptions(new Command("list")))
      .description(
        "the journal of executed requests, oldest first (GET /api/v1/requests)"
      )
      .option(
        "--account <id|login>",
        "only this account (its ID, or login with --broker)"
      )
      .option("--broker <server>", "exact broker server of a login")
      .action(async (o) => {
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
    jsonOption(new Command("show"))
      .description(
        "a request's record, or its preview while still valid (GET /api/v1/requests/{requestId})"
      )
      .argument("<request-id>")
      .addHelpText(
        "after",
        "\nThe way to find out what happened to an executed request: never execute or preview again for that.\nExit status: 0 succeeded, reviewed or a valid preview; 10 unknown (not reviewed); 11 failed; 12 still dispatching."
      )
      .action(async (id: string, o) => {
        const envelope = await (
          await api()
        ).get(`/api/v1/requests/${requestIdArg(id)}`);
        emit(o.json, envelope, () => renderRequest(envelope.data));
        if (!o.json) outcomeNote(envelope.data);
        process.exitCode = outcomeExit(envelope.data);
      })
  );

  requests.addCommand(
    jsonOption(new Command("execute"))
      .description(
        "send a previewed request to MetaTrader, once (POST /api/v1/requests/{requestId}/execute)"
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
preview expired or no longer holds (preview again); 1 the answer was lost (it
may have been sent: requests show, never execute again).`
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
    jsonOption(new Command("review"))
      .description(
        "acknowledge an unknown outcome after checking MetaTrader (POST /api/v1/requests/{requestId}/review)"
      )
      .argument("<request-id>")
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
