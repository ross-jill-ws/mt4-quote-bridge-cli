import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Command, Option } from "commander";
import { CliError, EXIT, usage, type Query } from "../client.js";
import { emit, fields, note, table } from "../output.js";
import { resolveMarket, type Market, type MarketRef } from "../resolve.js";
import {
  api,
  describe,
  familyGuide,
  guide,
  jsonOption,
  listCollection,
  MARKET_HELP,
  marketOptions,
  outputExists,
  pageOptions,
  positiveInt,
  TIME_HELP,
  TIMEFRAMES,
  utcTime,
} from "./common.js";

type MarketOptions = { broker?: string; marketId?: string; json?: boolean };
const ref = (symbol: string | undefined, o: MarketOptions): MarketRef => ({
  symbol,
  broker: o.broker,
  marketId: o.marketId,
});
const timeframeOption = () =>
  new Option("--timeframe <tf>", "timeframe")
    .choices(TIMEFRAMES)
    .makeOptionMandatory();
const path = (m: Market, rest = "") =>
  `/api/v1/markets/${encodeURIComponent(m.id)}${rest}`;

/** A command taking one market: SYMBOL plus the market selection options. */
function marketCommand(name: string, summary: string, when: string) {
  return jsonOption(
    marketOptions(
      describe(new Command(name), summary, when).argument(
        "[symbol]",
        "exact symbol, e.g. EURUSD"
      )
    )
  ).addHelpText("after", MARKET_HELP);
}

export function marketsCommand() {
  const markets = familyGuide(
    new Command("markets"),
    "markets (broker server + symbol): discovery, quotes, candles, samples, history, exports, indicator values",
    "A market is one broker server and one exact symbol. Every subcommand only reads, so a readonly key is enough.",
    `list       find a market's exact symbol, broker server and ID (start here)
show       a market's digits, connection, recording and source terminals
quote      the price now: bid, ask, spread, its age and its source
candles    OHLC bars of a timeframe (the newest N), for charts and analysis
samples    every recorded bid/ask, for markets recorded in the Feeds view
history    how many closed bars each timeframe has, from when to when
export     closed bars to a CSV or MetaTrader HST file
indicator  an indicator's values over the same bars as candles

Name a market as SYMBOL (exact, case-sensitive), adding --broker <exact broker
server> when several broker servers have it, or as --market-id <id>.`,
    [
      "markets list --symbol EURUSD",
      "markets quote EURUSD --broker EasyForex-Demo",
      "markets candles EURUSD --broker EasyForex-Demo --timeframe H1 --limit 50",
      "markets export EURUSD --broker EasyForex-Demo --timeframe D1 --format csv --output eurusd-d1.csv",
    ]
  );

  markets.addCommand(
    guide(
      jsonOption(
        pageOptions(
          describe(
            new Command("list"),
            "list known markets (GET /api/v1/markets)",
            "Use it first: it gives the exact symbol, broker server and market ID that every other markets command takes, and shows which markets a terminal streams now and which are recorded. --broker and --symbol filter by exact match; there is no search."
          )
        )
      )
        .option("--broker <server>", "only this exact broker server")
        .option("--symbol <symbol>", "only this exact symbol"),
      {
        output: `Table: SYMBOL, BROKER SERVER, DIGITS, CONNECTED, RECORDING, MARKET ID,
100 markets a page by default; the next page's --cursor goes to stderr.
--json: data is an array of { id, brokerServer, symbol, label, digits,
connected, recording, sources }; meta.nextCursor is null on the last page.`,
        examples: [
          "markets list",
          "markets list --symbol EURUSD",
          "markets list --broker EasyForex-Demo --all --json",
        ],
        seeAlso: ["markets show SYMBOL --broker S"],
      }
    ).action(async (o) => {
      await listCollection<Market & { recording: boolean }>(
        await api(),
        "/api/v1/markets",
        { brokerServer: o.broker, symbol: o.symbol },
        o,
        [
          { header: "SYMBOL", value: (m) => m.symbol },
          { header: "BROKER SERVER", value: (m) => m.brokerServer },
          { header: "DIGITS", value: (m) => m.digits, align: "right" },
          { header: "CONNECTED", value: (m) => (m.connected ? "yes" : "no") },
          { header: "RECORDING", value: (m) => (m.recording ? "yes" : "no") },
          { header: "MARKET ID", value: (m) => m.id },
        ]
      );
    })
  );

  markets.addCommand(
    guide(
      marketCommand(
        "show",
        "one market's identity and sources (GET /api/v1/markets/{marketId})",
        "Use it to see a market's digits, whether a terminal streams it now, whether it is recorded, and which terminals feed it. For the price itself, use markets quote."
      ),
      {
        output: `Market, Market ID, Digits, Connected, Recording, and Sources (terminal IDs,
"(offline)" after a quiet one).
--json: data is { id, brokerServer, symbol, label, digits, connected,
recording, sources: [{ terminalId, feedId, connected }] }.`,
        examples: [
          "markets show EURUSD --broker EasyForex-Demo",
          "markets show --market-id <market-id> --json",
        ],
        seeAlso: ["terminals show <terminal-id>"],
      }
    ).action(async (symbol, o) => {
      const client = await api();
      const envelope = await client.get(
        path(await resolveMarket(client, ref(symbol, o)))
      );
      const m = envelope.data;
      emit(o.json, envelope, () =>
        fields([
          ["Market", m.label],
          ["Market ID", m.id],
          ["Digits", m.digits],
          ["Connected", m.connected],
          ["Recording", m.recording],
          [
            "Sources",
            m.sources
              .map(
                (s: any) => `${s.terminalId}${s.connected ? "" : " (offline)"}`
              )
              .join(", ") || null,
          ],
        ])
      );
    })
  );

  markets.addCommand(
    guide(
      marketCommand(
        "quote",
        "the best source's quote, with provenance and freshness (GET …/quote)",
        "Use it for the price now. The app picks the source itself: the connected terminal with the newest broker quote. Read State and Quote age before trusting the price: an offline market answers its last-known quote, or its last recorded sample."
      ),
      {
        output: `Market, Bid, Ask, Spread (points), Time (UTC), Broker time, State
(connected, last-known or recorded; ", stale" when offline, silent or
unchanged for ten seconds), Quote age and Source (terminal ID).
--json: data is { marketId, brokerServer, symbol, digits, bid, ask, spread,
time, brokerTime, state, stale, quoteAgeMs, sourceSilenceMs, sourceSilent,
provenance: { terminalId, feedId, receivedAt } }.
No feed and nothing recorded: exit 9 (quote-unavailable).`,
        examples: [
          "markets quote EURUSD --broker EasyForex-Demo",
          "markets quote --market-id <market-id> --json",
        ],
        seeAlso: [
          "accounts conditions SYMBOL --account A   (one account's bid/ask and contract)",
        ],
      }
    ).action(async (symbol, o) => {
      const client = await api();
      const envelope = await client.get(
        path(await resolveMarket(client, ref(symbol, o)), "/quote")
      );
      const q = envelope.data;
      emit(o.json, envelope, () =>
        fields([
          ["Market", `${q.symbol} · ${q.brokerServer}`],
          ["Bid", q.bid],
          ["Ask", q.ask],
          ["Spread (points)", q.spread],
          ["Time (UTC)", q.time],
          ["Broker time", q.brokerTime],
          ["State", `${q.state}${q.stale ? ", stale" : ""}`],
          ["Quote age", q.quoteAgeMs === null ? null : `${q.quoteAgeMs} ms`],
          ["Source", q.provenance?.terminalId ?? null],
        ])
      );
    })
  );

  markets.addCommand(
    guide(
      marketCommand(
        "candles",
        "candles of a timeframe, oldest first (GET …/candles)",
        "Use it for OHLC bars, the same ones the app's Charts view draws: the newest --limit bars that start between --from and --to, oldest first. The newest bar may still be forming. For a file, use markets export; for every recorded tick, markets samples."
      )
        .addOption(timeframeOption())
        .option("--from <utc>", "first bar start", utcTime(false))
        .option("--to <utc>", "last bar start", utcTime(true))
        .option(
          "--limit <n>",
          "the newest N bars within from/to (default 900, max 5000)",
          positiveInt(5000)
        )
        .addHelpText(
          "after",
          TIME_HELP +
            "\n  To page back, pass --to with meta.next.to (shown on stderr)."
        ),
      {
        output: `Table: TIME (UTC), BROKER TIME, OPEN, HIGH, LOW, CLOSE, and "forming" on
the bar still open; "Older: add --to …" on stderr pages back.
--json: data is an array of { time, brokerTime, open, high, low, close,
complete }; meta has marketId, timeframe, digits, source, count, limit and
next.to (null once --from or the oldest bar is reached).`,
        examples: [
          "markets candles EURUSD --broker EasyForex-Demo --timeframe H1",
          "markets candles EURUSD --broker EasyForex-Demo --timeframe M5 --limit 12",
          "markets candles EURUSD --broker EasyForex-Demo --timeframe D1 --from 2027-01-01 --to 2027-01-31 --json",
        ],
        seeAlso: [
          "markets history SYMBOL   (how far back each timeframe goes)",
          "markets indicator PACKAGE SYMBOL --timeframe TF",
        ],
      }
    ).action(async (symbol, o) => {
      const client = await api();
      const envelope = await client.get(
        path(await resolveMarket(client, ref(symbol, o)), "/candles"),
        { timeframe: o.timeframe, from: o.from, to: o.to, limit: o.limit }
      );
      emit(o.json, envelope, () =>
        table(envelope.data, [
          { header: "TIME (UTC)", value: (c: any) => c.time },
          { header: "BROKER TIME", value: (c: any) => c.brokerTime },
          { header: "OPEN", value: (c: any) => c.open, align: "right" },
          { header: "HIGH", value: (c: any) => c.high, align: "right" },
          { header: "LOW", value: (c: any) => c.low, align: "right" },
          { header: "CLOSE", value: (c: any) => c.close, align: "right" },
          { header: "", value: (c: any) => (c.complete ? "" : "forming") },
        ])
      );
      if (!o.json && envelope.meta.next)
        note(`Older: add --to ${envelope.meta.next.to}`);
    })
  );

  markets.addCommand(
    guide(
      pageOptions(
        marketCommand(
          "samples",
          "recorded samples, oldest first (GET …/samples)",
          "Use it for every bid/ask the app recorded, tick by tick: spreads over time, backtests on raw prices. Only markets with recording switched on in the app's Feeds view have samples; markets list shows RECORDING."
        ),
        10000
      )
        .option("--from <utc>", "first sample time (inclusive)", utcTime(false))
        .option("--to <utc>", "last sample time (inclusive)", utcTime(true))
        .addHelpText(
          "after",
          TIME_HELP +
            "\n  Only markets recorded in the app's Feeds view have samples."
        ),
      {
        output: `Table: TIME (UTC), BROKER TIME, BID, ASK; 1,000 samples a page by default
(--limit up to 10,000), the next page's --cursor on stderr. Send a cursor
with the same --from and --to it came from.
--json: data is an array of { time, brokerTime, bid, ask, receivedAt };
meta has marketId, digits, count, limit and nextCursor.`,
        examples: [
          "markets samples EURUSD --broker EasyForex-Demo --limit 20",
          "markets samples EURUSD --broker EasyForex-Demo --from 2027-01-15T08:00:00Z --to 2027-01-15T08:05:00Z --all --json",
        ],
      }
    ).action(async (symbol, o) => {
      const client = await api();
      const market = await resolveMarket(client, ref(symbol, o));
      await listCollection<any>(
        client,
        path(market, "/samples"),
        { from: o.from, to: o.to },
        o,
        [
          { header: "TIME (UTC)", value: (s) => s.time },
          { header: "BROKER TIME", value: (s) => s.brokerTime },
          { header: "BID", value: (s) => s.bid, align: "right" },
          { header: "ASK", value: (s) => s.ask, align: "right" },
        ]
      );
    })
  );

  markets.addCommand(
    guide(
      marketCommand(
        "history",
        "closed-bar coverage per timeframe (GET …/history)",
        "Use it before candles or export to learn how much history exists: each timeframe's closed-bar count and first and last bar, from MetaTrader's HST file joined with the app's saved history. It answers with no terminal running once history is saved."
      ),
      {
        output: `Table: TIMEFRAME, BARS, FROM (UTC), TO (UTC).
--json: data is { marketId, digits, timeframes: [{ timeframe, bars, from,
fromBrokerTime, to, toBrokerTime }] }.`,
        examples: [
          "markets history EURUSD --broker EasyForex-Demo",
          "markets history --market-id <market-id> --json",
        ],
        seeAlso: [
          "markets export SYMBOL --timeframe TF --format csv --output FILE",
        ],
      }
    ).action(async (symbol, o) => {
      const client = await api();
      const envelope = await client.get(
        path(await resolveMarket(client, ref(symbol, o)), "/history")
      );
      emit(o.json, envelope, () =>
        table(envelope.data.timeframes, [
          { header: "TIMEFRAME", value: (t: any) => t.timeframe },
          { header: "BARS", value: (t: any) => t.bars, align: "right" },
          { header: "FROM (UTC)", value: (t: any) => t.from },
          { header: "TO (UTC)", value: (t: any) => t.to },
        ])
      );
    })
  );

  markets.addCommand(
    guide(
      marketCommand(
        "export",
        "save closed bars to a CSV or HST file (GET …/export)",
        "Use it for a file of closed bars, the same file the app's History page downloads: csv for spreadsheets and scripts (broker time plus a UTC column), hst to load into MetaTrader (v401, broker time). The whole range is streamed, with no row limit; for bars in the terminal, use markets candles."
      )
        .addOption(timeframeOption())
        .addOption(
          new Option(
            "--format <format>",
            "csv (broker time + UTC column) or hst (MetaTrader v401)"
          )
            .choices(["csv", "hst"])
            .makeOptionMandatory()
        )
        .requiredOption("--output <file>", "the file to write")
        .option("--force", "replace the output file if it exists")
        .option("--from <utc>", "first bar start", utcTime(false))
        .option("--to <utc>", "last bar start", utcTime(true))
        .addHelpText(
          "after",
          TIME_HELP +
            `
  The file is never overwritten silently: an existing --output exits 13 unless
  --force is given. With --json, stdout gets { data: { path, bytes, ... } },
  never the file's bytes. The forming bar is never included.`
        ),
      {
        output: `"Saved EURUSD H1 (EasyForex-Demo) to <path>: <bytes> bytes."
--json: data is { path, bytes, contentType, marketId, brokerServer, symbol,
timeframe, format, from, to }. An interrupted or refused export leaves no
file. CSV columns: time,open,high,low,close,tick_volume,spread,real_volume,
time_utc.`,
        examples: [
          "markets export EURUSD --broker EasyForex-Demo --timeframe H1 --format csv --output eurusd-h1.csv",
          "markets export EURUSD --broker EasyForex-Demo --timeframe M1 --format hst --output EURUSD1.hst --from 2027-01-01",
          "markets export EURUSD --broker EasyForex-Demo --timeframe D1 --format csv --output eurusd-d1.csv --force --json",
        ],
        seeAlso: ["markets history SYMBOL   (what range there is to export)"],
      }
    ).action(async (symbol, o) => {
      const client = await api();
      const market = await resolveMarket(client, ref(symbol, o));
      const response = await client.download(path(market, "/export"), {
        timeframe: o.timeframe,
        format: o.format,
        from: o.from,
        to: o.to,
      });
      const file = resolvePath(o.output);
      let out;
      try {
        out = createWriteStream(file, { flags: o.force ? "w" : "wx" });
        await new Promise<void>((ok, fail) =>
          out!.once("open", () => ok()).once("error", fail)
        );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST")
          throw outputExists(file);
        throw new CliError(`Cannot write ${file}: ${(e as Error).message}`);
      }
      try {
        await pipeline(Readable.fromWeb(response.body as any), out);
      } catch (e) {
        await rm(file, { force: true });
        throw new CliError(
          `The export was interrupted; ${file} was removed. ${(e as Error).message}`
        );
      }
      const bytes = out.bytesWritten;
      const envelope = {
        data: {
          path: file,
          bytes,
          contentType: response.headers.get("content-type"),
          marketId: market.id,
          brokerServer: market.brokerServer,
          symbol: market.symbol,
          timeframe: o.timeframe,
          format: o.format,
          from: o.from ?? null,
          to: o.to ?? null,
        },
        meta: {},
      };
      emit(
        o.json,
        envelope,
        () =>
          `Saved ${market.symbol} ${o.timeframe} (${market.brokerServer}) to ${file}: ${bytes} bytes.`
      );
    })
  );

  markets.addCommand(
    guide(
      jsonOption(
        marketOptions(
          describe(
            new Command("indicator"),
            "an indicator's values over the same bars as candles (GET …/indicators/{packageId})",
            "Use it for indicator values (moving averages, MACD, RSI…) exactly as the app's charts show them, bar for bar with markets candles. Find the package ID with indicators list and its parameters with indicators show; a parameter left out takes its default. Needs a terminal's chart of the market."
          )
        )
      )
        .argument(
          "<packageId>",
          "exact package ID, e.g. quotebridge.macd (see: indicators list)"
        )
        .argument("[symbol]", "exact symbol")
        .addOption(timeframeOption())
        .option(
          "--param <id=value>",
          "an indicator parameter, repeatable (defaults for the rest)",
          (v: string, all: string[] = []) => [...all, v]
        )
        .option("--from <utc>", "first bar start", utcTime(false))
        .option("--to <utc>", "last bar start", utcTime(true))
        .option(
          "--limit <n>",
          "the newest N bars within from/to (default 900, max 5000)",
          positiveInt(5000)
        )
        .addHelpText("after", MARKET_HELP)
        .addHelpText(
          "after",
          TIME_HELP +
            "\n  Values are exact doubles; round to the market's digits for display."
        ),
      {
        output: `Table: TIME (UTC), one column per output (MA, SIGNAL…), and "forming" on
the bar still open; empty where the indicator has no value (warm-up).
"Older: add --to …" on stderr pages back.
--json: data is an array of { time, brokerTime, complete, values: { <output
id>: "<decimal>" | null } }; meta has indicatorId, version, parameters,
outputs, timeframe, source, count, limit, barsUsed and next.to.
A bad parameter exits 2; a failed calculation exits 8 (indicator-failed,
reason on the next line); no chart of the market exits 9 (feed-required).`,
        examples: [
          "markets indicator quotebridge.ma EURUSD --broker EasyForex-Demo --timeframe H1",
          "markets indicator quotebridge.ma EURUSD --broker EasyForex-Demo --timeframe H1 --param period=50 --param type=exponential",
          "markets indicator quotebridge.macd --market-id <market-id> --timeframe D1 --limit 30 --json",
        ],
        seeAlso: [
          "indicators list",
          "indicators show PACKAGE   (its parameters and outputs)",
        ],
      }
    ).action(async (packageId: string, symbol: string | undefined, o) => {
      const client = await api();
      const market = await resolveMarket(client, ref(symbol, o));
      const query: Query = {
        timeframe: o.timeframe,
        from: o.from,
        to: o.to,
        limit: o.limit,
      };
      for (const p of (o.param as string[] | undefined) ?? []) {
        const at = p.indexOf("=");
        if (at < 1) throw usage(`--param takes id=value, got "${p}".`);
        query[`p.${p.slice(0, at)}`] = p.slice(at + 1);
      }
      const envelope = await client.get(
        path(market, `/indicators/${encodeURIComponent(packageId)}`),
        query
      );
      const outputs: { id: string; label: string }[] = envelope.meta.outputs;
      emit(o.json, envelope, () =>
        table(envelope.data, [
          { header: "TIME (UTC)", value: (r: any) => r.time },
          ...outputs.map((out) => ({
            header: out.label.toUpperCase(),
            value: (r: any) => r.values[out.id],
            align: "right" as const,
          })),
          { header: "", value: (r: any) => (r.complete ? "" : "forming") },
        ])
      );
      if (!o.json && envelope.meta.next)
        note(`Older: add --to ${envelope.meta.next.to}`);
    })
  );
  return markets;
}
