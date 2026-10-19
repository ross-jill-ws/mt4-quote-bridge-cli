import { Command } from "commander";
import { ApiClient } from "../client.js";
import { emit, formatOf, print } from "../output.js";
import { formatTime } from "../time.js";
import { outputOptions } from "./common.js";

type Account = {
  login: number;
  terminal: string;
  broker: string;
  currency: string;
  demo: boolean;
  online: boolean;
  allowed: boolean;
  reason: string;
};
const ORDER_NAMES = [
  "Buy",
  "Sell",
  "Buy Limit",
  "Sell Limit",
  "Buy Stop",
  "Sell Stop",
];

export function accountCommand() {
  const account = new Command("account")
    .description("MT4 trading accounts, balances and open orders")
    .addHelpText(
      "after",
      `
Subcommands:
  list            accounts reported by connected EAs and whether CLI orders are allowed
  show <LOGIN>    balance, equity, margin and open/pending orders`
    );

  outputOptions(
    account
      .command("list")
      .description("list MT4 accounts and trading permission"),
    false
  )
    .addHelpText(
      "after",
      `
Columns: LOGIN, BROKER, TYPE (demo/live), STATUS, TRADING ("allowed" or the
reason orders are blocked: live account, server DEMO_TRADING_ENABLED=false,
no/multiple executor EAs, AutoTrading off).

Example:
  mt4-quote-bridge account list`
    )
    .action(async (o) => {
      const data = await (
        await ApiClient.fromProfile()
      ).get<{
        tradingEnabled: boolean;
        maxLots: number;
        accounts: Account[];
      }>("/api/v1/accounts");
      emit(
        formatOf(o),
        data,
        data.accounts,
        [
          { header: "LOGIN", value: (a) => a.login },
          { header: "BROKER", value: (a) => a.broker },
          { header: "TYPE", value: (a) => (a.demo ? "demo" : "live") },
          { header: "CURRENCY", value: (a) => a.currency },
          { header: "STATUS", value: (a) => (a.online ? "online" : "offline") },
          {
            header: "TRADING",
            value: (a) => (a.allowed ? "allowed" : a.reason),
          },
        ],
        `Server demo trading ${data.tradingEnabled ? "enabled" : "disabled"} · max ${data.maxLots} lots per order`
      );
    });

  outputOptions(
    account
      .command("show")
      .usage("<LOGIN> [options]")
      .description("show balance/equity and open orders for an account")
      .argument("<login>", 'MT4 account login from "account list"')
      .option(
        "--broker <text>",
        "broker name substring when a login is ambiguous"
      ),
    false
  )
    .addHelpText(
      "after",
      `
Reads a fresh snapshot from MT4 through the account's EA.
Orders columns: TICKET, TYPE, SYMBOL, LOTS, PRICE, SL, TP, PROFIT, OPENED.

Example:
  mt4-quote-bridge account show 12345678`
    )
    .action(async (login: string, o) => {
      const data = await (
        await ApiClient.fromProfile()
      ).get<{
        info: Account;
        snapshot: {
          balance: number;
          equity: number;
          margin: number;
          freeMargin: number;
          profit: number;
          leverage: number;
          currency: string;
          orders: {
            ticket: number;
            kind: number;
            symbol: string;
            lots: number;
            price: number;
            sl: number;
            tp: number;
            profit: number;
            opened: number;
          }[];
        };
      }>(`/api/v1/accounts/${encodeURIComponent(login)}`, { broker: o.broker });
      if (o.json) return print(JSON.stringify(data, null, 2));
      const s = data.snapshot;
      print(
        `Account ${data.info.login} (${data.info.broker}, ${data.info.demo ? "demo" : "live"}) 1:${s.leverage}\n` +
          `Balance ${s.balance} ${s.currency} · Equity ${s.equity} · Margin ${s.margin} · Free ${s.freeMargin} · P/L ${s.profit}\n`
      );
      emit("table", data, s.orders, [
        { header: "TICKET", value: (r) => r.ticket },
        { header: "TYPE", value: (r) => ORDER_NAMES[r.kind] },
        { header: "SYMBOL", value: (r) => r.symbol },
        { header: "LOTS", value: (r) => r.lots, align: "right" },
        { header: "PRICE", value: (r) => r.price, align: "right" },
        { header: "SL", value: (r) => r.sl || "", align: "right" },
        { header: "TP", value: (r) => r.tp || "", align: "right" },
        { header: "PROFIT", value: (r) => r.profit, align: "right" },
        {
          header: "OPENED",
          value: (r) => (r.opened ? formatTime(r.opened) : ""),
        },
      ]);
    });
  return account;
}
