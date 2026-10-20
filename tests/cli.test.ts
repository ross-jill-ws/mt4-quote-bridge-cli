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

/** Runs src/cli.ts in a child process with `env`, from `cwd`. */
async function cliRunner(env: NodeJS.ProcessEnv, cwd: string) {
  const { spawn } = await import("node:child_process");
  const { join } = await import("node:path");
  return (...args: string[]) =>
    new Promise<{ code: number | null; out: string; err: string }>(
      (resolve) => {
        const child = spawn(
          process.execPath,
          // cwd may be a temp dir, so resolve tsx from here.
          [
            "--import",
            import.meta.resolve("tsx"),
            join(process.cwd(), "src/cli.ts"),
            ...args,
          ],
          { env, cwd }
        );
        let out = "",
          err = "";
        child.stdout.on("data", (b) => (out += b));
        child.stderr.on("data", (b) => (err += b));
        child.on("close", (code) => resolve({ code, out, err }));
      }
    );
}

test("shorthand arguments rewrite to canonical subcommands", () => {
  const cases: [string, string][] = [
    ["symbol AUDUSD 1H 30", "symbol candles AUDUSD 1H 30"],
    ["symbol AUDUSD H1", "symbol candles AUDUSD H1"],
    ["symbol AUDUSD 15M --csv", "symbol candles AUDUSD 15M --csv"],
    ["symbol AUDUSD ask", "symbol ask AUDUSD"],
    ["symbol XAUUSD info --json", "symbol info XAUUSD --json"],
    ["symbol AUDUSD", "symbol quote AUDUSD"],
    ["symbol AUDUSD --json", "symbol quote AUDUSD --json"],
    ["symbol AUDUSD buy 0.1 --sl 1", "symbol buy AUDUSD 0.1 --sl 1"],
    ["symbol AUDUSD buy-limit 0.1 0.65", "symbol buy-limit AUDUSD 0.1 0.65"],
    ["symbol AUDUSD buy --help", "symbol buy AUDUSD --help"],
    ["symbol AUDUSD --help", "symbol --help"],
    ["symbol buy AUDUSD 0.1", "symbol buy AUDUSD 0.1"],
    ["symbol list", "symbol list"],
    ["symbol list --online --json", "symbol list --online --json"],
    ["symbol --help", "symbol --help"],
    ["indicator list", "indicator list"],
    ["indicator macd", "indicator info macd"],
    ["indicator macd --json", "indicator info macd --json"],
    ["indicator macd AUDUSD 1H 30", "indicator show macd AUDUSD 1H 30"],
    ["indicator macd --help", "indicator show --help"],
    ["hist list", "hist list"],
    ["hist AUDUSD 1H --start 20260901", "hist bars AUDUSD 1H --start 20260901"],
    ["hist AUDUSD --help", "hist bars --help"],
    ["position", "position"],
    ["position 12345 --json", "position show 12345 --json"],
    ["position list --pending", "position list --pending"],
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

test("hist download saves an .hst file's CSV and refuses ambiguous symbols", async () => {
  const { mkdtemp, readFile, readdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const key = "qbk_" + "cd".repeat(32);
  const file = (id: string) => ({
    file: id,
    symbol: "GOLD30",
    period: "M30",
    timeframe: 30,
    digits: 2,
    bars: 2,
    from: 1786973400,
    to: 1787059800,
  });
  const body =
    "time,open,high,low,close,tick_volume,spread,real_volume\n" +
    "2026-08-17 13:30:00,4080.00,4085.00,4079.00,4082.50,100,0,0\n" +
    "2026-08-18 13:30:00,4081.00,4086.00,4080.00,4083.50,100,0,0\n";
  const seen: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    seen.push(url.pathname + url.search);
    if (req.headers.authorization !== `Bearer ${key}`) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end("{}");
    }
    if (url.pathname === "/api/v1/history/files") {
      res.writeHead(200, { "content-type": "application/json" });
      const ids =
        url.searchParams.get("symbol") === "TWICE"
          ? ["A/GOLD30.hst", "B/GOLD30.hst"]
          : ["CMC-Demo/GOLD30.hst"];
      return res.end(JSON.stringify({ files: ids.map(file) }));
    }
    if (url.pathname === "/api/v1/history/files/csv") {
      res.writeHead(200, {
        "content-type": "text/csv",
        "content-disposition":
          'attachment; filename="GOLD30_M30_20260817-20260818.csv"',
      });
      return res.end(body);
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"error":"nope"}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dir = await mkdtemp(join(tmpdir(), "qb-cli-download-"));
  const env = {
    ...process.env,
    MT4QB_CONFIG: join(dir, "config.json"),
    MT4QB_SERVER: origin,
    MT4QB_API_KEY: key,
  };
  // Runs in the temp dir, the default save location.
  const cli = await cliRunner(env, dir);
  try {
    const saved = await cli(
      "hist",
      "download",
      "gold30",
      "30m",
      "--start",
      "20260817"
    );
    assert.equal(saved.code, 0, saved.err);
    assert.match(
      saved.out,
      /Saved 2 bars to GOLD30_M30_20260817-20260818\.csv/
    );
    assert.equal(
      await readFile(join(dir, "GOLD30_M30_20260817-20260818.csv"), "utf8"),
      body
    );
    assert.ok(
      seen.includes(
        "/api/v1/history/files/csv?file=CMC-Demo%2FGOLD30.hst&from=1786924800&to=9999999999"
      ),
      seen.join("\n")
    );
    const piped = await cli("hist", "download", "GOLD30", "M30", "-o", "-");
    assert.equal(piped.out, body);
    const ambiguous = await cli("hist", "download", "TWICE", "M30");
    assert.equal(ambiguous.code, 1);
    assert.match(ambiguous.err, /Several \.hst files match.*--file/);
    assert.match(ambiguous.err, /B\/GOLD30\.hst/);
    const chosen = await cli(
      "hist",
      "download",
      "TWICE",
      "M30",
      "--file",
      "B/GOLD30.hst",
      "-o",
      "b.csv"
    );
    assert.equal(chosen.code, 0, chosen.err);
    assert.deepEqual(
      (await readdir(dir))
        .filter((f) => f.endsWith(".csv") || f.endsWith(".part"))
        .sort(),
      ["GOLD30_M30_20260817-20260818.csv", "b.csv"]
    );
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("symbol info shows lot limits, contract spec and expiry", async () => {
  const key = "qbk_" + "ef".repeat(32);
  const info = (spec: unknown) => ({
    symbol: "GOLD.DEC26",
    broker: "Broker Ltd",
    terminal: "Term",
    feed: "f1",
    bid: 4080.5,
    ask: 4081,
    digits: 2,
    point: 0.01,
    tickSize: 0.01,
    tickValue: 0.01,
    minLot: 0.1,
    maxLot: 20,
    lotStep: 0.1,
    stopLevel: 30,
    freezeLevel: 0,
    tradeAllowed: true,
    time: 1787059800,
    received: 1787059800000,
    spec,
  });
  const spec = {
    contractSize: 1,
    marginRequired: 408.1,
    swapLong: -12.5,
    swapShort: 3.25,
    swapType: "points",
    profitCurrency: "USD",
    starting: 0,
    expiration: 1798675200,
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    res.writeHead(200, { "content-type": "application/json" });
    if (url.pathname === "/api/v1/symbols/GOLD.DEC26/info")
      return res.end(JSON.stringify(info(spec)));
    if (url.pathname === "/api/v1/symbols/OLD/info")
      return res.end(JSON.stringify({ ...info(null), symbol: "OLD" }));
    res.writeHead(404);
    res.end('{"error":"Unknown symbol"}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const cli = await cliRunner(
    {
      ...process.env,
      MT4QB_CONFIG: join(tmpdir(), "qb-cli-info-unused.json"),
      MT4QB_SERVER: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      MT4QB_API_KEY: key,
    },
    process.cwd()
  );
  try {
    const shown = await cli("symbol", "GOLD.DEC26", "info");
    assert.equal(shown.code, 0, shown.err);
    assert.match(shown.out, /Lots +min 0\.1 · step 0\.1 · max 20/);
    assert.match(shown.out, /Contract +1 per lot · profit in USD/);
    assert.match(shown.out, /Swap +long -12\.5 · short 3\.25 \(points\)/);
    assert.match(shown.out, /Expiry +2026-12-31 00:00/);
    const json = await cli("symbol", "info", "GOLD.DEC26", "--json");
    assert.deepEqual(JSON.parse(json.out).spec, spec);
    const old = await cli("symbol", "OLD", "info");
    assert.equal(old.code, 0, old.err);
    assert.match(old.out, /Lots +min 0\.1/);
    assert.match(old.out, /EA 1\.07/);
  } finally {
    server.close();
  }
});
