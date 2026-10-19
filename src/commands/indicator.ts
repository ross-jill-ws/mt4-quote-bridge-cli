import { Command, InvalidArgumentError } from "commander";
import { ApiClient } from "../client.js";
import { emit, formatOf, print } from "../output.js";
import { formatTime } from "../time.js";
import {
  FEED_HELP,
  PERIOD_HELP,
  TIME_HELP,
  feedOptions,
  feedQuery,
  outputOptions,
  positiveInt,
  sourceOption,
} from "./common.js";

type Indicator = {
  name: string;
  id: string;
  version: string;
  title: string;
  description: string;
  placement: string;
  parameters: {
    id: string;
    label: string;
    type: string;
    default: number;
    min: number;
    max: number;
    lessThan?: string;
  }[];
  outputs: { id: string; label: string; render: string; styles?: string[] }[];
};

function collectParam(value: string, previous: Record<string, string> = {}) {
  for (const pair of value.split(",")) {
    const m = /^([a-zA-Z][a-zA-Z0-9_]*)=(-?\d+(?:\.\d+)?)$/.exec(pair.trim());
    if (!m)
      throw new InvalidArgumentError(
        `expected name=value (e.g. fast=12), got "${pair}"`
      );
    previous[m[1]] = m[2];
  }
  return previous;
}

export function indicatorCommand() {
  const indicator = new Command("indicator")
    .usage("<action|NAME> [args...] [options]")
    .description("list indicators and get server-calculated indicator values")
    .addHelpText(
      "after",
      `
Subcommands / shorthand:
  indicator list                               all enabled indicators
  indicator <NAME>                             = indicator info <NAME>
  indicator <NAME> <SYMBOL> <PERIOD> [COUNT]   = indicator show ...

Indicators are always calculated on the server, over the same candles
the dashboard uses (live EA candles or imported history). The CLI only
prints the values.

Examples:
  mt4-quote-bridge indicator list
  mt4-quote-bridge indicator macd
  mt4-quote-bridge indicator macd AUDUSD 1H 30
  mt4-quote-bridge indicator bollinger XAUUSD M15 20 -p period=20,deviations=2`
    );

  outputOptions(
    indicator
      .command("list")
      .description("list all enabled indicators and their parameters"),
    false
  )
    .addHelpText(
      "after",
      `
Columns: NAME (use in "indicator <NAME> ..."), TITLE, PARAMETERS (id=default
and min..max), OUTPUTS (value columns of "indicator show").
JSON: { indicators:[{ name, id, version, title, description, placement,
parameters:[{id,label,type,default,min,max,lessThan?}], outputs:[{id,label,render,styles?}] }] }

Examples:
  mt4-quote-bridge indicator list
  mt4-quote-bridge indicator list --json`
    )
    .action(async (o) => {
      const data = await (
        await ApiClient.fromProfile()
      ).get<{
        indicators: Indicator[];
      }>("/api/v1/indicators");
      emit(formatOf(o), data, data.indicators, [
        { header: "NAME", value: (i) => i.name },
        { header: "TITLE", value: (i) => i.title },
        {
          header: "PARAMETERS",
          value: (i) =>
            i.parameters.map((p) => `${p.id}=${p.default}`).join(" ") || "-",
        },
        {
          header: "OUTPUTS",
          value: (i) => i.outputs.map((x) => x.id).join(" "),
        },
      ]);
    });

  outputOptions(
    indicator
      .command("info")
      .usage("<NAME> [options]")
      .description("describe one indicator: parameters, ranges and outputs")
      .argument("<name>", 'indicator name from "indicator list", e.g. macd'),
    false
  )
    .addHelpText(
      "after",
      `
Shorthand: mt4-quote-bridge indicator <NAME>

Shows each parameter's default and allowed range (pass overrides to
"indicator show" with -p id=value) and the output columns.

Example:
  mt4-quote-bridge indicator macd`
    )
    .action(async (name: string, o) => {
      const i = await (
        await ApiClient.fromProfile()
      ).get<Indicator>(`/api/v1/indicators/${encodeURIComponent(name)}`);
      if (o.json) return print(JSON.stringify(i, null, 2));
      print(`${i.title} (${i.name}, ${i.id} v${i.version}, ${i.placement})`);
      print(i.description + "\n");
      print("Parameters (override with -p id=value):");
      for (const p of i.parameters)
        print(
          `  ${p.id.padEnd(12)} ${p.type.padEnd(8)} default ${p.default}  range ${p.min}..${p.max}${p.lessThan ? `  must be < ${p.lessThan}` : ""}`
        );
      if (!i.parameters.length) print("  (none)");
      print("Outputs:");
      for (const out of i.outputs)
        print(
          `  ${out.id.padEnd(12)} ${out.label} (${out.render})${out.styles ? `  + ${out.id}_style: ${out.styles.join("|")}` : ""}`
        );
    });

  outputOptions(
    sourceOption(
      feedOptions(
        indicator
          .command("show")
          .usage("<NAME> <SYMBOL> <PERIOD> [COUNT] [options]")
          .description(
            "show the last COUNT indicator values for a symbol/period"
          )
          .argument("<name>", 'indicator name from "indicator list", e.g. macd')
          .argument("<symbol>", "symbol, e.g. AUDUSD")
          .argument("<period>", "candle period, e.g. H1, 1H, M15")
          .argument(
            "[count]",
            "number of values, 1–2000",
            positiveInt(2000),
            30
          )
          .option(
            "-p, --param <id=value,...>",
            "override a parameter (repeatable or comma-separated), e.g. -p fast=8,slow=21",
            collectParam
          )
      )
    )
  )
    .addHelpText(
      "after",
      `
Shorthand: mt4-quote-bridge indicator <NAME> <SYMBOL> <PERIOD> [COUNT]

The server calculates the indicator over all available candles (up to 2000)
for warm-up, then returns the last COUNT values, oldest first. Unset
parameters use the defaults shown by "indicator <NAME>". Values may be blank
(null) during warm-up. "*" marks the still-forming live candle.
Output columns depend on the indicator (e.g. macd: MACD, SIGNAL, MACD_STYLE
rising|falling). CLOSE is the candle close the value belongs to.
${PERIOD_HELP}
${TIME_HELP}
${FEED_HELP}

JSON: { indicator, parameters, period, symbol, source, barsUsed,
outputs:[{id,label}], values:[{ time, close, <output>..., <output>_style? }] }

Examples:
  mt4-quote-bridge indicator macd AUDUSD 1H 30
  mt4-quote-bridge indicator show macd AUDUSD H1 5 -p fast=8 -p slow=21 --json
  mt4-quote-bridge indicator bollinger XAUUSD M15 100 --csv`
    )
    .action(
      async (
        name: string,
        symbol: string,
        period: string,
        count: number,
        o
      ) => {
        const data = await (
          await ApiClient.fromProfile()
        ).get<{
          indicator: string;
          parameters: Record<string, number>;
          period: string;
          symbol: string;
          broker?: string;
          source: string;
          barsUsed: number;
          values: Record<string, unknown>[];
        }>(
          `/api/v1/indicators/${encodeURIComponent(name)}/${encodeURIComponent(symbol)}`,
          {
            period,
            count,
            source: o.source,
            ...feedQuery(o),
            ...Object.fromEntries(
              Object.entries(o.param ?? {}).map(([k, v]) => [
                `p.${k}`,
                v as string,
              ])
            ),
          }
        );
        const keys = Object.keys(data.values[0] ?? {}).filter(
          (k) => !["time", "close", "complete"].includes(k)
        );
        const number = (v: unknown) =>
          typeof v === "number" ? Number(v.toPrecision(10)).toString() : v;
        emit(
          formatOf(o),
          data,
          data.values,
          [
            {
              header: "TIME",
              value: (r) =>
                formatTime(r.time as number) +
                (r.complete === false ? " *" : ""),
            },
            { header: "CLOSE", value: (r) => r.close, align: "right" },
            ...keys.map((k) => ({
              header: k.toUpperCase(),
              value: (r: Record<string, unknown>) => number(r[k]),
              align: "right" as const,
            })),
          ],
          `${data.indicator}(${Object.entries(data.parameters)
            .map(([k, v]) => `${k}=${v}`)
            .join(
              ", "
            )}) ${data.symbol}${data.broker ? ` (${data.broker})` : ""} ${data.period} · ${data.source} · ${data.barsUsed} bars used`
        );
      }
    );
  return indicator;
}
