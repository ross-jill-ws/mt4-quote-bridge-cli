import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { rewriteArgs } from "../src/argv.js";
import { ApiClient, CliError } from "../src/client.js";
import { normalizeServer } from "../src/config.js";
import { csv, table } from "../src/output.js";
import { formatTime, parseTime } from "../src/time.js";

test("shorthand arguments rewrite to canonical subcommands", () => {
  const cases: [string, string][] = [
    ["symbol AUDUSD 1H 30", "symbol candles AUDUSD 1H 30"],
    ["symbol AUDUSD H1", "symbol candles AUDUSD H1"],
    ["symbol AUDUSD 15M --csv", "symbol candles AUDUSD 15M --csv"],
    ["symbol AUDUSD ask", "symbol ask AUDUSD"],
    ["symbol AUDUSD", "symbol quote AUDUSD"],
    ["symbol AUDUSD --json", "symbol quote AUDUSD --json"],
    ["symbol AUDUSD buy 0.1 --sl 1", "symbol buy AUDUSD 0.1 --sl 1"],
    ["symbol AUDUSD buy-limit 0.1 0.65", "symbol buy-limit AUDUSD 0.1 0.65"],
    ["symbol AUDUSD buy --help", "symbol buy AUDUSD --help"],
    ["symbol AUDUSD --help", "symbol --help"],
    ["symbol buy AUDUSD 0.1", "symbol buy AUDUSD 0.1"],
    ["symbol --help", "symbol --help"],
    ["indicator list", "indicator list"],
    ["indicator macd", "indicator info macd"],
    ["indicator macd --json", "indicator info macd --json"],
    ["indicator macd AUDUSD 1H 30", "indicator show macd AUDUSD 1H 30"],
    ["indicator macd --help", "indicator show --help"],
    ["hist list", "hist list"],
    ["hist AUDUSD 1H --start 20260901", "hist bars AUDUSD 1H --start 20260901"],
    ["hist AUDUSD --help", "hist bars --help"],
    ["symbols", "symbols"],
    ["positions", "positions"],
    ["positions 12345 --json", "positions show 12345 --json"],
    ["positions list --pending", "positions list --pending"],
    ["budget", "budget"],
    ["budget 123456", "budget show 123456"],
  ];
  for (const [input, expected] of cases)
    assert.equal(rewriteArgs(input.split(" ")).join(" "), expected, input);
});

test("dates parse as broker-time UTC; date-only end covers the whole day", () => {
  assert.equal(parseTime("20260901"), Date.UTC(2026, 8, 1) / 1000);
  assert.equal(parseTime("2026-09-01"), Date.UTC(2026, 8, 1) / 1000);
  assert.equal(
    parseTime("20261017", true),
    Date.UTC(2026, 9, 17, 23, 59, 59) / 1000
  );
  assert.equal(
    parseTime("2026-10-17 13:30"),
    Date.UTC(2026, 9, 17, 13, 30) / 1000
  );
  assert.equal(parseTime("1760000000"), 1760000000);
  for (const bad of ["2026-02-30", "17/10/2026", "tomorrow", "2026131"])
    assert.throws(() => parseTime(bad), /Invalid date/);
  assert.equal(
    formatTime(Date.UTC(2026, 9, 17, 13) / 1000),
    "2026-10-17 13:00"
  );
  assert.equal(
    formatTime(Date.UTC(2026, 9, 17, 13, 0, 5) / 1000),
    "2026-10-17 13:00:05"
  );
});

test("table aligns columns and CSV quotes values", () => {
  const rows = [
    { a: "x", b: 1.5 },
    { a: 'say "hi", ok', b: 10 },
  ];
  const cols = [
    { header: "A", value: (r: (typeof rows)[number]) => r.a },
    {
      header: "B",
      value: (r: (typeof rows)[number]) => r.b,
      align: "right" as const,
    },
  ];
  assert.equal(
    table(rows, cols),
    'A               B\n------------  ---\nx             1.5\nsay "hi", ok   10'
  );
  assert.equal(csv(rows, cols), 'A,B\nx,1.5\n"say ""hi"", ok",10');
});

test("server URLs normalise; non-HTTP schemes are rejected", () => {
  assert.equal(normalizeServer("localhost:3000"), "http://localhost:3000");
  assert.equal(
    normalizeServer("https://qb.example.com/base/"),
    "https://qb.example.com/base"
  );
  assert.throws(() => normalizeServer("ftp://x"), /http or https/);
});

test("API client sends Bearer tokens and maps server errors", async () => {
  const seen: { auth?: string; url?: string }[] = [];
  const server = createServer((req, res) => {
    seen.push({ auth: req.headers.authorization, url: req.url });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/api/v1/info")
      return send(200, { service: "mt4-quote-bridge", apiVersion: 1 });
    if (req.url?.startsWith("/api/v1/ok")) return send(200, { ok: true });
    if (req.url === "/api/v1/ambiguous")
      return send(409, {
        error: "Symbol AUDUSD is ambiguous",
        details: [{ broker: "A" }, { broker: "B" }],
      });
    if (req.url === "/api/v1/expired") return send(401, { error: "auth" });
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html>");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const client = new ApiClient(origin, "a".repeat(64));
    await client.checkCompatible();
    assert.deepEqual(
      await client.get("/api/v1/ok", { period: "H1", empty: undefined }),
      { ok: true }
    );
    assert.equal(seen.at(-1)!.auth, `Bearer ${"a".repeat(64)}`);
    assert.equal(seen.at(-1)!.url, "/api/v1/ok?period=H1");
    await assert.rejects(client.get("/api/v1/ambiguous"), (e: CliError) => {
      assert.match(e.message, /ambiguous/);
      assert.equal((e.details as unknown[]).length, 2);
      return true;
    });
    await assert.rejects(
      client.get("/api/v1/expired"),
      (e: CliError) => e.exitCode === 3 && /auth login/.test(e.message)
    );
    await assert.rejects(client.get("/html"), /Unexpected response/);
    await assert.rejects(
      new ApiClient(origin).get("/api/v1/ok"),
      (e: CliError) => e.exitCode === 3
    );
    await assert.rejects(
      new ApiClient("http://127.0.0.1:1", "x").get("/api/v1/ok"),
      /Cannot reach/
    );
  } finally {
    server.close();
  }
});

test("saveServer keeps the token for the same server and drops it on switch", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const config = await import("../src/config.js");
  const dir = await mkdtemp(join(tmpdir(), "qb-cli-"));
  const previous = process.env.MT4QB_CONFIG;
  process.env.MT4QB_CONFIG = join(dir, "config.json");
  try {
    assert.deepEqual(await config.saveServer("http://a:3000"), {
      changed: true,
      droppedToken: false,
    });
    await config.saveProfile({
      server: "http://a:3000",
      token: "t".repeat(64),
      username: "admin",
      expires: 1,
      savedAt: 1,
    });
    assert.deepEqual(await config.saveServer("http://a:3000"), {
      changed: false,
      droppedToken: false,
    });
    assert.equal((await config.loadProfile())?.token, "t".repeat(64));
    assert.deepEqual(await config.saveServer("http://b:3000"), {
      changed: true,
      droppedToken: true,
    });
    const switched = await config.loadProfile();
    assert.equal(switched?.server, "http://b:3000");
    assert.equal(switched?.token, undefined);
    await config.saveProfile({ ...switched!, token: "x", expires: 1 });
    await config.clearToken();
    assert.deepEqual(Object.keys((await config.loadProfile())!).sort(), [
      "savedAt",
      "server",
    ]);
  } finally {
    if (previous === undefined) delete process.env.MT4QB_CONFIG;
    else process.env.MT4QB_CONFIG = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("verifyServer adopts same-host http->https redirects and refuses others", async () => {
  let target = "";
  const server = createServer((_req, res) => {
    res.writeHead(308, { location: target });
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  try {
    target = "https://evil.example/api/v1/info";
    await assert.rejects(ApiClient.verifyServer(origin), (e: CliError) =>
      /redirects to https:\/\/evil\.example/.test(e.message)
    );
    await assert.rejects(
      new ApiClient(origin, "t".repeat(64)).get("/api/v1/symbols"),
      /redirects to/
    );
    // Same host over https: the upgrade is attempted (no TLS here, so it fails to connect).
    target = `https://127.0.0.1:${port}/api/v1/info`;
    await assert.rejects(ApiClient.verifyServer(origin), (e: CliError) =>
      e.message.includes(
        `Cannot reach Quote Bridge server at https://127.0.0.1:${port}`
      )
    );
  } finally {
    server.close();
  }
});

test("auth login asks only for an API key, verifies it and saves it", async () => {
  const { spawn } = await import("node:child_process");
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const key = "qbk_" + "ab".repeat(32);
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/api/v1/info")
      return send(200, { service: "mt4-quote-bridge", apiVersion: 1 });
    if (
      req.url === "/api/auth/session" &&
      req.headers.authorization === `Bearer ${key}`
    )
      return send(200, {
        username: "admin",
        key: { name: "laptop", prefix: key.slice(0, 12), scope: "read" },
        expires: null,
      });
    send(401, { error: "API key missing, invalid or expired." });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dir = await mkdtemp(join(tmpdir(), "qb-cli-login-"));
  const config = join(dir, "config.json");
  const env: NodeJS.ProcessEnv = { ...process.env, MT4QB_CONFIG: config };
  for (const name of ["MT4QB_SERVER", "MT4QB_API_KEY", "MT4QB_TOKEN"])
    delete env[name];
  const login = (input: string) =>
    new Promise<{ code: number | null; out: string; err: string }>(
      (resolve) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            "src/cli.ts",
            "auth",
            "login",
            "-s",
            origin,
            "--api-key-stdin",
          ],
          { env }
        );
        let out = "",
          err = "";
        child.stdout.on("data", (b) => (out += b));
        child.stderr.on("data", (b) => (err += b));
        child.on("close", (code) => resolve({ code, out, err }));
        child.stdin.end(input);
      }
    );
  try {
    const bad = await login("not-a-key\n");
    assert.equal(bad.code, 3);
    assert.match(bad.err, /qbk_/);
    const revoked = await login("qbk_" + "0".repeat(64) + "\n");
    assert.equal(revoked.code, 3);
    const ok = await login(key + "\n");
    assert.equal(ok.code, 0, ok.err);
    assert.match(
      ok.out,
      /API key "laptop" \(query only\)\. Key does not expire/
    );
    const saved = JSON.parse(await readFile(config, "utf8"));
    assert.equal(saved.server, origin);
    assert.equal(saved.token, key);
    assert.equal(saved.scope, "read");
    assert.equal(saved.expires, null);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
