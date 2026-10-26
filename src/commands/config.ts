import { Command } from "commander";
import { configPath, connection, DEFAULT_SERVER } from "../config.js";
import { emit, fields } from "../output.js";

/** Local configuration only: what the CLI would use. Sign-in lives under `auth`; nothing here asks the app. */
export function configCommand() {
  const config = new Command("config").description(
    "show the CLI's local configuration (server, config file, environment overrides)"
  );
  config.addCommand(
    new Command("show")
      .description(
        "print the effective server, where it comes from, and whether a key is saved (never the key)"
      )
      .option("--json", "print { data, meta } like the other commands")
      .addHelpText(
        "after",
        "\nExit codes: 0 always (it reads only the local config; an unreadable file counts as none)."
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
