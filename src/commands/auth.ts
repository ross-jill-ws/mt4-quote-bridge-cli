import { Command } from "commander";
import { ApiClient, CliError, EXIT, type Session, usage } from "../client.js";
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
const formatMillis = (ms: number) =>
  new Date(ms).toISOString().replace("T", " ").slice(0, 19) + "Z";

export function authCommand() {
  const auth = new Command("auth")
    .description("sign in to QuoteBridge with an API key")
    .addHelpText(
      "after",
      `
Subcommands:
  server   set the QuoteBridge server URL (prompts; default ${DEFAULT_SERVER})
  login    save an API key created in the app window (prompts for the key)
  status   show the saved server, key name, scope and expiry (verifies with server)
  logout   delete the saved API key locally

Typical first run:
  1. In the QuoteBridge app window: Settings › API keys › create a key.
     Scope "readonly" reads everything; "trader" can also preview, execute
     and review trading requests. Keys are managed in the app window only.
  2. mt4-quote-bridge auth server     # enter the server URL (default ${DEFAULT_SERVER})
  3. mt4-quote-bridge auth login      # paste the API key

The server URL and API key are saved in ${configPath()}
(override with MT4QB_CONFIG). Keys never expire unless an expiry was chosen
when creating them; revoke them in the app window (Settings › API keys).
Environment overrides: MT4QB_SERVER (server URL), MT4QB_API_KEY (API key).`
    );

  auth
    .command("server")
    .usage("[URL] [options]")
    .description(
      `set the QuoteBridge server URL (prompts when URL is omitted; default ${DEFAULT_SERVER})`
    )
    .argument("[url]", "server URL, e.g. http://127.0.0.1:5580")
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
that the URL is a compatible QuoteBridge server (GET /api/v1/info) unless
--no-check is given. If an http:// URL redirects to https:// on the same host
(ngrok and most HTTPS proxies do this), the https:// URL is saved instead.
Other redirects are refused, so the API key is never sent to a different host.

Switching to a different server discards the saved API key, because keys are
only valid on the server that issued them. Run "auth login" afterwards.
MT4QB_SERVER, when set, overrides the saved server for every command.

Examples:
  mt4-quote-bridge auth server
  mt4-quote-bridge auth server http://127.0.0.1:5580
  mt4-quote-bridge auth server 127.0.0.1:5581 --no-check

The app answers on 127.0.0.1 only, on the HTTP port shown in its Settings ›
Connection (5580 by default). Use 127.0.0.1, not localhost.

Exit codes: 0 saved (or printed), 1 server unreachable or incompatible, 2 invalid URL.`
    )
    .action(async (url: string | undefined, o) => {
      const saved = await loadProfile();
      const current = normalizeServer(saved?.server ?? DEFAULT_SERVER);
      if (url === undefined && !interactive()) {
        if (o.json) print(envelope({ server: current, saved: !!saved }));
        else print(current);
        return;
      }
      const entered = await chooseServer(url, current);
      const { server, upgraded } = o.check
        ? await ApiClient.verifyServer(entered)
        : { server: entered, upgraded: false };
      const { changed, droppedToken } = await saveServer(server);
      if (o.json) print(envelope({ server, upgraded, changed, droppedToken }));
      else
        print(
          (upgraded ? `${entered} redirects to HTTPS; using it.\n` : "") +
            `Server set to ${server}${changed ? "" : " (unchanged)"}.` +
            (droppedToken
              ? "\nThe previous server's API key was removed. Run: mt4-quote-bridge auth login"
              : saved?.token && !changed
                ? ""
                : "\nNext: mt4-quote-bridge auth login")
        );
    });

  auth
    .command("login")
    .description("sign in with an API key from the app window and save it")
    .option(
      "-s, --server <url>",
      `QuoteBridge server URL (default: saved server, MT4QB_SERVER or ${DEFAULT_SERVER})`
    )
    .option(
      "--api-key-stdin",
      "read the API key from stdin instead of prompting (for scripts)"
    )
    .option("--json", "print the result as JSON")
    .addHelpText(
      "after",
      `
Server: --server, else MT4QB_SERVER, else the saved server ("auth server").
When none is set, login prompts for it (default ${DEFAULT_SERVER}).

Prompts for an API key (input hidden). Create one in the app window: Settings ›
API keys. The key looks like qbk_<64 hex> and is shown only once. Its scope
decides what the CLI may do:
  readonly  every read: markets, accounts, Funds, positions, orders, requests,
            indicators, terminals
  trader    also previews, requests execute and requests review (demo only)

The key is checked with the server (GET /api/auth/session) and saved to
${configPath()}
with owner-only permissions. Before that, the CLI checks that the server speaks
a compatible REST API version (GET /api/v1/info).

Examples:
  mt4-quote-bridge auth login
  mt4-quote-bridge auth login --server http://127.0.0.1:5580
  echo "$QB_API_KEY" | mt4-quote-bridge auth login -s http://127.0.0.1:5580 --api-key-stdin

Exit codes: 0 signed in, 1 error (unreachable, incompatible), 2 no key source or
invalid URL, 3 key rejected.`
    )
    .action(async (o) => {
      const saved = await loadProfile();
      const configured =
        o.server ?? (process.env.MT4QB_SERVER || undefined) ?? saved?.server;
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
      let key: string;
      if (o.apiKeyStdin) key = await readStdin();
      else if (interactive()) key = await askHidden("API key: ");
      else
        throw usage("No terminal for an API key prompt; use --api-key-stdin.");
      key = key.trim();
      if (!isApiKey(key))
        throw new CliError(
          "That is not a QuoteBridge API key (expected qbk_ followed by 64 hex characters). Create one in the app window: Settings › API keys.",
          EXIT.auth,
          "invalid-key"
        );
      const session = await new ApiClient(server, key).session();
      await saveProfile({
        server,
        username: session.username,
        token: key,
        keyName: session.key.name,
        scope: session.key.scope,
        expires: session.expires,
        savedAt: Date.now(),
      });
      if (o.json)
        print(
          envelope({
            server,
            username: session.username,
            key: session.key,
            expires: session.expires,
            config: configPath(),
          })
        );
      else
        print(
          `Signed in to ${server} as ${session.username} with API key "${session.key.name}" (${scopeLabel(session.key.scope)}). ${expiryText(session.expires)}.\nSaved to ${configPath()}`
        );
    });

  auth
    .command("status")
    .description(
      "show the current sign-in and verify the API key with the server"
    )
    .option("--json", "print the result as JSON")
    .addHelpText(
      "after",
      `
Shows the server URL, user, API key name, scope and expiry, and asks the
server whether the key is still valid (GET /api/auth/session).

Exit codes: 0 signed in and valid, 3 not signed in / key invalid, expired or
revoked, 1 server unreachable.`
    )
    .action(async (o) => {
      const { server, token, profile } = await connection();
      if (!token)
        throw new CliError(
          `Not signed in to ${server}. Run: mt4-quote-bridge auth login`,
          EXIT.auth,
          "not-signed-in"
        );
      const client = new ApiClient(server, token);
      await client.checkCompatible();
      const session = await client.session();
      const daysLeft =
        session.expires === null
          ? null
          : (session.expires - Date.now()) / 86400000;
      const source = process.env.MT4QB_API_KEY ? "MT4QB_API_KEY" : configPath();
      if (o.json)
        print(
          envelope({
            server,
            ...session,
            daysLeft,
            source,
            savedAt: profile?.savedAt,
          })
        );
      else
        print(
          [
            `Server:   ${server}`,
            `User:     ${session.username}`,
            `API key:  ${session.key.name} (${session.key.prefix}…)`,
            `Scope:    ${scopeLabel(session.key.scope)}`,
            `Expires:  ${
              session.expires === null
                ? "never"
                : `${formatMillis(session.expires)} (${daysLeft!.toFixed(1)} days left)`
            }`,
            `Source:   ${source}`,
            ...(daysLeft !== null && daysLeft < 7
              ? [
                  "Warning:  key expires within a week; create a new one in the app window and run auth login.",
                ]
              : []),
          ].join("\n")
        );
    });

  auth
    .command("logout")
    .description("delete the saved API key locally")
    .option("--json", "print the result as JSON")
    .addHelpText(
      "after",
      `
Removes the API key from ${configPath()}. The saved
server URL is kept. The key itself stays valid; revoke it in the app window
(Settings › API keys) if it should stop working everywhere.

--json prints { data: { server, removed }, meta: {} }; removed is false when no
key was saved.

Exit codes: 0 removed (or nothing to remove), 2 usage error.`
    )
    .action(async (o) => {
      const { server, profile } = await connection();
      const removed = !!profile?.token;
      await clearToken();
      if (o.json) print(envelope({ server, removed }));
      else
        print(
          removed
            ? `Removed the saved API key for ${server}. To disable the key itself, revoke it in the app window (Settings › API keys).`
            : `No API key was saved for ${server}.`
        );
    });
  return auth;
}

/** --json output in the same { data, meta } envelope as every other command. */
const envelope = (data: unknown) => JSON.stringify({ data, meta: {} }, null, 2);

export const isApiKey = (value: string) => /^qbk_[a-f0-9]{64}$/.test(value);

const scopeLabel = (scope: string) =>
  scope === "trader" ? "trader: reads, previews, execute, review" : "readonly";

const expiryText = (expires: number | null) =>
  expires === null
    ? "Key does not expire"
    : `Key expires ${formatMillis(expires)}`;

/** Use the given URL, or prompt with `fallback` as the Enter default. */
async function chooseServer(url: string | undefined, fallback: string) {
  const value = url ?? (await ask(`Server URL [${fallback}]: `, fallback));
  try {
    return normalizeServer(value);
  } catch (e) {
    throw usage(
      `Invalid server URL "${value}": ${e instanceof Error ? e.message : e}. Example: ${DEFAULT_SERVER}`
    );
  }
}
