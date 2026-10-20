import { Command } from "commander";
import { ApiClient } from "../client.js";
import { emit, fixed, formatOf } from "../output.js";
import { outputOptions } from "./common.js";

type SymbolRow = {
  symbol: string;
  broker: string;
  terminal: string;
  feed: string;
  online: boolean;
  recording: boolean;
  digits: number;
  bid?: number;
  ask?: number;
  livePeriods: string[];
  historyPeriods: string[];
};

/** Adds `symbol list` to the `symbol` command. */
export function addSymbolList(symbol: Command) {
  outputOptions(
    symbol
      .command("list")
      .description("list symbols with their live and imported-history periods")
      .option("--online", "only symbols with a connected EA")
  )
    .addHelpText(
      "after",
      `
Columns:
  SYMBOL    broker symbol name (use it in "symbol", "indicator", "hist")
  BROKER    broker / company reported by the MT4 terminal
  STATUS    online (EA connected) or offline; "+rec" = quotes being recorded
  BID/ASK   last recorded quote (blank when recording is off)
  LIVE      periods with live candles: the chart period of each attached EA,
            plus the next higher period when the EA supports it
  HISTORY   periods with imported HST history (see "hist list")

Live periods depend on which MT4 charts have the QuoteBridge EA attached.
To get live H4 candles, attach the EA to an H4 (or H1) chart of that symbol.

JSON fields per symbol: symbol, broker, terminal, feed, online, recording,
digits, bid, ask, quoteTime, livePeriods[], historyPeriods[].

Examples:
  mt4-quote-bridge symbol list
  mt4-quote-bridge symbol list --online --json`
    )
    .action(async (o) => {
      const data = await (
        await ApiClient.fromProfile()
      ).get<{
        symbols: SymbolRow[];
      }>("/api/v1/symbols");
      const rows = data.symbols
        .filter((s) => !o.online || s.online)
        .sort((a, b) => a.symbol.localeCompare(b.symbol));
      emit(formatOf(o), { symbols: rows }, rows, [
        { header: "SYMBOL", value: (r) => r.symbol },
        { header: "BROKER", value: (r) => r.broker },
        {
          header: "STATUS",
          value: (r) =>
            (r.online ? "online" : "offline") + (r.recording ? "+rec" : ""),
        },
        { header: "BID", value: (r) => fixed(r.digits)(r.bid), align: "right" },
        { header: "ASK", value: (r) => fixed(r.digits)(r.ask), align: "right" },
        { header: "LIVE", value: (r) => r.livePeriods.join(",") || "-" },
        { header: "HISTORY", value: (r) => r.historyPeriods.join(",") || "-" },
      ]);
    });
}
