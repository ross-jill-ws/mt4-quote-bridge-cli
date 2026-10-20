import { Command, InvalidArgumentError, Option } from "commander";

export const FEED_HELP = `
Symbol selection:
  SYMBOL is the broker's symbol name as listed by "symbol list" (case-insensitive).
  If the same symbol is reported by several terminals/brokers, narrow it with
  --broker / --terminal (substring match) or pass the exact --feed identifier.`;

export function feedOptions(cmd: Command) {
  return cmd
    .option("--broker <text>", "only feeds whose broker name contains <text>")
    .option(
      "--terminal <text>",
      "only feeds whose terminal name contains <text>"
    )
    .option(
      "--feed <id>",
      'exact feed identifier from "symbol list --json" (overrides --broker/--terminal)'
    );
}

export function outputOptions(cmd: Command, csv = true) {
  cmd.option("--json", "print the full server response as JSON");
  if (csv) cmd.option("--csv", "print rows as CSV (header row included)");
  return cmd;
}

export function sourceOption(cmd: Command) {
  return cmd.addOption(
    new Option(
      "--source <source>",
      "auto = live EA candles when the period is live, else imported history"
    )
      .choices(["auto", "live", "history"])
      .default("auto")
  );
}

export const feedQuery = (o: {
  broker?: string;
  terminal?: string;
  feed?: string;
}) => ({ broker: o.broker, terminal: o.terminal, feed: o.feed });

export function positiveInt(max: number) {
  return (value: string) => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1 || n > max)
      throw new InvalidArgumentError(`must be an integer 1–${max}`);
    return n;
  };
}

export function positiveNumber(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0)
    throw new InvalidArgumentError("must be a positive number");
  return n;
}

export const PERIOD_HELP = `
Periods:
  M1 M5 M15 M30 H1 H4 D1 W1 MN1. Reversed forms (1H, 15M, 4H, 1D) and plain
  minutes (60) are also accepted. M means minutes; MN means months.`;

export const TIME_HELP = `
Times:
  Bar times are MT4 broker-server time, shown as "YYYY-MM-DD HH:MM" without a
  time zone conversion. JSON output keeps raw epoch seconds ("time").`;
