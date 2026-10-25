import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Command, Option } from "commander";
import { CliError, EXIT, usage, type Query } from "../client.js";
import { emit, fields, note, table } from "../output.js";
import { resolveMarket, type Market, type MarketRef } from "../resolve.js";
import { api, jsonOption, listCollection, MARKET_HELP, marketOptions, pageOptions, positiveInt, TIME_HELP, TIMEFRAMES, utcTime } from "./common.js";

type MarketOptions = { broker?: string; marketId?: string; json?: boolean };
const ref = (symbol: string | undefined, o: MarketOptions): MarketRef => ({ symbol, broker: o.broker, marketId: o.marketId });
const timeframeOption = () => new Option("--timeframe <tf>", "timeframe").choices(TIMEFRAMES).makeOptionMandatory();
const path = (m: Market, rest = "") => `/api/v1/markets/${encodeURIComponent(m.id)}${rest}`;

/** A command taking one market: SYMBOL plus the market selection options. */
function marketCommand(name: string, description: string) {
  return jsonOption(marketOptions(new Command(name).description(description).argument("[symbol]", "exact symbol, e.g. EURUSD"))).addHelpText("after", MARKET_HELP);
}

export function marketsCommand() {
  const markets = new Command("markets").description("markets (broker server + symbol): discovery, quotes, candles, samples, history, exports, indicator values");

  markets.addCommand(
    jsonOption(pageOptions(new Command("list")))
      .description("list known markets (GET /api/v1/markets)")
      .option("--broker <server>", "only this exact broker server")
      .option("--symbol <symbol>", "only this exact symbol")
      .action(async (o) => {
        await listCollection<Market & { recording: boolean }>(await api(), "/api/v1/markets", { brokerServer: o.broker, symbol: o.symbol }, o, [
          { header: "SYMBOL", value: (m) => m.symbol },
          { header: "BROKER SERVER", value: (m) => m.brokerServer },
          { header: "DIGITS", value: (m) => m.digits, align: "right" },
          { header: "CONNECTED", value: (m) => (m.connected ? "yes" : "no") },
          { header: "RECORDING", value: (m) => (m.recording ? "yes" : "no") },
          { header: "MARKET ID", value: (m) => m.id },
        ]);
      })
  );

  markets.addCommand(
    marketCommand("show", "one market's identity and sources (GET /api/v1/markets/{marketId})").action(async (symbol, o) => {
      const client = await api();
      const envelope = await client.get(path(await resolveMarket(client, ref(symbol, o))));
      const m = envelope.data;
      emit(o.json, envelope, () =>
        fields([
          ["Market", m.label],
          ["Market ID", m.id],
          ["Digits", m.digits],
          ["Connected", m.connected],
          ["Recording", m.recording],
          ["Sources", m.sources.map((s: any) => `${s.terminalId}${s.connected ? "" : " (offline)"}`).join(", ") || null],
        ])
      );
    })
  );

  markets.addCommand(
    marketCommand("quote", "the best source's quote, with provenance and freshness (GET …/quote)").action(async (symbol, o) => {
      const client = await api();
      const envelope = await client.get(path(await resolveMarket(client, ref(symbol, o)), "/quote"));
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
    marketCommand("candles", "candles of a timeframe, oldest first (GET …/candles)")
      .addOption(timeframeOption())
      .option("--from <utc>", "first bar start", utcTime(false))
      .option("--to <utc>", "last bar start", utcTime(true))
      .option("--limit <n>", "the newest N bars within from/to (default 900, max 5000)", positiveInt(5000))
      .addHelpText("after", TIME_HELP + "\n  To page back, pass --to with meta.next.to (shown on stderr).")
      .action(async (symbol, o) => {
        const client = await api();
        const envelope = await client.get(path(await resolveMarket(client, ref(symbol, o)), "/candles"), { timeframe: o.timeframe, from: o.from, to: o.to, limit: o.limit });
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
        if (!o.json && envelope.meta.next) note(`Older: add --to ${envelope.meta.next.to}`);
      })
  );

  markets.addCommand(
    pageOptions(marketCommand("samples", "recorded samples, oldest first (GET …/samples)"), 10000)
      .option("--from <utc>", "first sample time (inclusive)", utcTime(false))
      .option("--to <utc>", "last sample time (inclusive)", utcTime(true))
      .addHelpText("after", TIME_HELP + "\n  Only markets recorded in the app's Feeds view have samples.")
      .action(async (symbol, o) => {
        const client = await api();
        const market = await resolveMarket(client, ref(symbol, o));
        await listCollection<any>(client, path(market, "/samples"), { from: o.from, to: o.to }, o, [
          { header: "TIME (UTC)", value: (s) => s.time },
          { header: "BROKER TIME", value: (s) => s.brokerTime },
          { header: "BID", value: (s) => s.bid, align: "right" },
          { header: "ASK", value: (s) => s.ask, align: "right" },
        ]);
      })
  );

  markets.addCommand(
    marketCommand("history", "closed-bar coverage per timeframe (GET …/history)").action(async (symbol, o) => {
      const client = await api();
      const envelope = await client.get(path(await resolveMarket(client, ref(symbol, o)), "/history"));
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
    marketCommand("export", "save closed bars to a CSV or HST file (GET …/export)")
      .addOption(timeframeOption())
      .addOption(new Option("--format <format>", "csv (broker time + UTC column) or hst (MetaTrader v401)").choices(["csv", "hst"]).makeOptionMandatory())
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
      )
      .action(async (symbol, o) => {
        const client = await api();
        const market = await resolveMarket(client, ref(symbol, o));
        const response = await client.download(path(market, "/export"), { timeframe: o.timeframe, format: o.format, from: o.from, to: o.to });
        const file = resolvePath(o.output);
        let out;
        try {
          out = createWriteStream(file, { flags: o.force ? "w" : "wx" });
          await new Promise<void>((ok, fail) => out!.once("open", () => ok()).once("error", fail));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new CliError(`${file} exists. Choose another --output, or add --force to replace it.`, EXIT.exists, "output-exists", { path: file });
          throw new CliError(`Cannot write ${file}: ${(e as Error).message}`);
        }
        try {
          await pipeline(Readable.fromWeb(response.body as any), out);
        } catch (e) {
          await rm(file, { force: true });
          throw new CliError(`The export was interrupted; ${file} was removed. ${(e as Error).message}`);
        }
        const bytes = out.bytesWritten;
        const envelope = {
          data: { path: file, bytes, contentType: response.headers.get("content-type"), marketId: market.id, brokerServer: market.brokerServer, symbol: market.symbol, timeframe: o.timeframe, format: o.format, from: o.from ?? null, to: o.to ?? null },
          meta: {},
        };
        emit(o.json, envelope, () => `Saved ${market.symbol} ${o.timeframe} (${market.brokerServer}) to ${file}: ${bytes} bytes.`);
      })
  );

  markets.addCommand(
    jsonOption(marketOptions(new Command("indicator")))
      .description("an indicator's values over the same bars as candles (GET …/indicators/{packageId})")
      .argument("<packageId>", "exact package ID, e.g. quotebridge.macd (see: indicators list)")
      .argument("[symbol]", "exact symbol")
      .addOption(timeframeOption())
      .option("--param <id=value>", "an indicator parameter, repeatable (defaults for the rest)", (v: string, all: string[] = []) => [...all, v])
      .option("--from <utc>", "first bar start", utcTime(false))
      .option("--to <utc>", "last bar start", utcTime(true))
      .option("--limit <n>", "the newest N bars within from/to (default 900, max 5000)", positiveInt(5000))
      .addHelpText("after", MARKET_HELP + TIME_HELP + "\n  Values are exact doubles; round to the market's digits for display.")
      .action(async (packageId: string, symbol: string | undefined, o) => {
        const client = await api();
        const market = await resolveMarket(client, ref(symbol, o));
        const query: Query = { timeframe: o.timeframe, from: o.from, to: o.to, limit: o.limit };
        for (const p of (o.param as string[] | undefined) ?? []) {
          const at = p.indexOf("=");
          if (at < 1) throw usage(`--param takes id=value, got "${p}".`);
          query[`p.${p.slice(0, at)}`] = p.slice(at + 1);
        }
        const envelope = await client.get(path(market, `/indicators/${encodeURIComponent(packageId)}`), query);
        const outputs: { id: string; label: string }[] = envelope.meta.outputs;
        emit(o.json, envelope, () =>
          table(envelope.data, [
            { header: "TIME (UTC)", value: (r: any) => r.time },
            ...outputs.map((out) => ({ header: out.label.toUpperCase(), value: (r: any) => r.values[out.id], align: "right" as const })),
            { header: "", value: (r: any) => (r.complete ? "" : "forming") },
          ])
        );
        if (!o.json && envelope.meta.next) note(`Older: add --to ${envelope.meta.next.to}`);
      })
  );
  return markets;
}
