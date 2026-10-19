#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import { rewriteArgs } from "./argv.js";
import { API_VERSION, CliError } from "./client.js";
import { configPath } from "./config.js";
import { accountCommand } from "./commands/account.js";
import { authCommand } from "./commands/auth.js";
import { budgetCommand } from "./commands/budget.js";
import { histCommand } from "./commands/hist.js";
import { indicatorCommand } from "./commands/indicator.js";
import { positionsCommand } from "./commands/positions.js";
import { symbolCommand } from "./commands/symbol.js";
import { symbolsCommand } from "./commands/symbols.js";

const { version } = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

export function buildProgram() {
  const program = new Command("mt4-quote-bridge")
    .usage("<command-main> [command-sub] [options]")
    .description(
      "Command-line client for the MT4 Quote Bridge server: symbols, live candles\nand quotes, server-calculated indicators, imported history and demo orders."
    )
    .version(`${version} (REST API v${API_VERSION})`, "-V, --version")
    .showHelpAfterError("(add --help for usage)")
    .addCommand(authCommand())
    .addCommand(symbolsCommand())
    .addCommand(symbolCommand())
    .addCommand(indicatorCommand())
    .addCommand(histCommand())
    .addCommand(positionsCommand())
    .addCommand(budgetCommand())
    .addCommand(accountCommand())
    .addHelpText(
      "after",
      `
Getting started:
  mt4-quote-bridge auth server        # set the server URL (prompts)
  mt4-quote-bridge auth login         # username + password, saves a 7-day token
  mt4-quote-bridge symbols list
  mt4-quote-bridge symbol AUDUSD 1H 30
  mt4-quote-bridge indicator macd AUDUSD 1H 30
  mt4-quote-bridge hist AUDUSD 1H --start 20260901 --end 20261017 --csv
  mt4-quote-bridge positions
  mt4-quote-bridge budget

Every command and subcommand has detailed help:
  mt4-quote-bridge <command> --help        e.g. symbol --help
  mt4-quote-bridge <command> <sub> --help  e.g. symbol buy --help

Output: human-readable tables by default; --json (full server response) and,
for row data, --csv. Errors go to stderr.

Configuration:
  token file     ${configPath()} (MT4QB_CONFIG)
  MT4QB_SERVER   server URL, overrides the saved one
  MT4QB_TOKEN    API token, overrides the saved one

Exit codes: 0 success, 1 error, 3 not signed in / token expired,
4 order not executed (no confirmation), 5 order result unknown.`
    );
  return program;
}

const args = rewriteArgs(process.argv.slice(2));
const json = args.includes("--json");
try {
  await buildProgram().parseAsync(args, { from: "user" });
} catch (e) {
  const error =
    e instanceof CliError
      ? e
      : new CliError(e instanceof Error ? e.message : String(e));
  if (json)
    process.stderr.write(
      JSON.stringify({ error: error.message, details: error.details }) + "\n"
    );
  else {
    process.stderr.write(`error: ${error.message}\n`);
    if (Array.isArray(error.details))
      for (const d of error.details)
        process.stderr.write(
          `  - ${typeof d === "object" ? Object.values(d as object).join("  ") : d}\n`
        );
  }
  process.exitCode = error.exitCode;
}
