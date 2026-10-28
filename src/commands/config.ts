import { Command } from "commander";
import { configPath, connection, DEFAULT_SERVER } from "../config.js";
import { emit, fields } from "../output.js";
import { describe, familyGuide } from "./common.js";

/** Local configuration only: what the CLI would use. Sign-in lives under `auth`; nothing here asks the app. */
export function configCommand() {
  const config = familyGuide(
    new Command("config"),
    "show the CLI's local configuration (server, config file, environment overrides)",
    "Nothing here contacts the app: to check the key with the app, use auth status; to change the server or key, use auth server and auth login.",
    `show  which server the CLI talks to, where that setting comes from (MT4QB_SERVER,
      the config file or the default), the config file's path and whether a key
      is saved`,
    ["config show", "config show --json"]
  );
  config.addCommand(
    describe(
      new Command("show"),
      "print the effective server, where it comes from, and whether a key is saved (never the key)",
      "Use it when auth status exits 1 (the app is unreachable): it shows which server URL and config file the CLI is actually using, including environment overrides."
    )
      .option("--json", "print { data, meta } like the other commands")
      .addHelpText(
        "after",
        `
Output:
  Server (and its source), Config file, API key ("saved (…)" with its name and
  scope, or "none: run auth login"). --json: data is { server, serverSource,
  defaultServer, configFile, apiKey, keyName, scope }; apiKey says where the
  key comes from (MT4QB_API_KEY or config file), never the key itself.

Exit codes: 0 always (it reads only the local config; an unreadable file counts as none).`
      )
      .action(async (o) => {
        const { server, token, profile } = await connection();
        const data = {
          server,
          serverSource: process.env.MT4QB_SERVER
            ? "MT4QB_SERVER"
            : profile
              ? "config file"
              : "default",
          defaultServer: DEFAULT_SERVER,
          configFile: configPath(),
          apiKey: token
            ? process.env.MT4QB_API_KEY
              ? "MT4QB_API_KEY"
              : "config file"
            : null,
          keyName: process.env.MT4QB_API_KEY
            ? null
            : (profile?.keyName ?? null),
          scope: process.env.MT4QB_API_KEY ? null : (profile?.scope ?? null),
        };
        emit(o.json, { data, meta: {} }, () =>
          fields([
            ["Server", `${data.server} (${data.serverSource})`],
            ["Config file", data.configFile],
            [
              "API key",
              data.apiKey
                ? `saved (${data.apiKey}${data.keyName ? `, "${data.keyName}", ${data.scope}` : ""})`
                : "none: run auth login",
            ],
          ])
        );
      })
  );
  return config;
}
