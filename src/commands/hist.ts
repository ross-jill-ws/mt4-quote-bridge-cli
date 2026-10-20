import { createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { once } from "node:events";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { Command } from "commander";
import { ApiClient, CliError, EXIT } from "../client.js";
import { emit, formatOf, print } from "../output.js";
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
type HstFile = {
  file: string;
  symbol: string;
  period: string;
  timeframe: number;
  digits: number;
  bars: number;
  from: number | null;
  to: number | null;
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
  hist files                                  MT4 .hst files on the server
  hist download <SYMBOL> <PERIOD>             save a .hst file's bars as CSV

"list" and "bars" read history imported on the dashboard (Import & view).
"files" and "download" read the MT4 .hst files directly: no import needed and
every bar in the file, including older bars MT4 downloaded later.

Examples:
  mt4-quote-bridge hist list
  mt4-quote-bridge hist AUDUSD 1H --start 20260901 --end 20261017 --csv
  mt4-quote-bridge hist download GOLD30 M30 --start 20260101`
    );

  outputOptions(
    hist
      .command("files")
      .description("show the MT4 .hst files on the server and their range")
      .option("--symbol <symbol>", "only this symbol")
      .option("--period <period>", "only this period, e.g. M30, 1H, D1")
  )
    .addHelpText(
      "after",
      `
Columns: SYMBOL, PERIOD, BARS, FROM, TO (first/last bar, broker time), FILE
(pass it as --file to "hist download" when several terminals have the symbol).
To get more bars, raise Max bars in history in MT4 (Tools > Options > Charts)
and scroll the chart back; the file grows as MT4 downloads older bars.
${TIME_HELP}

Examples:
  mt4-quote-bridge hist files
  mt4-quote-bridge hist files --symbol GOLD30 --json`
    )
    .action(async (o) => {
      const data = await (
        await ApiClient.fromProfile()
      ).get<{ files: HstFile[] }>("/api/v1/history/files", {
        symbol: o.symbol,
        period: o.period,
      });
      emit(formatOf(o), data, data.files, [
        { header: "SYMBOL", value: (f) => f.symbol },
        { header: "PERIOD", value: (f) => f.period },
        { header: "BARS", value: (f) => f.bars, align: "right" },
        { header: "FROM", value: (f) => (f.from ? formatTime(f.from) : "") },
        { header: "TO", value: (f) => (f.to ? formatTime(f.to) : "") },
        { header: "FILE", value: (f) => f.file },
      ]);
    });

  hist
    .command("download")
    .usage("<SYMBOL> <PERIOD> [--start DATE] [--end DATE] [-o FILE]")
    .description("save the bars of an MT4 .hst file as CSV")
    .argument("<symbol>", "symbol, e.g. GOLD30")
    .argument("<period>", "period, e.g. M30, 1H, D1")
    .option("--start <date>", "first bar time (default: start of the file)")
    .option(
      "--end <date>",
      "last bar time (a date alone includes that whole day)"
    )
    .option(
      "--file <file>",
      'the .hst file (FILE column of "hist files") when several match'
    )
    .option(
      "-o, --output <path>",
      "where to save; - writes to stdout (default: server's file name, e.g. GOLD30_M30_20260817-20261019.csv)"
    )
    .addHelpText(
      "after",
      `
Reads the .hst file on the server directly, so nothing has to be imported first
and there is no row limit. Columns:
  time,open,high,low,close,tick_volume,spread,real_volume
Times are broker time ("YYYY-MM-DD HH:MM:SS"); prices use the symbol's digits.
${TIME_HELP}

Examples:
  mt4-quote-bridge hist download GOLD30 M30
  mt4-quote-bridge hist download GOLD30 M30 --start 20260901 --end 20261017 -o gold.csv
  mt4-quote-bridge hist download EURUSD H1 -o - | head`
    )
    .action(async (symbol: string, period: string, o) => {
      const client = await ApiClient.fromProfile();
      const from = o.start ? parseTime(o.start) : 0;
      const to = o.end ? parseTime(o.end, true) : 9999999999;
      if (from > to) throw Error("--start must not be after --end");
      const { files } = await client.get<{ files: HstFile[] }>(
        "/api/v1/history/files",
        { symbol, period }
      );
      const matches = o.file ? files.filter((f) => f.file === o.file) : files;
      if (!matches.length)
        throw new CliError(
          o.file
            ? `${o.file} is not a ${period} .hst file for ${symbol}. See "hist files".`
            : `No ${period} .hst file for ${symbol} on the server. See "hist files".`
        );
      if (matches.length > 1)
        throw new CliError(
          `Several .hst files match ${symbol} ${matches[0].period}; pass --file.`,
          EXIT.error,
          matches.map((f) => f.file)
        );
      const response = await client.download("/api/v1/history/files/csv", {
        file: matches[0].file,
        from,
        to,
      });
      const suggested = /filename="([^"]+)"/.exec(
        response.headers.get("content-disposition") ?? ""
      )?.[1];
      const target: string = o.output ?? basename(suggested ?? "history.csv");
      const body = Readable.fromWeb(response.body as WebReadableStream);
      if (target === "-") {
        for await (const chunk of body)
          if (!process.stdout.write(chunk)) await once(process.stdout, "drain");
        return;
      }
      // Write beside the target and rename, so a failed download leaves no partial CSV.
      const partial = target + ".part";
      let lines = 0;
      try {
        await pipeline(
          body,
          async function* (chunks: AsyncIterable<Buffer>) {
            for await (const chunk of chunks) {
              for (const byte of chunk) if (byte === 10) lines++;
              yield chunk;
            }
          },
          createWriteStream(partial)
        );
        await rename(partial, target);
      } catch (e) {
        await rm(partial, { force: true });
        throw e;
      }
      print(
        `Saved ${Math.max(0, lines - 1)} bars to ${target} (${matches[0].file})`
      );
    });

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
