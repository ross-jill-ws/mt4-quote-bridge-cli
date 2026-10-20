import { Command, Option } from "commander";
import { ApiClient } from "../client.js";
import { emit, formatOf, print } from "../output.js";
import { formatTime } from "../time.js";
import { TIME_HELP, outputOptions } from "./common.js";

export type Position = {
  login: number;
  broker: string;
  currency: string;
  ticket: number;
  type: string;
  pending: boolean;
  symbol: string;
  lots: number;
  price: number;
  current: number;
  sl: number;
  tp: number;
  profit: number;
  swap: number;
  commission: number;
  net: number;
  magic: number;
  opened: number;
  expiration: number;
};
type Totals = {
  login: number;
  broker: string;
  currency: string;
  count: number;
  lots: number;
  net: number;
};
type AccountError = { login: number; broker: string; error: string };

export function accountOptions(cmd: Command) {
  return cmd
    .option(
      "--account <login>",
      "only this MT4 account login (default: every online account)"
    )
    .option(
      "--broker <text>",
      "only accounts whose broker name contains <text>"
    );
}

export function warnErrors(errors: AccountError[] | undefined) {
  for (const e of errors ?? [])
    process.stderr.write(
      `warning: account ${e.login} (${e.broker}) skipped: ${e.error}\n`
    );
}

const ACCOUNT_HELP = `
Accounts:
  Without --account, every online MT4 account is read. Data is a fresh
  snapshot from MT4 through each account's EA. An account whose EA does not
  answer is skipped with a warning on stderr (JSON: "errors").`;

export function positionCommand() {
  const positions = new Command("position")
    .usage("[list|show] [args...] [options]")
    .description("open positions and pending orders across MT4 accounts")
    .addHelpText(
      "after",
      `
Subcommands / shorthand:
  position [list]            open positions (default), --pending or --all
  position <TICKET>          = position show <TICKET>

Examples:
  mt4-quote-bridge position
  mt4-quote-bridge position list --pending
  mt4-quote-bridge position list --symbol AUDUSD --json
  mt4-quote-bridge position 12345678`
    );

  outputOptions(
    accountOptions(
      positions
        .command("list", { isDefault: true })
        .description("list open positions (or pending orders) with profit")
        .option("--symbol <symbol>", "only this symbol (case-insensitive)")
        .addOption(
          new Option(
            "--pending",
            "pending orders instead of open positions"
          ).conflicts("all")
        )
        .option("--all", "open positions and pending orders")
    )
  )
    .addHelpText(
      "after",
      `
Shorthand: mt4-quote-bridge position

Columns: ACCOUNT, TICKET, TYPE (Buy, Sell, Buy Limit, ...), SYMBOL, LOTS,
OPEN (open/entry price), CURRENT (current market price), SL, TP,
NET (profit + swap + commission, account currency), OPENED (broker time).
A totals line per account follows the table (count, lots, net).
${ACCOUNT_HELP}
${TIME_HELP}

JSON: { type, positions:[{ login, broker, currency, ticket, type, kind, pending,
symbol, lots, price, current, sl, tp, profit, swap, commission, net, magic,
opened, expiration }], totals:[{ login, broker, currency, count, lots, net }], errors:[] }

Examples:
  mt4-quote-bridge position list
  mt4-quote-bridge position list --all --account 12345678
  mt4-quote-bridge position list --symbol XAUUSD --csv`
    )
    .action(async (o) => {
      const data = await (
        await ApiClient.fromProfile()
      ).get<{
        positions: Position[];
        totals: Totals[];
        errors: AccountError[];
      }>("/api/v1/positions", {
        type: o.all ? "all" : o.pending ? "pending" : "open",
        symbol: o.symbol,
        account: o.account,
        broker: o.broker,
      });
      warnErrors(data.errors);
      const multi = new Set(data.positions.map((p) => p.login)).size > 1;
      emit(
        formatOf(o),
        data,
        data.positions,
        [
          ...(multi
            ? [{ header: "ACCOUNT", value: (p: Position) => p.login }]
            : []),
          { header: "TICKET", value: (p) => p.ticket },
          { header: "TYPE", value: (p) => p.type },
          { header: "SYMBOL", value: (p) => p.symbol },
          { header: "LOTS", value: (p) => p.lots, align: "right" },
          { header: "OPEN", value: (p) => p.price, align: "right" },
          { header: "CURRENT", value: (p) => p.current, align: "right" },
          { header: "SL", value: (p) => p.sl || "", align: "right" },
          { header: "TP", value: (p) => p.tp || "", align: "right" },
          { header: "NET", value: (p) => p.net.toFixed(2), align: "right" },
          {
            header: "OPENED",
            value: (p) => (p.opened ? formatTime(p.opened) : ""),
          },
        ],
        data.totals
          .map(
            (t) =>
              `Account ${t.login} (${t.broker}): ${t.count} · ${t.lots} lots · net ${t.net.toFixed(2)} ${t.currency}`
          )
          .join("\n")
      );
    });

  outputOptions(
    accountOptions(
      positions
        .command("show")
        .usage("<TICKET> [options]")
        .description("show every field of one position or pending order")
        .argument("<ticket>", "MT4 order ticket")
    ),
    false
  )
    .addHelpText(
      "after",
      `
Shorthand: mt4-quote-bridge position <TICKET>

Looks the ticket up in every online account (or --account) and prints all
fields, including swap, commission, magic number and pending expiration.
${ACCOUNT_HELP}

Example:
  mt4-quote-bridge position 12345678 --json`
    )
    .action(async (ticket: string, o) => {
      const p = await (
        await ApiClient.fromProfile()
      ).get<Position>(`/api/v1/positions/${encodeURIComponent(ticket)}`, {
        account: o.account,
        broker: o.broker,
      });
      if (o.json) return print(JSON.stringify(p, null, 2));
      const rows: [string, unknown][] = [
        ["Ticket", p.ticket],
        ["Account", `${p.login} (${p.broker})`],
        ["Type", p.type],
        ["Symbol", p.symbol],
        ["Lots", p.lots],
        [p.pending ? "Entry price" : "Open price", p.price],
        ["Current price", p.current],
        ["Stop loss", p.sl || "none"],
        ["Take profit", p.tp || "none"],
        ["Profit", `${p.profit} ${p.currency}`],
        ["Swap", p.swap],
        ["Commission", p.commission],
        ["Net", `${p.net.toFixed(2)} ${p.currency}`],
        ["Magic", p.magic],
        ["Opened", p.opened ? formatTime(p.opened) : ""],
        ...(p.pending
          ? [
              [
                "Expiration",
                p.expiration ? formatTime(p.expiration) : "none",
              ] as [string, unknown],
            ]
          : []),
      ];
      print(rows.map(([k, v]) => `${k.padEnd(14)} ${v}`).join("\n"));
    });
  return positions;
}
