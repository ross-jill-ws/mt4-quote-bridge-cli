// The documented shorthand puts the subject before the action, e.g.
//   symbol AUDUSD 1H 30      -> symbol candles AUDUSD 1H 30
//   symbol AUDUSD buy 0.1    -> symbol buy AUDUSD 0.1
//   indicator macd AUDUSD 1H -> indicator show macd AUDUSD 1H
//   hist AUDUSD 1H           -> hist bars AUDUSD 1H
// Rewriting to canonical subcommands gives every action its own --help.

export const SYMBOL_ACTIONS = [
  "list",
  "candles",
  "quote",
  "ask",
  "bid",
  "buy",
  "sell",
  "buy-limit",
  "sell-limit",
  "buy-stop",
  "sell-stop",
] as const;
export const INDICATOR_ACTIONS = ["list", "info", "show"] as const;
export const HIST_ACTIONS = ["list", "bars", "files", "download"] as const;

const option = (s: string | undefined) => s === undefined || s.startsWith("-");
const helpFlag = (s: string | undefined) => s === "-h" || s === "--help";

export function looksLikePeriod(s: string) {
  return /^(\d+|(MN|M|H|D|W)\d+|\d+(MN|M|H|D|W))$/i.test(s);
}

export function rewriteArgs(args: string[]): string[] {
  const [main, first, second, ...rest] = args;
  if (main === "symbol") {
    const known = (s?: string) =>
      s === "help" || (SYMBOL_ACTIONS as readonly string[]).includes(s ?? "");
    if (option(first) || known(first)) return args;
    // first is the symbol name.
    if (known(second) && second !== "help")
      return [main, second!, first!, ...rest];
    if (helpFlag(second)) return [main, "--help"];
    if (second !== undefined && looksLikePeriod(second))
      return [main, "candles", first!, second, ...rest];
    // `symbol AUDUSD` (optionally with flags) shows the quote.
    return [main, "quote", first!, ...args.slice(2)];
  }
  if (main === "indicator") {
    const known = (s?: string) =>
      s === "help" ||
      (INDICATOR_ACTIONS as readonly string[]).includes(s ?? "");
    if (option(first) || known(first)) return args;
    if (helpFlag(second)) return [main, "show", "--help"];
    // `indicator macd` alone describes the indicator and its parameters.
    if (option(second)) return [main, "info", first!, ...args.slice(2)];
    return [main, "show", ...args.slice(1)];
  }
  if (main === "hist") {
    const known = (s?: string) =>
      s === "help" || (HIST_ACTIONS as readonly string[]).includes(s ?? "");
    if (option(first) || known(first)) return args;
    if (helpFlag(second)) return [main, "bars", "--help"];
    return [main, "bars", ...args.slice(1)];
  }
  // `position 12345` shows one ticket; `budget 12345` one account.
  if ((main === "position" || main === "budget") && /^\d+$/.test(first ?? ""))
    return [main, "show", ...args.slice(1)];
  return args;
}
