import { Command, InvalidArgumentError } from "commander";
import {
  ApiClient,
  CliError,
  EXIT,
  usage,
  type Envelope,
  type Query,
} from "../client.js";
import { emit, moreHint, type Column, table } from "../output.js";

export const TIMEFRAMES = [
  "M1",
  "M5",
  "M15",
  "M30",
  "H1",
  "H4",
  "D1",
  "W1",
  "MN1",
] as const;

/** A help section: its title, then each line of its body indented two spaces. */
export const section = (title: string, body: string) =>
  `\n${title}:\n${body
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n")}`;

/**
 * A subcommand's one line for its parent's list, and in its own help that line and when to reach for it (`when`
 * stays one paragraph per line: commander wraps it).
 */
export function describe(cmd: Command, summary: string, when: string) {
  return cmd.summary(summary).description(`${summary}\n\n${when}`);
}

/** Command lines, each after the program's name. */
const commandLines = (lines: string[]) =>
  lines.map((line) => `mt4-quote-bridge ${line}`).join("\n");

/**
 * A subcommand's help after its options: what it prints, examples and related commands. The program adds the exit
 * codes after these. Each section is its own help text, so a blank line parts them.
 */
export function guide(
  cmd: Command,
  g: { output?: string; examples: string[]; seeAlso?: string[] }
) {
  if (g.output !== undefined)
    cmd.addHelpText("after", section("Output", g.output));
  cmd.addHelpText("after", section("Examples", commandLines(g.examples)));
  if (g.seeAlso !== undefined)
    cmd.addHelpText("after", section("See also", commandLines(g.seeAlso)));
  return cmd;
}

/**
 * A command family: its one line in the program's list, what it covers, and after its subcommands which one fits
 * which task and that each has its own --help.
 */
export function familyGuide(
  cmd: Command,
  summary: string,
  about: string,
  which: string,
  examples: string[]
) {
  return describe(cmd, summary, about)
    .addHelpText("after", section("Which subcommand", which))
    .addHelpText("after", section("Examples", commandLines(examples)))
    .addHelpText(
      "after",
      section(
        "More help",
        `Every subcommand has its own --help: arguments, options, output, examples
and exit codes. Read it before a subcommand's first use:
  mt4-quote-bridge ${cmd.name()} <subcommand> --help`
      )
    );
}

export function jsonOption(cmd: Command) {
  return cmd.option(
    "--json",
    "print the REST envelope ({ data, meta }) exactly as the server answers it"
  );
}

export function pageOptions(cmd: Command, max = 500) {
  return cmd
    .option("--limit <n>", `items per page (1–${max})`, positiveInt(max))
    .option(
      "--cursor <cursor>",
      "continue after a page: the previous page's meta.nextCursor"
    )
    .option("--all", "follow every cursor and print the whole collection");
}

/** Market selection options; SYMBOL is the positional argument. */
export function marketOptions(cmd: Command) {
  return cmd
    .option(
      "--broker <server>",
      "exact broker server name (needed when several broker servers have SYMBOL)"
    )
    .option(
      "--market-id <id>",
      "the market's exact ID (instead of SYMBOL and --broker)"
    );
}

export const MARKET_HELP = `
Market selection:
  SYMBOL is exact and case-sensitive (EURUSD and eurusd are two markets). If
  more than one broker server has it, add --broker with the exact broker server
  name, or pass --market-id. Ambiguity lists the candidates and exits 6; the CLI
  never guesses or matches substrings.`;

export const TIME_HELP = `
Times:
  --from and --to take UTC: YYYY-MM-DDTHH:MM:SS[.sss]Z, or a date YYYY-MM-DD
  (start of that UTC day for --from, its last second for --to). Output times are
  UTC; brokerTime is the broker server's wall clock.`;

export function positiveInt(max: number) {
  return (value: string) => {
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max)
      throw new InvalidArgumentError(`must be a whole number from 1 to ${max}`);
    return Number(value);
  };
}

/** A decimal as the API takes it: digits with an optional fraction, kept as text. */
export function decimal(value: string) {
  if (!/^\d+(\.\d+)?$/.test(value))
    throw new InvalidArgumentError(
      "must be a decimal number such as 0.10 or 1.08500"
    );
  return value;
}

/** A stop that may be cleared: a value, or `none` (kept as text: commander turns a parser's null into ""). */
export function clearable(parse: (value: string) => string) {
  return (value: string): string => (value === "none" ? value : parse(value));
}

/** A clearable option's value for the API: `none` is null. */
export const cleared = (value: string) => (value === "none" ? null : value);

/** UTC time for --from/--to: ISO with Z, or a whole UTC day. */
export function utcTime(end: boolean) {
  return (value: string) => {
    if (
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value) &&
      !Number.isNaN(Date.parse(value))
    )
      return value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)))
      return `${value}T${end ? "23:59:59" : "00:00:00"}Z`;
    throw new InvalidArgumentError(
      "must be UTC, YYYY-MM-DDTHH:MM:SSZ or YYYY-MM-DD"
    );
  };
}

/** A UTC expiry in whole seconds, or `none`. */
export function utcExpiry(value: string) {
  if (value === "none") return value;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) ||
    Number.isNaN(Date.parse(value))
  )
    throw new InvalidArgumentError(
      "must be UTC whole seconds, YYYY-MM-DDTHH:MM:SSZ, or none"
    );
  return value;
}

/**
 * Lists a cursor-paged collection: one page (with a hint for the next), or with --all the whole of it in one envelope
 * that keeps the last page's other meta, such as an account's currency and state. Answers the envelope's meta.
 */
export async function listCollection<T>(
  client: ApiClient,
  path: string,
  query: Query,
  o: { json?: boolean; all?: boolean; limit?: number; cursor?: string },
  columns: Column<T>[]
) {
  if (o.all) {
    if (o.cursor)
      throw usage("--all starts at the beginning; leave out --cursor.");
    const { data, pages, meta } = await client.all<T>(path, {
      ...query,
      limit: o.limit,
    });
    const { count: _count, limit: _limit, nextCursor: _next, ...rest } = meta;
    const envelope: Envelope<T[]> = {
      data,
      meta: { ...rest, count: data.length, pages, nextCursor: null },
    };
    emit(o.json, envelope, () => table(data, columns));
    return envelope.meta;
  }
  const page = await client.get<T[]>(path, {
    ...query,
    limit: o.limit,
    cursor: o.cursor,
  });
  emit(o.json, page, () => table(page.data, columns));
  if (!o.json) moreHint(page.meta);
  return page.meta;
}

/** An output file that exists and may not be replaced (no --force): exit 13. */
export const outputExists = (file: string) =>
  new CliError(
    `${file} exists. Choose another --output, or add --force to replace it.`,
    EXIT.exists,
    "output-exists",
    { path: file }
  );

/** The client for the saved or environment sign-in. */
export const api = () => ApiClient.fromProfile();
