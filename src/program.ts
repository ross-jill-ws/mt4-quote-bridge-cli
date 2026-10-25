import { createRequire } from "node:module";
import { Command, CommanderError } from "commander";
import { API_VERSION, CliError, EXIT } from "./client.js";
import { configPath } from "./config.js";
import { authCommand } from "./commands/auth.js";
import { configCommand } from "./commands/config.js";
import { indicatorsCommand, terminalsCommand } from "./commands/discovery.js";
import { marketsCommand } from "./commands/markets.js";
import {
  accountsCommand,
  ordersCommand,
  positionsCommand,
  requestsCommand,
} from "./commands/trading.js";

const { version } = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

export const EXIT_HELP = `Exit codes:
  0  success                     7  conflict: cross-broker market, preview
  1  other error, unreachable       expired or invalidated, account unresolved,
  2  usage or malformed value       no single ready executor (409)
  3  not signed in / bad key     8  invalid trading or indicator values (422)
  4  forbidden: readonly key,    9  source unavailable or read timeout (503/504)
     trading off, real account  10  request outcome UNKNOWN: never retry
  5  not found (404)            11  request failed (refused by MetaTrader/EA)
  6  ambiguous symbol or login  12  request sent, no definitive result yet
                                13  export file exists (no --force)`;

/** `json`: usage errors are reported once, as the error envelope, instead of commander's text. */
export function buildProgram(json = false) {
  const program = new Command("mt4-quote-bridge")
    .usage("<command> <subcommand> [options]")
    .description(
      "Command-line client for QuoteBridge for MetaTrader (REST API v1): markets, accounts, positions,\npending orders, trading requests, indicators and terminals."
    )
    .version(`${version} (REST API v${API_VERSION})`, "-V, --version")
    .showHelpAfterError("(add --help for usage)")
    .addCommand(marketsCommand())
    .addCommand(accountsCommand())
    .addCommand(positionsCommand())
    .addCommand(ordersCommand())
    .addCommand(requestsCommand())
    .addCommand(indicatorsCommand())
    .addCommand(terminalsCommand())
    .addCommand(authCommand())
    .addCommand(configCommand())
    .addHelpText(
      "after",
      `
Examples:
  mt4-quote-bridge markets quote EURUSD --broker EasyForex-Demo
  mt4-quote-bridge markets candles EURUSD --broker EasyForex-Demo --timeframe H1
  mt4-quote-bridge accounts funds --account <account-id>
  mt4-quote-bridge orders preview --account <account-id> --symbol EURUSD --side buy --type market --lots 0.10
  mt4-quote-bridge positions close <ticket> --account <account-id>
  mt4-quote-bridge requests execute <request-id> --confirm
  mt4-quote-bridge requests show <request-id>

Identities are exact: a market is a broker server and a symbol, an account a
broker server and a login. There is no default account; every preview names
one. Every mutation command only previews; "requests execute --confirm" is the
only command that sends anything, once, and nothing is ever retried.

Output: tables for people; --json prints the REST envelope ({ data, meta })
on stdout. Errors and hints go to stderr; with --json, errors are
{ error: { code, message, details } } on stderr. Prices, lots and money are
decimal strings; times are UTC ISO-8601 with a brokerTime sibling.

Configuration: ${configPath()} (MT4QB_CONFIG); MT4QB_SERVER and MT4QB_API_KEY
override the saved server and key.

${EXIT_HELP}`
    );
  // Usage errors exit 2, not commander's 1, and keep stdout clean.
  const strict = (cmd: Command) => {
    cmd
      .exitOverride()
      .configureOutput({
        writeOut: (s) => process.stdout.write(s),
        writeErr: (s) => void (json || process.stderr.write(s)),
      });
    cmd.commands.forEach(strict);
  };
  strict(program);
  return program;
}

export async function main(args: string[]) {
  const json = args.includes("--json");
  try {
    await buildProgram(json).parseAsync(args, { from: "user" });
  } catch (e) {
    if (e instanceof CommanderError) {
      // Asked-for help and the version are not errors; help shown for a missing subcommand is a usage error.
      if (e.exitCode === 0) return;
      if (e.code === "commander.help") {
        process.exitCode = EXIT.usage;
        return;
      }
      if (json)
        process.stderr.write(
          JSON.stringify(
            new CliError(
              e.message.replace(/^error: /, ""),
              EXIT.usage,
              "usage"
            ).envelope()
          ) + "\n"
        );
      process.exitCode = EXIT.usage;
      return;
    }
    const error =
      e instanceof CliError
        ? e
        : new CliError(e instanceof Error ? e.message : String(e));
    if (json) process.stderr.write(JSON.stringify(error.envelope()) + "\n");
    else {
      process.stderr.write(
        `error: ${error.message}${error.code !== "cli-error" && error.code !== "usage" ? ` (${error.code})` : ""}\n`
      );
      const candidates = (
        error.details as { candidates?: Record<string, unknown>[] } | null
      )?.candidates;
      for (const c of candidates ?? [])
        process.stderr.write(`  - ${Object.values(c).join("  ")}\n`);
    }
    process.exitCode = error.exitCode;
  }
}
