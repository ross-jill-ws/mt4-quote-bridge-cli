import { Command } from "commander";
import { ApiClient, CliError, EXIT } from "../client.js";
import {
  clearToken,
  configPath,
  connection,
  DEFAULT_SERVER,
  loadProfile,
  normalizeServer,
  saveProfile,
  saveServer,
} from "../config.js";
import { print } from "../output.js";
import { ask, askHidden, interactive, readStdin } from "../prompt.js";
import { formatMillis } from "../time.js";

export function authCommand() {
  const auth = new Command("auth")
    .description("sign in to a Quote Bridge server and manage the saved token")
    .addHelpText(
      "after",
      `
Subcommands:
  server   set the Quote Bridge server URL (prompts; default ${DEFAULT_SERVER})
  login    sign in with the dashboard username/password and save a token
  status   show the saved server, user and token expiry (verifies with server)
  logout   revoke the token on the server and delete it locally

Typical first run:
  mt4-quote-bridge auth server     # enter the server URL
  mt4-quote-bridge auth login      # enter username and password

The server URL and token are saved in ${configPath()}
(override with MT4QB_CONFIG). Tokens are valid for 7 days from sign-in and
survive server restarts; run "auth login" again when one expires.
Environment overrides: MT4QB_SERVER (server URL), MT4QB_TOKEN (token).`
    );

  auth
    .command("server")
    .usage("[URL] [options]")
    .description(
      `set the Quote Bridge server URL (prompts when URL is omitted; default ${DEFAULT_SERVER})`
    )
    .argument("[url]", "server URL, e.g. http://192.168.1.20:3000")
    .option("--no-check", "save without checking that the server is reachable")
    .option("--json", "print the result as JSON")
    .addHelpText(
      "after",
      `
Without URL in a terminal, prompts:
  Server URL [${DEFAULT_SERVER}]:
The default shown is the saved server, or ${DEFAULT_SERVER} when none is saved.
Press Enter to keep it. Without URL and without a terminal (scripts), prints
the current server and changes nothing.

"host:port" is accepted (http:// is assumed). Before saving, the CLI checks
that the URL is a compatible Quote Bridge server (GET /api/v1/info) unless
--no-check is given. If an http:// URL redirects to https:// on the same host
(ngrok and most HTTPS proxies do this), the https:// URL is saved instead.
Other redirects are refused, so the token is never sent to a different host.

Switching to a different server discards the saved token, because tokens are
only valid on the server that issued them. Run "auth login" afterwards.
MT4QB_SERVER, when set, overrides the saved server for every command.

Examples:
  mt4-quote-bridge auth server
  mt4-quote-bridge auth server http://192.168.1.20:3000
  mt4-quote-bridge auth server qb.example.com:3000 --no-check

Exit codes: 0 saved (or printed), 1 invalid URL / server unreachable or incompatible.`
    )
    .action(async (url: string | undefined, o) => {
      const saved = await loadProfile();
      const current = normalizeServer(saved?.server ?? DEFAULT_SERVER);
      if (url === undefined && !interactive()) {
        if (o.json)
          print(JSON.stringify({ server: current, saved: !!saved }, null, 2));
        else print(current);
        return;
      }
      const entered = await chooseServer(url, current);
      const { server, upgraded } = o.check
        ? await ApiClient.verifyServer(entered)
        : { server: entered, upgraded: false };
      const { changed, droppedToken } = await saveServer(server);
      if (o.json)
        print(
          JSON.stringify({ server, upgraded, changed, droppedToken }, null, 2)
        );
      else
        print(
          (upgraded ? `${entered} redirects to HTTPS; using it.\n` : "") +
            `Server set to ${server}${changed ? "" : " (unchanged)"}.` +
            (droppedToken
              ? "\nThe previous server's token was removed. Run: mt4-quote-bridge auth login"
              : saved?.token && !changed
                ? ""
                : "\nNext: mt4-quote-bridge auth login")
        );
    });

  auth
    .command("login")
    .description("sign in and save a 7-day API token to your user profile")
    .option(
      "-s, --server <url>",
      `Quote Bridge server URL (default: saved server, MT4QB_SERVER or ${DEFAULT_SERVER})`
    )
    .option("-u, --user <name>", "dashboard username (APP_USER on the server)")
    .option(
      "--password-stdin",
      "read the password from stdin instead of prompting (for scripts)"
    )
    .option("--json", "print the result as JSON")
    .addHelpText(
      "after",
      `
Server: --server, else MT4QB_SERVER, else the saved server ("auth server").
When none is set, login prompts for it (default ${DEFAULT_SERVER}).

Signs in with the same username/password as the web dashboard (server
APP_USER / APP_PASSWORD). The server returns a token that is valid for 7 days;
it is saved to ${configPath()}
with owner-only permissions. The password itself is never stored.

Before signing in, the CLI checks that the server speaks a compatible REST API
version (GET /api/v1/info).

Examples:
  mt4-quote-bridge auth login --server http://localhost:3000 --user admin
  echo "$QB_PASSWORD" | mt4-quote-bridge auth login -s http://10.0.0.5:3000 -u admin --password-stdin

Exit codes: 0 signed in, 1 error (wrong password, unreachable, incompatible).`
    )
    .action(async (o) => {
      const saved = await loadProfile();
      const configured = o.server ?? process.env.MT4QB_SERVER ?? saved?.server;
      // First run: ask for the server instead of silently assuming localhost.
      const entered =
        configured === undefined && interactive()
          ? await chooseServer(undefined, DEFAULT_SERVER)
          : normalizeServer(configured ?? DEFAULT_SERVER);
      const { server, upgraded } = await ApiClient.verifyServer(entered);
      if (upgraded)
        process.stderr.write(
          `${entered} redirects to HTTPS; using ${server}\n`
        );
      const client = new ApiClient(server);
      let username: string | undefined = o.user;
      if (!username)
        username = interactive()
          ? await ask(
              `Username [${saved?.username ?? "admin"}]: `,
              saved?.username ?? "admin"
            )
          : (saved?.username ?? "admin");
      let password: string;
      if (o.passwordStdin) password = await readStdin();
      else if (interactive()) password = await askHidden("Password: ");
      else
        throw new CliError(
          "No terminal for a password prompt; use --password-stdin."
        );
      const result = await client.request<{
        token: string;
        username: string;
        expires: number;
      }>("POST", "/api/auth/token", {
        auth: false,
        body: { username, password },
      });
      await saveProfile({
        server,
        username: result.username,
        token: result.token,
        expires: result.expires,
        savedAt: Date.now(),
      });
      if (o.json)
        print(
          JSON.stringify(
            {
              server,
              username: result.username,
              expires: result.expires,
              config: configPath(),
            },
            null,
            2
          )
        );
      else
        print(
          `Signed in to ${server} as ${result.username}. Token expires ${formatMillis(result.expires)}.\nSaved to ${configPath()}`
        );
    });

  auth
    .command("status")
    .description(
      "show the current sign-in and verify the token with the server"
    )
    .option("--json", "print the result as JSON")
    .addHelpText(
      "after",
      `
Shows the server URL, username and token expiry, and asks the server whether
the token is still valid (GET /api/auth/session).

Exit codes: 0 signed in and valid, 3 not signed in / token invalid or expired,
1 server unreachable.`
    )
    .action(async (o) => {
      const { server, token, profile } = await connection();
      if (!token)
        throw new CliError(
          `Not signed in to ${server}. Run: mt4-quote-bridge auth login`,
          EXIT.auth
        );
      const client = new ApiClient(server, token);
      await client.checkCompatible();
      const session = await client.get<{ username: string; expires: number }>(
        "/api/auth/session"
      );
      const daysLeft = (session.expires - Date.now()) / 86400000;
      const source = process.env.MT4QB_TOKEN ? "MT4QB_TOKEN" : configPath();
      if (o.json)
        print(
          JSON.stringify(
            { server, ...session, daysLeft, source, savedAt: profile?.savedAt },
            null,
            2
          )
        );
      else
        print(
          [
            `Server:   ${server}`,
            `User:     ${session.username}`,
            `Expires:  ${formatMillis(session.expires)} (${daysLeft.toFixed(1)} days left)`,
            `Token:    ${source}`,
            ...(daysLeft < 1
              ? ["Warning:  token expires within a day; run auth login again."]
              : []),
          ].join("\n")
        );
    });

  auth
    .command("logout")
    .description("revoke the saved token on the server and delete it locally")
    .addHelpText(
      "after",
      `
Revokes the token server-side (POST /api/auth/revoke) and removes it from
${configPath()}. The token is removed locally even when
the server is unreachable. The saved server URL is kept.`
    )
    .action(async () => {
      const { server, token } = await connection();
      let note = "";
      if (token)
        try {
          await new ApiClient(server, token).post("/api/auth/revoke", {});
        } catch (e) {
          note = ` (server revoke failed: ${e instanceof Error ? e.message : e})`;
        }
      await clearToken();
      print(`Signed out of ${server}${note}.`);
    });
  return auth;
}

/** Use the given URL, or prompt with `fallback` as the Enter default. */
async function chooseServer(url: string | undefined, fallback: string) {
  const value = url ?? (await ask(`Server URL [${fallback}]: `, fallback));
  try {
    return normalizeServer(value);
  } catch (e) {
    throw new CliError(
      `Invalid server URL "${value}": ${e instanceof Error ? e.message : e}. Example: http://192.168.1.20:3000`
    );
  }
}
