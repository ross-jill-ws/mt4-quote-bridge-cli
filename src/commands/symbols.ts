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

export function symbolsCommand() {
  const symbols = new Command("symbols")
    .description("list symbols reported by MT4 and their available periods")
    .addHelpText(
      "after",
      `
Subcommands:
  list   (default) every symbol known to the server with live/history periods`
    );
  outputOptions(
    symbols
      .command("list", { isDefault: true })
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
  mt4-quote-bridge symbols list
  mt4-quote-bridge symbols list --online --json`
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
  return symbols;
}
