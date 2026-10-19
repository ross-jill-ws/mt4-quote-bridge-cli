import { Command } from "commander";
import { ApiClient } from "../client.js";
import { emit, formatOf } from "../output.js";
import { formatTime, parseTime } from "../time.js";
import {
  PERIOD_HELP,
  TIME_HELP,
  outputOptions,
  positiveInt,
} from "./common.js";

type Series = {
  source: string;
  symbol: string;
  period: string;
  timeframe: number;
  bars: number;
  from: number;
  to: number;
};
type Bar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  spread: number;
};
const PAGE = 10000;

export function histCommand() {
  const hist = new Command("hist")
    .usage("<action|SYMBOL> [args...] [options]")
    .description("imported MT4 history (HST) stored on the server")
    .addHelpText(
      "after",
      `
Subcommands / shorthand:
  hist list                                   symbols/periods with imported history
  hist <SYMBOL> <PERIOD> [--start D] [--end D] = hist bars ...

History is what was imported from MT4 .hst files on the dashboard (History
import). It is not live. Import more on the dashboard; the CLI only reads.

Examples:
  mt4-quote-bridge hist list
  mt4-quote-bridge hist AUDUSD 1H --start 20260901 --end 20261017 --csv`
    );

  outputOptions(
    hist
      .command("list")
      .description(
        "show which symbols and periods have history, and the time range"
      )
      .option("--symbol <symbol>", "only this symbol")
  )
    .addHelpText(
      "after",
      `
Columns: SYMBOL, PERIOD, BARS, FROM, TO (first/last bar, broker time), SOURCE
(the imported .hst file; pass it as --history-source when a symbol/period was
imported from several terminals).
${TIME_HELP}

Examples:
  mt4-quote-bridge hist list
  mt4-quote-bridge hist list --symbol XAUUSD --json`
    )
    .action(async (o) => {
      const data = await (
        await ApiClient.fromProfile()
      ).get<{
        series: Series[];
      }>("/api/v1/history");
      const rows = data.series.filter(
        (s) => !o.symbol || s.symbol.toUpperCase() === o.symbol.toUpperCase()
      );
      emit(formatOf(o), { series: rows }, rows, [
        { header: "SYMBOL", value: (s) => s.symbol },
        { header: "PERIOD", value: (s) => s.period },
        { header: "BARS", value: (s) => s.bars, align: "right" },
        { header: "FROM", value: (s) => formatTime(s.from) },
        { header: "TO", value: (s) => formatTime(s.to) },
        { header: "SOURCE", value: (s) => s.source },
      ]);
    });

  outputOptions(
    hist
      .command("bars")
      .usage("<SYMBOL> <PERIOD> [--start DATE] [--end DATE] [options]")
      .description("print imported OHLC bars for a date range")
      .argument("<symbol>", "symbol, e.g. AUDUSD")
      .argument("<period>", "period, e.g. H1, 1H, D1")
      .option(
        "--start <date>",
        'first bar time: YYYYMMDD, YYYY-MM-DD, "YYYY-MM-DD HH:MM" or epoch seconds'
      )
      .option(
        "--end <date>",
        "last bar time (a date alone includes that whole day)"
      )
      .option(
        "--limit <n>",
        "maximum number of bars (default: all in range)",
        positiveInt(10_000_000)
      )
      .option(
        "--history-source <file>",
        'imported .hst file (SOURCE column of "hist list") when ambiguous'
      )
  )
    .addHelpText(
      "after",
      `
Shorthand: mt4-quote-bridge hist <SYMBOL> <PERIOD> [--start D] [--end D]

Prints bars oldest first. Without --start/--end prints the whole imported
range. Large ranges are fetched in pages of ${PAGE} bars automatically.
${PERIOD_HELP}
${TIME_HELP}

Columns: TIME, OPEN, HIGH, LOW, CLOSE, VOLUME (tick volume), SPREAD.
CSV also includes TIMESTAMP (epoch seconds).
JSON: { symbol, period, source, from, to, count, bars:[{time,open,high,low,close,volume,spread}] }

Examples:
  mt4-quote-bridge hist AUDUSD 1H --start 20260901 --end 20261017
  mt4-quote-bridge hist AUDUSD 1H --start 20260901 --end 20261017 --csv > audusd-h1.csv
  mt4-quote-bridge hist bars XAUUSD D1 --start 2026-01-01 --json`
    )
    .action(async (symbol: string, period: string, o) => {
      const client = await ApiClient.fromProfile();
      let from = o.start ? parseTime(o.start) : 0;
      const to = o.end ? parseTime(o.end, true) : 9999999999;
      if (from > to) throw Error("--start must not be after --end");
      const limit: number = o.limit ?? Infinity;
      const bars: Bar[] = [];
      let meta: { symbol: string; period: string; source: string } | undefined;
      for (;;) {
        const page = await client.get<{
          symbol: string;
          period: string;
          source: string;
          truncated: boolean;
          bars: Bar[];
        }>(`/api/v1/history/${encodeURIComponent(symbol)}`, {
          period,
          from,
          to,
          limit: Math.min(PAGE, limit - bars.length),
          source: o.historySource,
        });
        meta ??= page;
        bars.push(...page.bars);
        if (!page.truncated || !page.bars.length || bars.length >= limit) break;
        from = page.bars.at(-1)!.time + 1;
      }
      const format = formatOf(o);
      emit(
        format,
        {
          symbol: meta.symbol,
          period: meta.period,
          source: meta.source,
          from: o.start ? parseTime(o.start) : null,
          to: o.end ? to : null,
          count: bars.length,
          bars,
        },
        bars,
        [
          { header: "TIME", value: (b) => formatTime(b.time) },
          ...(format === "csv"
            ? [{ header: "TIMESTAMP", value: (b: Bar) => b.time }]
            : []),
          { header: "OPEN", value: (b) => b.open, align: "right" },
          { header: "HIGH", value: (b) => b.high, align: "right" },
          { header: "LOW", value: (b) => b.low, align: "right" },
          { header: "CLOSE", value: (b) => b.close, align: "right" },
          { header: "VOLUME", value: (b) => b.volume, align: "right" },
          { header: "SPREAD", value: (b) => b.spread, align: "right" },
        ],
        `${meta.symbol} ${meta.period} · ${bars.length} bars · ${meta.source}`
      );
    });
  return hist;
}
