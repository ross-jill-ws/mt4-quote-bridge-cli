// Unit and process tests with a stub server: the client's envelopes and exit codes, exact resolution, argument checks
// that send nothing, stream discipline and sign-in. The real app is exercised by acceptance.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiClient, ApiError, CliError, EXIT, exitFor } from "../src/client.js";
import { DEFAULT_SERVER, normalizeServer } from "../src/config.js";
import { table } from "../src/output.js";
import { resolveAccount, resolveMarket } from "../src/resolve.js";
import { utcExpiry, utcTime } from "../src/commands/common.js";

type Handler = (
  req: IncomingMessage,
  body: string,
  send: (status: number, body: unknown) => void
) => void;

/** A stub server; `seen` records every request as "METHOD path body". */
async function stub(handler: Handler) {
  const seen: string[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push(`${req.method} ${req.url} ${body}`.trim());
      handler(req, body, (status, payload) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      });
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { origin, seen, close: () => server.close() };
}

const MARKETS = [
  {
    id: "m-demo",
    brokerServer: "Demo-Broker",
    symbol: "EURUSD",
    label: "EURUSD · Demo-Broker",
    digits: 5,
    connected: true,
  },
  {
    id: "m-real",
    brokerServer: "Real-Broker",
    symbol: "EURUSD",
    label: "EURUSD · Real-Broker",
    digits: 5,
    connected: true,
  },
  {
    id: "m-gbp",
    brokerServer: "Demo-Broker",
    symbol: "GBPUSD",
    label: "GBPUSD · Demo-Broker",
    digits: 5,
    connected: true,
  },
];
const ACCOUNTS = [
  {
    id: "a-demo",
    brokerServer: "Demo-Broker",
    login: "1001",
    label: "Demo-Broker · 1001",
    demo: true,
    connected: true,
    currency: "USD",
    executor: { state: "ready", terminalId: "t1" },
  },
  {
    id: "a-real",
    brokerServer: "Real-Broker",
    login: "1001",
    label: "Real-Broker · 1001",
    demo: false,
    connected: true,
    currency: "USD",
    executor: { state: "real-account", terminalId: "t2" },
  },
  {
    id: "a-two",
    brokerServer: "Demo-Broker",
    login: "2002",
    label: "Demo-Broker · 2002",
    demo: true,
    connected: true,
    currency: "EUR",
    executor: { state: "ready", terminalId: "t3" },
  },
];

/** A stub of the collections the resolver reads, with exact filters and one item per page so cursors are followed. */
const directory: Handler = (req, _body, send) => {
  const url = new URL(req.url!, "http://x");
  const page = (items: unknown[]) => {
    const at = Number(url.searchParams.get("cursor") ?? 0);
    send(200, {
      data: items.slice(at, at + 1),
      meta: {
        count: 1,
        limit: 1,
        nextCursor: at + 1 < items.length ? String(at + 1) : null,
      },
    });
  };
  if (url.pathname === "/api/v1/markets") {
    const b = url.searchParams.get("brokerServer");
    const s = url.searchParams.get("symbol");
    return page(
      MARKETS.filter(
        (m) =>
          (b === null || m.brokerServer === b) && (s === null || m.symbol === s)
      )
    );
  }
  if (url.pathname === "/api/v1/accounts") return page(ACCOUNTS);
  send(404, {
    error: { code: "unknown-route", message: "No such route.", details: null },
  });
};

test("UTC time options: ISO with Z or whole days; expiry in whole seconds or none", () => {
  assert.equal(utcTime(false)("2027-01-15"), "2027-01-15T00:00:00Z");
  assert.equal(utcTime(true)("2027-01-15"), "2027-01-15T23:59:59Z");
  assert.equal(
    utcTime(false)("2027-01-15T08:00:00.5Z"),
    "2027-01-15T08:00:00.5Z"
  );
  for (const bad of [
    "2027-01-15 08:00",
    "20270115",
    "2027-01-15T08:00:00+02:00",
    "1700000000",
  ])
    assert.throws(() => utcTime(false)(bad), /UTC/);
  assert.equal(utcExpiry("2027-01-15T08:00:00Z"), "2027-01-15T08:00:00Z");
  assert.equal(utcExpiry("none"), "none");
  assert.throws(() => utcExpiry("2027-01-15T08:00:00.5Z"), /whole seconds/);
});

test("HTTP statuses map to stable exit codes", () => {
  const cases: [number, number][] = [
    [400, EXIT.usage],
    [401, EXIT.auth],
    [403, EXIT.forbidden],
    [404, EXIT.notFound],
    [409, EXIT.conflict],
    [422, EXIT.invalid],
    [503, EXIT.unavailable],
    [504, EXIT.unavailable],
    [500, EXIT.error],
  ];
  for (const [status, exit] of cases)
    assert.equal(exitFor(status), exit, String(status));
  assert.deepEqual(
    Object.values(EXIT),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    "exit codes are documented and stable"
  );
});

test("server URLs normalise; the default is the app's loopback port", () => {
  assert.equal(DEFAULT_SERVER, "http://127.0.0.1:5580");
  assert.equal(normalizeServer("127.0.0.1:5580/"), "http://127.0.0.1:5580");
  assert.throws(() => normalizeServer("ftp://x"), /http or https/);
  assert.equal(table([], [{ header: "A", value: () => 1 }]), "(none)");
});

test("the client returns envelopes and keeps the server's error code, message and details", async () => {
  const server = await stub((req, _body, send) => {
    if (req.url === "/api/v1/info")
      return send(200, {
        data: { service: "mt4-quote-bridge", apiVersion: 1 },
        meta: {},
      });
    if (req.url?.startsWith("/api/v1/ok"))
      return send(200, { data: { ok: true }, meta: { count: 1 } });
    if (req.url === "/api/v1/conflict")
      return send(409, {
        error: {
          code: "cross-broker-market",
          message: "Other broker.",
          details: { accountBrokerServer: "A" },
        },
      });
    send(401, {
      error: {
        code: "unauthenticated",
        message: "Send an API key.",
        details: null,
      },
    });
  });
  try {
    const client = new ApiClient(server.origin, "qbk_key");
    await client.checkCompatible();
    assert.deepEqual(
      await client.get("/api/v1/ok", { timeframe: "H1", from: undefined }),
      { data: { ok: true }, meta: { count: 1 } }
    );
    assert.equal(server.seen.at(-1), "GET /api/v1/ok?timeframe=H1");
    await assert.rejects(client.get("/api/v1/conflict"), (e: ApiError) => {
      assert.deepEqual(
        [e.status, e.code, e.exitCode, e.details],
        [
          409,
          "cross-broker-market",
          EXIT.conflict,
          { accountBrokerServer: "A" },
        ]
      );
      assert.deepEqual(e.envelope(), {
        error: {
          code: "cross-broker-market",
          message: "Other broker.",
          details: { accountBrokerServer: "A" },
        },
      });
      return true;
    });
    await assert.rejects(
      client.get("/api/v1/x"),
      (e: CliError) => e.exitCode === EXIT.auth
    );
    await assert.rejects(
      new ApiClient(server.origin).get("/api/v1/ok"),
      (e: CliError) => e.exitCode === EXIT.auth && e.code === "not-signed-in"
    );
    await assert.rejects(
      new ApiClient("http://127.0.0.1:1", "k").get("/api/v1/ok"),
      (e: CliError) => e.code === "unreachable" && e.exitCode === EXIT.error
    );
  } finally {
    server.close();
  }
});

test("markets and accounts resolve exactly, across pages; ambiguity lists candidates; nothing is guessed", async () => {
  const server = await stub(directory);
  const client = new ApiClient(server.origin, "qbk_key");
  try {
    assert.equal(
      (await resolveMarket(client, { symbol: "GBPUSD" })).id,
      "m-gbp",
      "a symbol alone when unique"
    );
    assert.equal(
      (await resolveMarket(client, { symbol: "EURUSD", broker: "Real-Broker" }))
        .id,
      "m-real"
    );
    await assert.rejects(
      resolveMarket(client, { symbol: "EURUSD" }),
      (e: CliError) => {
        assert.deepEqual(
          [e.exitCode, e.code],
          [EXIT.ambiguous, "ambiguous-market"]
        );
        assert.deepEqual(
          (e.details as any).candidates.map((c: any) => c.marketId),
          ["m-demo", "m-real"]
        );
        return true;
      }
    );
    await assert.rejects(
      resolveMarket(client, { symbol: "eurusd" }),
      (e: CliError) => e.exitCode === EXIT.notFound
    );
    await assert.rejects(
      resolveMarket(client, { symbol: "EURUSD", broker: "Demo" }),
      (e: CliError) => e.exitCode === EXIT.notFound,
      "no substring broker match"
    );
    await assert.rejects(
      resolveMarket(client, { symbol: "EURUSD", marketId: "m-demo" }),
      (e: CliError) => e.exitCode === EXIT.usage
    );

    assert.equal(
      (await resolveAccount(client, "a-two")).id,
      "a-two",
      "an exact ID"
    );
    assert.equal(
      (await resolveAccount(client, "2002")).id,
      "a-two",
      "a login unique across broker servers"
    );
    assert.equal(
      (await resolveAccount(client, "1001", "Real-Broker")).id,
      "a-real"
    );
    await assert.rejects(
      resolveAccount(client, "1001"),
      (e: CliError) =>
        e.exitCode === EXIT.ambiguous &&
        (e.details as any).candidates.length === 2
    );
    await assert.rejects(
      resolveAccount(client, "a-two", "Real-Broker"),
      (e: CliError) => e.exitCode === EXIT.usage
    );
    await assert.rejects(
      resolveAccount(client, "100"),
      (e: CliError) => e.exitCode === EXIT.notFound,
      "no prefix match"
    );
    await assert.rejects(
      resolveAccount(client, undefined),
      (e: CliError) =>
        e.exitCode === EXIT.usage && /no default account/i.test(e.message)
    );
  } finally {
    server.close();
  }
});

/** Runs the CLI against `origin` with an API key and a scratch config. */
async function runner(origin: string) {
  const dir = await mkdtemp(join(tmpdir(), "mt4qb-cli-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MT4QB_SERVER: origin,
    MT4QB_API_KEY: "qbk_" + "a".repeat(64),
    MT4QB_CONFIG: join(dir, "config.json"),
  };
  const run = (args: string[], input?: string, extra: NodeJS.ProcessEnv = {}) =>
    new Promise<{ code: number | null; out: string; err: string }>(
      (resolve) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            import.meta.resolve("tsx"),
            join(process.cwd(), "src", "cli.ts"),
            ...args,
          ],
          { env: { ...env, ...extra }, cwd: dir }
        );
        let out = "";
        let err = "";
        child.stdout.on("data", (b) => (out += b));
        child.stderr.on("data", (b) => (err += b));
        child.on("close", (code) => resolve({ code, out, err }));
        child.stdin.end(input ?? "");
      }
    );
  return { run, dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test("mutations need explicit accounts and confirmation: refused arguments send nothing", async () => {
  const server = await stub(directory);
  const { run, cleanup } = await runner(server.origin);
  try {
    const id = "0123456789abcdef0123456789abcdef";
    const noConfirm = await run(["requests", "execute", id, "--json"]);
    assert.equal(noConfirm.code, EXIT.usage);
    assert.equal(noConfirm.out, "");
    assert.equal(JSON.parse(noConfirm.err).error.code, "usage");
    const noAccount = await run([
      "orders",
      "preview",
      "--symbol",
      "EURUSD",
      "--side",
      "buy",
      "--type",
      "market",
      "--lots",
      "0.1",
    ]);
    assert.equal(noAccount.code, EXIT.usage);
    assert.match(noAccount.err, /no default account/i);
    const noAck = await run([
      "requests",
      "review",
      id,
      "--note",
      "checked MetaTrader",
    ]);
    assert.equal(noAck.code, EXIT.usage);
    const badLots = await run([
      "orders",
      "preview",
      "--account",
      "a-demo",
      "--symbol",
      "EURUSD",
      "--side",
      "buy",
      "--type",
      "market",
      "--lots",
      "1e-1",
      "--json",
    ]);
    assert.equal(badLots.code, EXIT.usage);
    assert.equal(
      JSON.parse(badLots.err).error.code,
      "usage",
      "commander's errors become one JSON envelope"
    );
    const nothingToChange = await run([
      "positions",
      "modify",
      "123",
      "--account",
      "a-demo",
    ]);
    assert.equal(nothingToChange.code, EXIT.usage);
    const badTicket = await run([
      "positions",
      "close",
      "12a",
      "--account",
      "a-demo",
    ]);
    assert.equal(badTicket.code, EXIT.usage);
    const noYes = await run(["orders", "preview", "--yes"]);
    assert.equal(noYes.code, EXIT.usage, "there is no --yes flow");
    assert.ok(
      !server.seen.some((s) => s.startsWith("POST")),
      `nothing was posted: ${server.seen.join("; ")}`
    );
    const help = await run(["--help"]);
    assert.equal(help.code, 0);
    assert.match(help.out, /13  export file exists/);
    assert.equal(help.err, "");
  } finally {
    server.close();
    await cleanup();
  }
});

test("execute posts once, then only reads the request; unknown exits 10 with review guidance", async () => {
  const id = "0123456789abcdef0123456789abcdef";
  let reads = 0;
  const record = (status: string) => ({
    data: {
      requestId: id,
      status,
      reviewed: false,
      accountId: "a-demo",
      normalizedIntent: {
        action: "place",
        side: "buy",
        type: "market",
        lots: "0.1",
        symbol: "EURUSD",
      },
      result: null,
      warnings: [],
    },
    meta: {},
  });
  const server = await stub((req, _body, send) => {
    if (req.method === "POST") return send(202, record("dispatching"));
    reads++;
    send(200, record(reads < 3 ? "dispatching" : "unknown"));
  });
  const { run, cleanup } = await runner(server.origin);
  try {
    const r = await run(["requests", "execute", id, "--confirm"]);
    assert.equal(r.code, EXIT.unknown, r.err);
    assert.match(r.err, /UNKNOWN.*requests review/s);
    assert.equal(
      server.seen.filter((s) => s.startsWith("POST")).length,
      1,
      "posted exactly once, never retried"
    );
    assert.deepEqual(
      server.seen.filter((s) => s.startsWith("POST")),
      [`POST /api/v1/requests/${id}/execute {"confirm":true}`]
    );
    const json = await run(["requests", "show", id, "--json"]);
    assert.equal(json.code, EXIT.unknown);
    assert.equal(JSON.parse(json.out).data.status, "unknown");
    assert.equal(
      json.err,
      "",
      "with --json, stdout has the envelope and stderr stays empty"
    );
  } finally {
    server.close();
    await cleanup();
  }
});

test("auth login takes only an API key, verifies it and saves its new scope name; config show never prints it", async () => {
  const key = "qbk_" + "ab".repeat(32);
  const server = await stub((req, _body, send) => {
    if (req.url === "/api/v1/info")
      return send(200, {
        data: { service: "mt4-quote-bridge", apiVersion: 1 },
        meta: {},
      });
    if (
      req.url === "/api/auth/session" &&
      req.headers.authorization === `Bearer ${key}`
    )
      return send(200, {
        username: "owner",
        key: { name: "laptop", prefix: key.slice(0, 12), scope: "trader" },
        expires: null,
      });
    send(401, {
      error: {
        code: "unauthenticated",
        message: "Send an API key.",
        details: null,
      },
    });
  });
  const { run, dir, cleanup } = await runner(server.origin);
  const signedOut = { MT4QB_API_KEY: "", MT4QB_SERVER: "" };
  try {
    const bad = await run(
      ["auth", "login", "-s", server.origin, "--api-key-stdin"],
      "not-a-key\n",
      signedOut
    );
    assert.equal(bad.code, EXIT.auth);
    const revoked = await run(
      ["auth", "login", "-s", server.origin, "--api-key-stdin"],
      "qbk_" + "0".repeat(64) + "\n",
      signedOut
    );
    assert.equal(revoked.code, EXIT.auth);
    const ok = await run(
      ["auth", "login", "-s", server.origin, "--api-key-stdin"],
      key + "\n",
      signedOut
    );
    assert.equal(ok.code, 0, ok.err);
    assert.match(ok.out, /"laptop" \(trader/);
    const saved = JSON.parse(await readFile(join(dir, "config.json"), "utf8"));
    assert.deepEqual(
      [saved.server, saved.token, saved.scope],
      [server.origin, key, "trader"]
    );
    const shown = await run(["config", "show", "--json"], undefined, signedOut);
    assert.equal(shown.code, 0);
    assert.ok(!shown.out.includes(key), "the key is never printed");
    assert.equal(JSON.parse(shown.out).data.apiKey, "config file");
  } finally {
    server.close();
    await cleanup();
  }
});
