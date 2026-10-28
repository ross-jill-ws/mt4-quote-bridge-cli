# Sign-in and configuration

[Manual](README.md) › Sign-in and configuration

| Command | Use it for | Contacts the app |
| --- | --- | --- |
| [`auth status`](#auth-status) | is the CLI signed in, to which server, with which scope? Run it first | yes |
| [`auth server [URL]`](#auth-server) | set or change the server URL | yes, unless `--no-check` |
| [`auth login`](#auth-login) | save an API key created in the app window | yes |
| [`auth logout`](#auth-logout) | forget the saved key on this computer | no |
| [`config show`](#config-show) | which server and config file the CLI actually uses | no |

API keys, their scopes and expiry, the HTTP port, Demo trading, the lot cap and slippage are all managed in the
**app window** (Settings). No command creates a key or changes a setting.

## auth status

```text
$ mt4-quote-bridge auth status
Server:   http://127.0.0.1:5580
User:     admin
API key:  laptop-cli (qbk_1a2b…)
Scope:    readonly
Expires:  2027-03-01 00:00:00Z (45.0 days left)
Source:   C:\Users\you\.mt4-quote-bridge\config.json
```

It asks the app whether the key is still valid. A key expiring within a week adds a `Warning:` line.

| Exit | Meaning |
| --- | --- |
| 0 | signed in; the key is valid |
| 3 | not signed in, or the key is invalid, expired or revoked: `auth login` |
| 1 | the app cannot be reached: is it running? Check `config show` |

`--json`: `{ server, username, key: { name, prefix, scope }, expires, daysLeft, source, savedAt }`.

## auth server

```text
mt4-quote-bridge auth server [URL] [--no-check] [--json]
```

- Without `URL` in a terminal it prompts `Server URL [http://127.0.0.1:5580]:`; Enter keeps the shown value (the saved
  server, or the default). Without `URL` and without a terminal (scripts), it prints the current server and changes
  nothing.
- `host:port` is accepted (`http://` is assumed).
- Before saving, it checks that the URL is a compatible QuoteBridge server (`GET /api/v1/info`), unless `--no-check`.
- An `http://` URL that redirects to `https://` on the same host is saved as `https://`. Any other redirect is refused,
  so the key is never sent to a different host.
- **Changing to a different server forgets the saved key**, because a key works only on the server that issued it.
  Run `auth login` afterwards.

Exit codes: 0 saved (or printed), 1 unreachable or not a compatible server, 2 invalid URL.

## auth login

```text
mt4-quote-bridge auth login [--server URL] [--api-key-stdin] [--json]
```

1. The server is `--server`, else `MT4QB_SERVER`, else the saved one; on a first run in a terminal, it prompts.
2. It checks the server speaks a compatible REST API version.
3. It reads the key: a hidden prompt, or stdin with `--api-key-stdin`.
4. It checks the key with the app (`GET /api/auth/session`) and saves server, key, key name, scope and expiry to the
   config file with owner-only permissions.

```text
$ mt4-quote-bridge auth login
API key:
Signed in to http://127.0.0.1:5580 as admin with API key "laptop-cli" (trader: reads, screenshots, previews, execute, review). Key does not expire.
Saved to C:\Users\you\.mt4-quote-bridge\config.json
```

For scripts: `echo "$QB_API_KEY" | mt4-quote-bridge auth login --api-key-stdin`.

Exit codes: 0 signed in; 1 unreachable or incompatible; 2 no key source (no terminal and no `--api-key-stdin`) or an
invalid URL; 3 the key was rejected, or is not a `qbk_` key (`invalid-key`).

## auth logout

Removes the key from the config file and keeps the server URL. The key itself stays valid; revoke it in the app
window (Settings › API keys) to disable it everywhere. `--json` prints `{ server, removed }`.

## config show

Reads only the local configuration, never the app, and never prints the key.

```text
$ mt4-quote-bridge config show
Server:       http://127.0.0.1:5580 (config file)
Config file:  C:\Users\you\.mt4-quote-bridge\config.json
API key:      saved (config file, "laptop-cli", trader)
```

`Server` says where the URL comes from: `MT4QB_SERVER`, `config file` or `default`. `--json`: `{ server,
serverSource, defaultServer, configFile, apiKey, keyName, scope }`, where `apiKey` is the key's source
(`MT4QB_API_KEY` or `config file`) or null. It always exits 0.

## Environment variables

| Variable | Overrides |
| --- | --- |
| `MT4QB_SERVER` | the saved server URL, for every command |
| `MT4QB_API_KEY` | the saved API key, for every command; nothing is written to disk |
| `MT4QB_CONFIG` | the config file's path (default `~/.mt4-quote-bridge/config.json`) |

## The server

The app answers on this computer only: `http://127.0.0.1:5580`, `http://localhost:5580` or `http://[::1]:5580`, on
the HTTP port in the app window's Settings › Connection (5580 by default). If the port changes there, run
`mt4-quote-bridge auth server http://127.0.0.1:<port>`.
