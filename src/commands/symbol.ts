import { Command } from "commander";
import { ApiClient, CliError, EXIT } from "../client.js";
import { emit, fixed, formatOf, print } from "../output.js";
import { confirm, interactive } from "../prompt.js";
import { formatMillis, formatTime, parseTime } from "../time.js";
import {
  FEED_HELP,
  PERIOD_HELP,
  TIME_HELP,
  feedOptions,
  feedQuery,
  outputOptions,
  positiveInt,
  positiveNumber,
  sourceOption,
} from "./common.js";
import { addSymbolList } from "./symbol-list.js";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  complete?: boolean;
};
type SymbolInfo = {
  symbol: string;
  broker: string;
  bid: number;
  ask: number;
  digits: number;
  tickSize: number;
  tickValue?: number;
  minLot: number;
  maxLot: number;
  lotStep: number;
  stopLevel: number;
  freezeLevel: number;
  tradeAllowed: boolean;
  time: number;
  spec: {
    contractSize: number;
    marginRequired: number;
    swapLong: number;
    swapShort: number;
    swapType: string | number;
    profitCurrency?: string;
    starting: number;
    expiration: number;
  } | null;
};
type Quote = {
  symbol: string;
  broker: string;
  source: string;
  bid: number;
  ask: number;
  spread: number;
  digits: number;
  time: number;
};

const ORDER_TYPES = {
  buy: { label: "Buy", pending: false, help: "market buy at the current Ask" },
  sell: {
    label: "Sell",
    pending: false,
    help: "market sell at the current Bid",
  },
  "buy-limit": {
    label: "Buy Limit",
    pending: true,
    help: "pending buy BELOW the current Ask",
  },
  "sell-limit": {
    label: "Sell Limit",
    pending: true,
    help: "pending sell ABOVE the current Bid",
  },
  "buy-stop": {
    label: "Buy Stop",
    pending: true,
    help: "pending buy ABOVE the current Ask",
  },
  "sell-stop": {
    label: "Sell Stop",
    pending: true,
    help: "pending sell BELOW the current Bid",
  },
} as const;

export function symbolCommand() {
  const symbol = new Command("symbol")
    .usage("list | <SYMBOL> <action> [args...] [options]")
    .description(
      "list symbols; candles, live quotes and demo orders for one symbol"
    )
    .addHelpText(
      "after",
      `
List symbols:
  symbol list [--online]                 symbols with live/history periods

Shorthand (subject first, as documented):
  symbol <SYMBOL> <PERIOD> [COUNT]       last COUNT candles (OHLC)      = symbol candles
  symbol <SYMBOL> [quote]                current bid/ask/spread         = symbol quote
  symbol <SYMBOL> info                   lot limits, contract size, swaps, expiry
  symbol <SYMBOL> ask|bid                just the ask or bid price
  symbol <SYMBOL> buy|sell <LOTS>        market order (demo accounts only)
  symbol <SYMBOL> buy-limit|sell-limit|buy-stop|sell-stop <LOTS> <PRICE>
                                         pending order (demo accounts only)

Each action has detailed help, e.g.:
  mt4-quote-bridge symbol AUDUSD buy --help
  mt4-quote-bridge symbol candles --help

Examples:
  mt4-quote-bridge symbol list
  mt4-quote-bridge symbol AUDUSD 1H 30
  mt4-quote-bridge symbol XAUUSD ask
  mt4-quote-bridge symbol XAUUSD info
  mt4-quote-bridge symbol AUDUSD buy 0.1 --sl 0.6450 --tp 0.6600
  mt4-quote-bridge symbol AUDUSD buy-limit 0.1 0.6480 --sl 0.6430 --tp 0.6580`
    );

  addSymbolList(symbol);

  outputOptions(
    sourceOption(
      feedOptions(
        symbol
          .command("candles")
          .usage("<SYMBOL> <PERIOD> [COUNT] [options]")
          .description("show the last COUNT candles (open/high/low/close)")
          .argument("<symbol>", "symbol, e.g. AUDUSD")
          .argument("<period>", "candle period, e.g. H1, 1H, M15, D1")
          .argument(
            "[count]",
            "number of candles, 1–2000",
            positiveInt(2000),
            30
          )
      )
    )
  )
    .addHelpText(
      "after",
      `
Shorthand: mt4-quote-bridge symbol <SYMBOL> <PERIOD> [COUNT]

Shows the most recent COUNT candles, oldest first. With --source auto (default)
candles come live from an MT4 chart running the QuoteBridge EA when that period
is live (see LIVE in "symbol list"); otherwise from imported HST history.
The last live candle is still forming and is marked "*" (JSON: complete=false).
Live data can take a few seconds on the first request while MT4 sends bars.
${PERIOD_HELP}
${TIME_HELP}
${FEED_HELP}

Columns: TIME, OPEN, HIGH, LOW, CLOSE (VOLUME for history).
JSON: { symbol, broker, period, timeframe, source, status, digits, bars:[{time,open,high,low,close,complete?}] }

Examples:
  mt4-quote-bridge symbol AUDUSD 1H 30
  mt4-quote-bridge symbol candles AUDUSD M15 100 --csv > audusd-m15.csv
  mt4-quote-bridge symbol XAUUSD D1 10 --source history --json`
    )
    .action(async (name: string, period: string, count: number, o) => {
      const data = await (
        await ApiClient.fromProfile()
      ).get<{
        symbol: string;
        broker?: string;
        period: string;
        source: string;
        message: string;
        digits?: number;
        bars: Candle[];
      }>(`/api/v1/symbols/${encodeURIComponent(name)}/candles`, {
        period,
        count,
        source: o.source,
        ...feedQuery(o),
      });
      const f = fixed(data.digits);
      const history = data.source === "history";
      emit(
        formatOf(o),
        data,
        data.bars,
        [
          {
            header: "TIME",
            value: (b) =>
              formatTime(b.time) + (b.complete === false ? " *" : ""),
          },
          { header: "OPEN", value: (b) => f(b.open), align: "right" },
          { header: "HIGH", value: (b) => f(b.high), align: "right" },
          { header: "LOW", value: (b) => f(b.low), align: "right" },
          { header: "CLOSE", value: (b) => f(b.close), align: "right" },
          ...(history
            ? [
                {
                  header: "VOLUME",
                  value: (b: Candle) => b.volume,
                  align: "right" as const,
                },
              ]
            : []),
        ],
        `${data.symbol}${data.broker ? ` (${data.broker})` : ""} ${data.period} · ${data.bars.length} bars · ${data.message}`
      );
    });

  const quoteHelp = `
Reads Bid/Ask fresh from MT4 (MarketInfo) when an account EA is online for the
symbol's terminal; otherwise uses the last recorded quote (recording must be
enabled for the symbol on the dashboard). SOURCE shows which: market|recorded.
${FEED_HELP}`;
  outputOptions(
    feedOptions(
      symbol
        .command("quote")
        .usage("<SYMBOL> [options]")
        .description("show the current bid, ask and spread")
        .argument("<symbol>", "symbol, e.g. AUDUSD")
    ),
    false
  )
    .addHelpText(
      "after",
      `
Shorthand: mt4-quote-bridge symbol <SYMBOL>
${quoteHelp}
JSON: { symbol, broker, source, bid, ask, spread (points), digits, time }

Examples:
  mt4-quote-bridge symbol AUDUSD
  mt4-quote-bridge symbol quote XAUUSD --json`
    )
    .action(async (name: string, o) => {
      const q = await quote(name, o);
      if (o.json) return print(JSON.stringify(q, null, 2));
      const f = fixed(q.digits);
      print(
        `${q.symbol} (${q.broker})  bid ${f(q.bid)}  ask ${f(q.ask)}  spread ${q.spread} pts  [${q.source}${q.time ? ", " + formatTime(q.time) : ""}]`
      );
    });

  outputOptions(
    feedOptions(
      symbol
        .command("info")
        .usage("<SYMBOL> [options]")
        .description(
          "show trading specs: lot limits, contract size, margin, swaps, expiry"
        )
        .argument("<symbol>", "symbol, e.g. XAUUSD")
    ),
    false
  )
    .addHelpText(
      "after",
      `
Shorthand: mt4-quote-bridge symbol <SYMBOL> info

Reads the broker's contract details fresh from MT4 (MarketInfo). Needs the
symbol's terminal online with the QuoteBridge EA; otherwise exit 1.

Fields:
  LOTS        smallest order, step between sizes, largest order
  TICK        smallest price move, and its value for 1.0 lot (deposit currency)
  STOPS       minimum SL/TP distance and freeze distance, in points
  TRADING     whether the broker allows trading the symbol now
  CONTRACT    units per 1.0 lot, and the currency profit is counted in
  MARGIN      free margin needed to open 1.0 lot (deposit currency)
  SWAP        overnight swap for long/short and its unit
  EXPIRY      when the instrument expires (futures-style CFDs); "none" for
              rolling CFDs and FX. Shown with its start time when set.
CONTRACT, MARGIN, SWAP and EXPIRY need QuoteBridge EA 1.07 or later (JSON:
spec = null on older EAs). Times are broker-server time.
${FEED_HELP}
JSON: { symbol, broker, terminal, feed, bid, ask, digits, point, tickSize,
tickValue, minLot, maxLot, lotStep, stopLevel, freezeLevel, tradeAllowed, time,
received, spec: { contractSize, marginRequired, swapLong, swapShort, swapType,
profitCurrency, starting, expiration } | null }
starting/expiration are Unix seconds in broker time; 0 means none.

Examples:
  mt4-quote-bridge symbol XAUUSD info
  mt4-quote-bridge symbol info US500 --json`
    )
    .action(async (name: string, o) => {
      const i = await (
        await ApiClient.fromProfile()
      ).get<SymbolInfo>(
        `/api/v1/symbols/${encodeURIComponent(name)}/info`,
        feedQuery(o)
      );
      if (o.json) return print(JSON.stringify(i, null, 2));
      const f = fixed(i.digits);
      const s = i.spec;
      const lines = [
        `${i.symbol} (${i.broker})  bid ${f(i.bid)}  ask ${f(i.ask)}  [${formatTime(i.time)}]`,
        `Lots          min ${i.minLot} · step ${i.lotStep} · max ${i.maxLot}`,
        `Tick          size ${i.tickSize}${i.tickValue === undefined ? "" : ` · value ${i.tickValue} per lot`}`,
        `Stops         min ${i.stopLevel} pts · freeze ${i.freezeLevel} pts`,
        `Trading       ${i.tradeAllowed ? "allowed" : "disabled by the broker"}`,
      ];
      if (s)
        lines.push(
          `Contract      ${s.contractSize} per lot${s.profitCurrency ? ` · profit in ${s.profitCurrency}` : ""}`,
          `Margin        ${s.marginRequired} per lot`,
          `Swap          long ${s.swapLong} · short ${s.swapShort} (${s.swapType})`,
          `Expiry        ${s.expiration ? formatTime(s.expiration) : "none"}${s.starting ? ` (trading from ${formatTime(s.starting)})` : ""}`
        );
      else
        lines.push(
          "Contract, margin, swap and expiry need QuoteBridge EA 1.07 (recompile it in MetaEditor and re-attach)."
        );
      print(lines.join("\n"));
    });

  for (const side of ["ask", "bid"] as const)
    feedOptions(
      symbol
        .command(side)
        .usage("<SYMBOL> [options]")
        .description(`print only the current ${side} price (script friendly)`)
        .argument("<symbol>", "symbol, e.g. AUDUSD")
    )
      .addHelpText(
        "after",
        `
Shorthand: mt4-quote-bridge symbol <SYMBOL> ${side}

Prints a single number, formatted to the symbol's digits, and nothing else.
${quoteHelp}
Example:
  PRICE=$(mt4-quote-bridge symbol AUDUSD ${side})`
      )
      .action(async (name: string, o) => {
        const q = await quote(name, o);
        print(fixed(q.digits)(q[side]) as string);
      });

  for (const [type, spec] of Object.entries(ORDER_TYPES)) {
    const cmd = symbol
      .command(type)
      .usage(`<SYMBOL> <LOTS>${spec.pending ? " <PRICE>" : ""} [options]`)
      .description(`${spec.label}: ${spec.help} (demo accounts only)`)
      .argument("<symbol>", "symbol, e.g. AUDUSD")
      .argument("<lots>", "order size in lots, e.g. 0.1", positiveNumber);
    if (spec.pending)
      cmd.argument("<price>", "entry (trigger) price", positiveNumber);
    cmd
      .option(
        "--sl <price>",
        "stop-loss as an absolute price (omit = none)",
        positiveNumber
      )
      .option(
        "--tp <price>",
        "take-profit as an absolute price (omit = none)",
        positiveNumber
      );
    if (spec.pending)
      cmd.option(
        "--expiration <time>",
        'pending-order expiry in broker time: YYYYMMDD, "YYYY-MM-DD HH:MM" or epoch seconds'
      );
    cmd
      .option(
        "--account <login>",
        "MT4 account login when several match the symbol"
      )
      .option("-y, --yes", "execute without the interactive confirmation")
      .option(
        "--dry-run",
        "only ask the server to validate/preview; never execute"
      )
      .option(
        "--wait <seconds>",
        "seconds to wait for the MT4 result after dispatch",
        positiveInt(120),
        25
      )
      .option("--json", "print preview and result as JSON");
    feedOptions(cmd).addHelpText(
      "after",
      `
Shorthand: mt4-quote-bridge symbol <SYMBOL> ${type} <LOTS>${spec.pending ? " <PRICE>" : ""} [--sl P] [--tp P]

Flow (same safety checks as the dashboard):
  1. The server previews the order: validates lots against broker min/max/step
     and DEMO_MAX_ORDER_LOTS,${spec.pending ? "\n     checks the entry price is on the correct side of the market and\n     outside the broker stop level," : ""}
     checks SL/TP side and distance, and that the account is a DEMO account
     with demo trading enabled on the server and on exactly one EA.
     The preview is valid for 30 seconds.
  2. You confirm (interactive y/N prompt, or --yes). Without a terminal and
     without --yes the order is NOT sent (exit code 4).
  3. The server dispatches it to MT4 and the CLI waits for the result.
     If the result is "unknown", check MT4 before retrying; never blindly retry.

Prices are absolute prices (not points). ${type.startsWith("buy") ? "For buys SL must be below and TP above the entry/Bid." : "For sells SL must be above and TP below the entry/Ask."}
${FEED_HELP}

Exit codes: 0 order succeeded (or --dry-run preview OK), 1 rejected/error,
4 not executed (declined / no confirmation), 5 result unknown — check MT4.

Examples:
  mt4-quote-bridge symbol AUDUSD ${type} 0.1${spec.pending ? " 0.6480" : ""} --sl 0.6430 --tp 0.6580
  mt4-quote-bridge symbol ${type} AUDUSD 0.05${spec.pending ? " 0.6480" : ""} --dry-run --json
  mt4-quote-bridge symbol AUDUSD ${type} 0.1${spec.pending ? " 0.6480" : ""} --yes`
    );
    cmd.action(async (name: string, lots: number, ...rest: unknown[]) => {
      const price = spec.pending ? (rest[0] as number) : undefined;
      const o = rest[spec.pending ? 1 : 0] as Record<string, any>;
      await placeOrder(type, spec.label, name, lots, price, o);
    });
  }
  return symbol;
}

async function quote(name: string, o: Record<string, string | undefined>) {
  return (await ApiClient.fromProfile()).get<Quote>(
    `/api/v1/symbols/${encodeURIComponent(name)}/quote`,
    feedQuery(o)
  );
}

type Preview = {
  id: string;
  expires: number;
  intent: {
    symbol: string;
    lots: number;
    price: number;
    sl: number;
    tp: number;
    expiration: number;
  };
  account: { login: number; broker: string; demo: boolean; currency: string };
  market: {
    bid: number;
    ask: number;
    digits: number;
    stopLevel: number;
    point: number;
  };
  maxLots: number;
  slippage: number;
};
type TradeResult = {
  id: string;
  status: "dispatching" | "succeeded" | "rejected" | "unknown" | "reviewed";
  result: { ticket?: number; code?: number; message?: string };
};

async function placeOrder(
  type: string,
  label: string,
  name: string,
  lots: number,
  price: number | undefined,
  o: Record<string, any>
) {
  const client = await ApiClient.fromProfile();
  const preview = await client.post<Preview>("/api/v1/orders/preview", {
    symbol: name,
    type,
    lots,
    price,
    sl: o.sl,
    tp: o.tp,
    expiration: o.expiration ? parseTime(o.expiration) : undefined,
    account: o.account,
    ...feedQuery(o),
  });
  const f = fixed(preview.market.digits);
  const i = preview.intent;
  const summary = [
    `${label} ${i.lots} ${i.symbol} @ ${i.price ? f(i.price) : "market"}`,
    `  SL ${i.sl ? f(i.sl) : "none"}  TP ${i.tp ? f(i.tp) : "none"}${i.expiration ? `  expires ${formatTime(i.expiration)}` : ""}`,
    `  market bid ${f(preview.market.bid)} ask ${f(preview.market.ask)} · stop level ${preview.market.stopLevel} pts · slippage ${preview.slippage} pts`,
    `  account ${preview.account.login} (${preview.account.broker}, ${preview.account.demo ? "DEMO" : "LIVE"}, ${preview.account.currency})`,
    `  preview ${preview.id} valid until ${formatMillis(preview.expires)}`,
  ].join("\n");
  if (o.dryRun) {
    if (o.json) print(JSON.stringify({ preview, executed: false }, null, 2));
    else print(summary + "\nDry run: order validated, not sent.");
    return;
  }
  if (!o.yes) {
    if (!interactive()) {
      if (o.json) print(JSON.stringify({ preview, executed: false }, null, 2));
      else print(summary);
      throw new CliError(
        "Order not sent: confirmation required. Re-run with --yes to execute.",
        EXIT.notExecuted
      );
    }
    process.stderr.write(summary + "\n");
    if (!(await confirm("Send this order to MT4?")))
      throw new CliError("Order not sent.", EXIT.notExecuted);
  }
  let record = await client.post<TradeResult>("/api/v1/orders/execute", {
    id: preview.id,
    confirm: true,
  });
  const deadline = Date.now() + (o.wait as number) * 1000;
  while (record.status === "dispatching" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    record = await client.get<TradeResult>(
      `/api/v1/orders/requests/${record.id}`
    );
  }
  if (o.json)
    print(JSON.stringify({ preview, executed: true, result: record }, null, 2));
  else if (record.status === "succeeded")
    print(`${summary}\nOrder succeeded: ticket ${record.result.ticket}.`);
  if (record.status === "succeeded") return;
  const message = record.result.message ?? "";
  if (record.status === "rejected")
    throw new CliError(
      `Order rejected by MT4${record.result.code ? ` (code ${record.result.code})` : ""}: ${message}`
    );
  throw new CliError(
    `Order result ${record.status === "dispatching" ? "not yet confirmed" : "unknown"} (request ${record.id}). ${message || "Check open orders and history in MT4 before retrying."}`,
    5
  );
}
