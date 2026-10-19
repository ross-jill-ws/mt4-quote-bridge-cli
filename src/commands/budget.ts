import { Command } from "commander";
import { ApiClient } from "../client.js";
import { emit, formatOf, print } from "../output.js";
import { outputOptions } from "./common.js";
import { accountOptions, warnErrors } from "./positions.js";

type Budget = {
  login: number;
  broker: string;
  currency: string;
  demo: boolean;
  leverage: number;
  balance: number;
  equity: number;
  profit: number;
  margin: number;
  freeMargin: number;
  marginLevel: number | null;
  openPositions: number;
  pendingOrders: number;
  tradingAllowed: boolean;
  tradingReason: string;
};
const money = (n: number) => n.toFixed(2);

export function budgetCommand() {
  const budget = new Command("budget")
    .usage("[show] [LOGIN] [options]")
    .description("account funds: balance, equity, margin and free margin")
    .addHelpText(
      "after",
      `
Subcommands / shorthand:
  budget [show]              funds of every online account
  budget <LOGIN>             = budget show --account <LOGIN>

Examples:
  mt4-quote-bridge budget
  mt4-quote-bridge budget 12345678 --json`
    );

  outputOptions(
    accountOptions(
      budget
        .command("show", { isDefault: true })
        .description("show balance, equity, used/free margin and margin level")
        .argument("[login]", "MT4 account login (same as --account)")
    )
  )
    .addHelpText(
      "after",
      `
Shorthand: mt4-quote-bridge budget [LOGIN]

Reads a fresh account snapshot from MT4 for every online account (or one).
With a single account, prints a detailed summary. With several, prints a table.
Amounts are in the account currency.

Fields:
  BALANCE       account balance (closed trades)
  EQUITY        balance + floating profit/loss
  P/L           floating profit/loss of open positions
  MARGIN        margin used by open positions
  FREE          free margin = equity - margin (funds available for new trades)
  LEVEL         margin level % = equity / margin x 100 (blank when no margin used)
  OPEN/PENDING  number of open positions / pending orders
  TRADING       "allowed" when CLI/dashboard demo orders can be placed, else why not

Accounts whose EA does not answer are skipped with a warning (JSON: "errors").

JSON: { accounts:[{ login, broker, terminal, currency, demo, leverage, balance,
equity, profit, margin, freeMargin, marginLevel, openPositions, pendingOrders,
tradingAllowed, tradingReason, captured }], errors:[] }

Examples:
  mt4-quote-bridge budget
  mt4-quote-bridge budget show 12345678
  mt4-quote-bridge budget --broker ICMarkets --csv`
    )
    .action(async (login: string | undefined, o) => {
      const data = await (
        await ApiClient.fromProfile()
      ).get<{
        accounts: Budget[];
        errors: { login: number; broker: string; error: string }[];
      }>("/api/v1/budget", { account: login ?? o.account, broker: o.broker });
      warnErrors(data.errors);
      const format = formatOf(o);
      if (format === "table" && data.accounts.length === 1) {
        const a = data.accounts[0];
        print(
          [
            `Account ${a.login} (${a.broker}, ${a.demo ? "demo" : "live"}, 1:${a.leverage})`,
            `Balance       ${money(a.balance)} ${a.currency}`,
            `Equity        ${money(a.equity)} ${a.currency}`,
            `Floating P/L  ${money(a.profit)} ${a.currency}`,
            `Margin used   ${money(a.margin)} ${a.currency}`,
            `Free margin   ${money(a.freeMargin)} ${a.currency}`,
            `Margin level  ${a.marginLevel === null ? "- (no open positions)" : a.marginLevel + "%"}`,
            `Positions     ${a.openPositions} open · ${a.pendingOrders} pending`,
            `Trading       ${a.tradingAllowed ? "allowed" : a.tradingReason}`,
          ].join("\n")
        );
        return;
      }
      emit(format, data, data.accounts, [
        { header: "LOGIN", value: (a) => a.login },
        { header: "BROKER", value: (a) => a.broker },
        { header: "CURRENCY", value: (a) => a.currency },
        { header: "BALANCE", value: (a) => money(a.balance), align: "right" },
        { header: "EQUITY", value: (a) => money(a.equity), align: "right" },
        { header: "P/L", value: (a) => money(a.profit), align: "right" },
        { header: "MARGIN", value: (a) => money(a.margin), align: "right" },
        { header: "FREE", value: (a) => money(a.freeMargin), align: "right" },
        {
          header: "LEVEL",
          value: (a) => (a.marginLevel === null ? "" : a.marginLevel + "%"),
          align: "right",
        },
        { header: "OPEN", value: (a) => a.openPositions, align: "right" },
        { header: "PENDING", value: (a) => a.pendingOrders, align: "right" },
        {
          header: "TRADING",
          value: (a) => (a.tradingAllowed ? "allowed" : a.tradingReason),
        },
      ]);
    });
  return budget;
}
