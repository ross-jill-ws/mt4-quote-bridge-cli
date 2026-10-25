// Acceptance: the CLI as a child process against the real QuoteBridge app (server, database, HTTP) with simulated EAs
// over real ZeroMQ. Uses the product repository's test fixtures (QUOTEBRIDGE_REPO, default ../metatrader-quote-bridge).
// Synthetic accounts only: no MetaTrader terminal or broker is involved, and no real order is sent.
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repo = resolve(
  process.env.QUOTEBRIDGE_REPO ??
    join(process.cwd(), "..", "metatrader-quote-bridge")
);
const present =
  existsSync(join(repo, "tests", "rest-fixtures.ts")) &&
  existsSync(join(repo, "scripts", "dev", "fake-accounts.ts"));
const product = (path: string) => import(pathToFileURL(join(repo, path)).href);

type Run = { code: number | null; out: string; err: string; json: any };

const DEMO_LOGIN = "50012345";
const SECOND_LOGIN = "50067890";

test(
  "the CLI against the app with simulated EAs",
  {
    skip: present
      ? false
      : `QuoteBridge repository not found at ${repo}; set QUOTEBRIDGE_REPO`,
    timeout: 300_000,
  },
  async (t) => {
    const fx = await product("tests/rest-fixtures.ts");
    const { deliver } = await product("tests/account-fixtures.ts");
    const { FakeAccount } = await product("scripts/dev/fake-accounts.ts");
    const { bars, writeHst } = await product("tests/hst-fixtures.ts");
    const { DEMO, REAL, HOUR, MIDNIGHT, TERMINAL, OTHER_TERMINAL } = fx;

    const scratch = await mkdtemp(join(tmpdir(), "mt4qb-cli-acceptance-"));
    t.after(() => rm(scratch, { recursive: true, force: true }));
    const data = join(scratch, "terminal-data");
    await writeHst(data, DEMO, {
      version: 401,
      symbol: "EURUSD",
      minutes: 60,
      digits: 5,
      bars: bars(MIDNIGHT - 10 * HOUR, HOUR, 10),
    });
    const app = await fx.startRest(t, await fx.tempFolder(t, "cli-db"), {
      trading: true,
      dataFolders: { [TERMINAL]: data },
    });
    const brokerNow = () => Math.floor(app.clock.now() / 1000) + 2 * HOUR;
    const quotes: Record<string, { bid: number; ask: number; digits: number }> =
      {
        EURUSD: { bid: 1.1, ask: 1.10012, digits: 5 },
        GBPUSD: { bid: 1.27, ask: 1.27015, digits: 5 },
      };

    /** A chart with a simulated account: announces it after its hello and answers V, P and X itself. */
    const chart = async (
      terminal: string,
      broker: string,
      spec: Record<string, unknown>,
      ticketBase: number
    ) => {
      const account = new FakeAccount(
        {
          currency: "USD",
          demo: true,
          enabled: true,
          ready: true,
          maxLots: "0.5",
          balance: 10000,
          leverage: 100,
          trades: [],
          ...spec,
        },
        (symbol: string) => quotes[symbol],
        brokerNow,
        ticketBase
      );
      let ea: any;
      /** When set, the next execution (X) is refused as the broker would, instead of reaching FakeAccount. */
      const refusal: { next?: { code: number; text: string } } = {};
      ea = await app.connect({
        terminal,
        broker,
        symbol: "EURUSD",
        bars: () => "loading",
        commands: (m: string) => {
          const refuse = refusal.next;
          if (!refuse || !m.startsWith("X|")) return account.handle(ea, m);
          refusal.next = undefined;
          const [, , , request, login] = m.split("|");
          setTimeout(
            () =>
              void ea
                .send(
                  `X|1|${ea.session}|${request}|${login}|rejected|0|${refuse.code}|${refuse.text}`
                )
                .catch(() => {}),
            100
          );
        },
      });
      const announce = async () => {
        await ea.send(ea.helloWire());
        await deliver(app.server.bridge, ea, account.announceWire(ea));
      };
      await deliver(app.server.bridge, ea, account.announceWire(ea));
      await app.quote(ea, [
        { seq: 1, bid: 1.1, ask: 1.10012, quoteTime: brokerNow() },
      ]);
      return { ea, account, announce, refusal };
    };
    const main = await chart(
      TERMINAL,
      DEMO,
      {
        login: DEMO_LOGIN,
        trades: [
          {
            kind: 0,
            symbol: "EURUSD",
            lots: 0.2,
            openPrice: 1.0815,
            stopLoss: 1.0765,
            takeProfit: 0,
            expiration: 0,
            magic: 0,
          },
          {
            kind: 2,
            symbol: "GBPUSD",
            lots: 0.1,
            openPrice: 1.265,
            stopLoss: 1.26,
            takeProfit: 1.275,
            expiration: 0,
            magic: 27012026,
          },
        ],
      },
      81_000_000
    );
    const second = await chart(
      OTHER_TERMINAL,
      DEMO,
      { login: SECOND_LOGIN, currency: "EUR", maxLots: "1" },
      82_000_000
    );
    // A real account on another broker server with the same login, and the same symbol: both are ambiguous bare.
    const real = await chart(
      "mt4-cccccccccccc",
      REAL,
      { login: DEMO_LOGIN, demo: false, enabled: true },
      83_000_000
    );

    const config = join(scratch, "config.json");
    const cli = (args: string[], key: string = app.traderKey) =>
      new Promise<Run>((done) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            import.meta.resolve("tsx"),
            join(process.cwd(), "src", "cli.ts"),
            ...args,
          ],
          {
            env: {
              ...process.env,
              MT4QB_SERVER: app.origin,
              MT4QB_API_KEY: key,
              MT4QB_CONFIG: config,
            },
            cwd: scratch,
          }
        );
        let out = "";
        let err = "";
        child.stdout.on("data", (b) => (out += b));
        child.stderr.on("data", (b) => (err += b));
        child.on("close", (code) => {
          let json: any;
          try {
            json = JSON.parse(args.includes("--json") ? out || err : "");
          } catch {
            json = undefined;
          }
          done({ code, out, err, json });
        });
      });
    /** Asserts the exit code; with --json, success is the envelope on stdout and nothing on stderr. */
    const ok = async (args: string[], key?: string) => {
      const r = await cli(args, key);
      assert.equal(r.code, 0, `${args.join(" ")}: ${r.err}`);
      if (args.includes("--json")) {
        assert.equal(r.err, "", `${args.join(" ")} wrote to stderr`);
        assert.ok(
          r.json && "data" in r.json && "meta" in r.json,
          "a REST envelope"
        );
      }
      return r;
    };
    const fails = async (
      args: string[],
      code: number,
      errorCode?: string,
      key?: string
    ) => {
      const r = await cli([...args, "--json"], key);
      assert.equal(r.code, code, `${args.join(" ")}: ${r.err}`);
      assert.equal(r.out, "", "errors never reach stdout");
      const envelope = JSON.parse(r.err);
      assert.equal(typeof envelope.error.message, "string");
      if (errorCode) assert.equal(envelope.error.code, errorCode);
      return envelope.error;
    };

    const accounts = (await ok(["accounts", "list", "--json"])).json
      .data as any[];
    const mainId = accounts.find(
      (a) => a.login === DEMO_LOGIN && a.brokerServer === DEMO
    ).id;
    const secondId = accounts.find((a) => a.login === SECOND_LOGIN).id;
    const realId = accounts.find((a) => a.brokerServer === REAL).id;
    /** Every request the subtests executed (dispatched), so the journal can be checked exactly. */
    const executedIds: string[] = [];

    await t.test(
      "read families: markets, accounts, positions, orders, indicators, terminals",
      async () => {
        const list = await ok(["markets", "list", "--json"]);
        assert.ok(
          list.json.data.some(
            (m: any) => m.symbol === "EURUSD" && m.brokerServer === DEMO
          )
        );
        const quote = await ok([
          "markets",
          "quote",
          "EURUSD",
          "--broker",
          DEMO,
          "--json",
        ]);
        assert.deepEqual(
          [quote.json.data.bid, quote.json.data.brokerServer],
          ["1.10000", DEMO]
        );
        const human = await ok([
          "markets",
          "quote",
          "EURUSD",
          "--broker",
          DEMO,
        ]);
        assert.match(human.out, /Bid:\s+1\.10000/);
        const marketId = quote.json.data.marketId;
        assert.equal(
          (await ok(["markets", "show", "--market-id", marketId, "--json"]))
            .json.data.id,
          marketId
        );
        const candles = await ok([
          "markets",
          "candles",
          "EURUSD",
          "--broker",
          DEMO,
          "--timeframe",
          "H1",
          "--limit",
          "3",
          "--json",
        ]);
        assert.equal(candles.json.meta.timeframe, "H1");
        assert.ok(candles.json.data.length >= 1);
        const history = await ok([
          "markets",
          "history",
          "EURUSD",
          "--broker",
          DEMO,
          "--json",
        ]);
        assert.equal(
          history.json.data.timeframes.find((x: any) => x.timeframe === "H1")
            .bars,
          10
        );
        await ok(["markets", "samples", "EURUSD", "--broker", DEMO, "--json"]);
        const indicators = await ok(["indicators", "list", "--json"]);
        assert.ok(
          indicators.json.data.some((p: any) => p.id === "quotebridge.ma")
        );
        assert.equal(
          (await ok(["indicators", "show", "quotebridge.ma", "--json"])).json
            .data.id,
          "quotebridge.ma"
        );
        const values = await ok([
          "markets",
          "indicator",
          "quotebridge.ma",
          "EURUSD",
          "--broker",
          DEMO,
          "--timeframe",
          "H1",
          "--param",
          "period=2",
          "--limit",
          "2",
          "--json",
        ]);
        assert.equal(values.json.meta.parameters.period, 2);

        assert.equal(
          (await ok(["accounts", "show", "--account", mainId, "--json"])).json
            .data.executor.state,
          "ready"
        );
        const funds = await ok([
          "accounts",
          "funds",
          "--account",
          DEMO_LOGIN,
          "--broker",
          DEMO,
          "--json",
        ]);
        assert.deepEqual(
          [
            funds.json.data.accountId,
            funds.json.data.balance,
            funds.json.data.currency,
          ],
          [mainId, "10000", "USD"]
        );
        const conditions = await ok([
          "accounts",
          "conditions",
          "EURUSD",
          "--account",
          mainId,
          "--json",
        ]);
        assert.deepEqual(
          [conditions.json.data.minLots, conditions.json.data.lotStep],
          ["0.01", "0.01"]
        );
        const positions = await ok([
          "positions",
          "list",
          "--account",
          mainId,
          "--json",
        ]);
        assert.deepEqual(
          positions.json.data.map((p: any) => [p.symbol, p.side, p.magic]),
          [["EURUSD", "buy", 0]]
        );
        const ticket = positions.json.data[0].ticket;
        assert.equal(
          (
            await ok([
              "positions",
              "show",
              ticket,
              "--account",
              mainId,
              "--json",
            ])
          ).json.data.ticket,
          ticket
        );
        const orders = await ok([
          "orders",
          "list",
          "--account",
          mainId,
          "--json",
        ]);
        assert.deepEqual(
          orders.json.data.map((o: any) => [o.symbol, o.type]),
          [["GBPUSD", "limit"]]
        );
        const table = await ok(["positions", "list", "--account", mainId]);
        assert.match(table.out, /outside/);

        const terminals = await ok(["terminals", "list", "--json"]);
        assert.ok(terminals.json.data.some((x: any) => x.id === TERMINAL));
        assert.equal(
          (await ok(["terminals", "show", TERMINAL, "--json"])).json.data.id,
          TERMINAL
        );
        const feeds = await ok(["terminals", "feeds", TERMINAL, "--json"]);
        assert.equal(
          (
            await ok([
              "terminals",
              "feeds",
              TERMINAL,
              feeds.json.data[0].id,
              "--json",
            ])
          ).json.data.terminalId,
          TERMINAL
        );
      }
    );

    await t.test(
      "exact identity: ambiguity lists candidates and fails; nothing is guessed",
      async () => {
        const market = await fails(
          ["markets", "quote", "EURUSD"],
          6,
          "ambiguous-market"
        );
        assert.deepEqual(
          market.details.candidates.map((c: any) => c.brokerServer).sort(),
          [DEMO, REAL].sort()
        );
        const human = await cli(["markets", "quote", "EURUSD"]);
        assert.equal(human.code, 6);
        assert.match(human.err, new RegExp(`${REAL}`));
        await fails(
          ["markets", "quote", "eurusd", "--broker", DEMO],
          5,
          "unknown-market"
        );
        await fails(
          ["markets", "quote", "EURUSD", "--broker", "EasyForex"],
          5,
          "unknown-market"
        );
        const login = await fails(
          ["accounts", "funds", "--account", DEMO_LOGIN],
          6,
          "ambiguous-account"
        );
        assert.equal(login.details.candidates.length, 2);
        await fails(["accounts", "funds"], 2, "usage");
        await fails(
          [
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
          ],
          2,
          "usage"
        );
        // The account fixes the broker server: the second account's EURUSD resolves on Demo even though Real has one too.
        assert.equal(
          (
            await ok([
              "accounts",
              "conditions",
              "EURUSD",
              "--account",
              secondId,
              "--json",
            ])
          ).json.data.accountId,
          secondId
        );
      }
    );

    await t.test(
      "readonly keys read but cannot preview, execute or review",
      async () => {
        await ok(["accounts", "list", "--json"], app.readonlyKey);
        await fails(
          [
            "orders",
            "preview",
            "--account",
            mainId,
            "--symbol",
            "EURUSD",
            "--side",
            "buy",
            "--type",
            "market",
            "--lots",
            "0.1",
          ],
          4,
          "insufficient-scope",
          app.readonlyKey
        );
        await fails(
          ["requests", "execute", "f".repeat(32), "--confirm"],
          4,
          "insufficient-scope",
          app.readonlyKey
        );
        await fails(
          [
            "requests",
            "review",
            "f".repeat(32),
            "--note",
            "checked MT4 history",
            "--acknowledge",
          ],
          4,
          "insufficient-scope",
          app.readonlyKey
        );
        await fails(
          ["accounts", "list"],
          3,
          "unauthenticated",
          "qbk_" + "0".repeat(64)
        );
      }
    );

    await t.test(
      "place, execute and status; two accounts route independently; execute needs --confirm",
      async () => {
        const preview = await ok([
          "orders",
          "preview",
          "--account",
          secondId,
          "--symbol",
          "EURUSD",
          "--side",
          "sell",
          "--type",
          "market",
          "--lots",
          "0.10",
          "--json",
        ]);
        const p = preview.json.data;
        assert.deepEqual(
          [
            p.status,
            p.accountId,
            p.terminalId,
            p.normalizedIntent.side,
            p.limits.ea,
          ],
          ["preview", secondId, OTHER_TERMINAL, "sell", "1"]
        );
        const unconfirmed = await fails(
          ["requests", "execute", p.requestId],
          2,
          "usage"
        );
        assert.match(unconfirmed.message, /Nothing was sent/);
        assert.equal(
          (await ok(["requests", "show", p.requestId, "--json"])).json.data
            .status,
          "preview",
          "still an unsent preview"
        );
        const executed = await ok([
          "requests",
          "execute",
          p.requestId,
          "--confirm",
          "--json",
        ]);
        executedIds.push(p.requestId);
        assert.equal(executed.json.data.status, "succeeded");
        assert.ok(executed.json.data.result.ticket);
        const again = await ok([
          "requests",
          "execute",
          p.requestId,
          "--confirm",
          "--json",
        ]);
        assert.deepEqual(
          again.json.data.result,
          executed.json.data.result,
          "a repeat answers the same record and sends nothing"
        );
        const placed = (
          await ok(["positions", "list", "--account", secondId, "--json"])
        ).json.data;
        assert.deepEqual(
          placed.map((x: any) => x.ticket),
          [executed.json.data.result.ticket]
        );
        assert.equal(
          (await ok(["positions", "list", "--account", mainId, "--json"])).json
            .data.length,
          1,
          "the other account is untouched"
        );
        const human = await ok([
          "orders",
          "preview",
          "--account",
          mainId,
          "--symbol",
          "EURUSD",
          "--side",
          "buy",
          "--type",
          "market",
          "--lots",
          "0.05",
        ]);
        assert.match(human.out, /buy market 0\.05 EURUSD/);
        assert.match(
          human.err,
          /Nothing was sent.*\n.*requests execute [0-9a-f]{32} --confirm/
        );
        await fails(
          [
            "orders",
            "preview",
            "--account",
            realId,
            "--symbol",
            "EURUSD",
            "--side",
            "buy",
            "--type",
            "market",
            "--lots",
            "0.05",
          ],
          7,
          "executor-real-account"
        );
        await fails(
          [
            "orders",
            "preview",
            "--account",
            mainId,
            "--market-id",
            p.marketId.replace(/./, "x"),
            "--side",
            "buy",
            "--type",
            "market",
            "--lots",
            "0.05",
          ],
          5
        );
        const realEurusd = (
          await ok(["markets", "list", "--broker", REAL, "--json"])
        ).json.data[0].id;
        await fails(
          [
            "orders",
            "preview",
            "--account",
            mainId,
            "--market-id",
            realEurusd,
            "--side",
            "buy",
            "--type",
            "market",
            "--lots",
            "0.05",
          ],
          7,
          "cross-broker-market"
        );
        await fails(
          [
            "orders",
            "preview",
            "--account",
            mainId,
            "--symbol",
            "EURUSD",
            "--side",
            "buy",
            "--type",
            "market",
            "--lots",
            "0.7",
          ],
          8
        );
      }
    );

    await t.test(
      "a request MetaTrader refuses fails definitively: exit 11, the broker's code kept, nothing changed",
      async () => {
        const before = (
          await ok(["positions", "list", "--account", secondId, "--json"])
        ).json.data;
        const preview = await ok([
          "orders",
          "preview",
          "--account",
          secondId,
          "--symbol",
          "EURUSD",
          "--side",
          "buy",
          "--type",
          "market",
          "--lots",
          "0.05",
          "--json",
        ]);
        const id = preview.json.data.requestId;
        second.refusal.next = { code: 134, text: "Not enough money" };
        const refused = await cli([
          "requests",
          "execute",
          id,
          "--confirm",
          "--json",
        ]);
        executedIds.push(id);
        assert.equal(refused.code, 11, refused.err);
        assert.equal(refused.err, "", "with --json, stderr stays empty");
        assert.equal(refused.json.data.status, "failed");
        assert.deepEqual(
          [refused.json.data.result.code, refused.json.data.result.message],
          [134, "Not enough money"],
          "the broker's code and message are kept"
        );
        const human = await cli(["requests", "show", id]);
        assert.equal(human.code, 11);
        assert.match(human.err, /MetaTrader refused it; nothing was changed/);
        assert.deepEqual(
          (await ok(["positions", "list", "--account", secondId, "--json"]))
            .json.data,
          before,
          "a refused order opens nothing"
        );
      }
    );

    await t.test(
      "modify, close and cancel previews are account-qualified; pending orders take a risk plan",
      async () => {
        /** The account's trades and the journal, to show that previews change nothing. */
        const state = async () => ({
          positions: (
            await ok(["positions", "list", "--account", mainId, "--json"])
          ).json.data,
          orders: (await ok(["orders", "list", "--account", mainId, "--json"]))
            .json.data,
          journal: (
            await ok(["requests", "list", "--all", "--json"])
          ).json.data.map((r: any) => r.requestId),
        });
        const unchanged = await state();
        const [position] = unchanged.positions;
        const modify = await ok([
          "positions",
          "modify",
          position.ticket,
          "--account",
          mainId,
          "--sl",
          "none",
          "--tp",
          "1.2",
          "--json",
        ]);
        assert.deepEqual(
          [
            modify.json.data.normalizedIntent.action,
            modify.json.data.normalizedIntent.stopLoss,
            modify.json.data.normalizedIntent.takeProfit,
          ],
          ["modify", null, "1.2"]
        );
        assert.ok(
          modify.json.data.warnings.includes(
            "This trade was created outside QuoteBridge."
          )
        );
        await fails(
          ["positions", "modify", position.ticket, "--account", mainId],
          2,
          "usage"
        );
        const close = await ok([
          "positions",
          "close",
          position.ticket,
          "--account",
          mainId,
          "--json",
        ]);
        assert.equal(close.json.data.target.ticket, position.ticket);
        await fails(
          ["positions", "close", position.ticket, "--account", secondId],
          7,
          "target-unavailable"
        );
        const [pending] = (
          await ok(["orders", "list", "--account", mainId, "--json"])
        ).json.data;
        const changed = await ok([
          "orders",
          "modify",
          pending.ticket,
          "--account",
          mainId,
          "--price",
          "1.262",
          "--json",
        ]);
        assert.equal(changed.json.data.normalizedIntent.price, "1.262");
        const cancel = await ok([
          "orders",
          "cancel",
          pending.ticket,
          "--account",
          mainId,
          "--json",
        ]);
        assert.equal(cancel.json.data.normalizedIntent.action, "cancel");
        const risk = await ok([
          "orders",
          "preview",
          "--account",
          mainId,
          "--symbol",
          "EURUSD",
          "--side",
          "buy",
          "--type",
          "limit",
          "--price",
          "1.09",
          "--lots",
          "0.1",
          "--risk-points",
          "200",
          "--reward-ratio",
          "2",
          "--json",
        ]);
        assert.deepEqual(
          [
            risk.json.data.normalizedIntent.stopLoss,
            risk.json.data.normalizedIntent.takeProfit,
          ],
          ["1.088", "1.094"]
        );
        await fails(
          [
            "orders",
            "preview",
            "--account",
            mainId,
            "--symbol",
            "EURUSD",
            "--side",
            "buy",
            "--type",
            "market",
            "--lots",
            "0.1",
            "--risk-points",
            "200",
          ],
          2,
          "usage"
        );
        assert.deepEqual(
          await state(),
          unchanged,
          "modify, close, cancel and place previews sent nothing: trades and journal are as they were"
        );
      }
    );

    await t.test(
      "an unanswered execution is unknown: exit 10, never retried, blocks only its account until reviewed",
      async () => {
        const preview = await ok([
          "orders",
          "preview",
          "--account",
          mainId,
          "--symbol",
          "EURUSD",
          "--side",
          "buy",
          "--type",
          "market",
          "--lots",
          "0.07",
          "--json",
        ]);
        const id = preview.json.data.requestId;
        executedIds.push(id);
        const sent = await cli([
          "requests",
          "execute",
          id,
          "--confirm",
          "--wait",
          "1",
        ]);
        assert.equal(sent.code, 12, sent.err);
        assert.match(sent.err, /Do not execute it again/);
        app.clock.advance(21_000);
        // Bring every chart back after the jump, as their periodic hellos would.
        for (const c of [main, second, real]) await c.announce();
        let show: Run;
        for (let i = 0; ; i++) {
          show = await cli(["requests", "show", id, "--json"]);
          if (show.code !== 12 || i > 20) break;
          await new Promise((r) => setTimeout(r, 250));
        }
        assert.equal(show.code, 10);
        assert.equal(show.json.data.status, "unknown");
        const human = await cli(["requests", "show", id]);
        assert.match(human.err, /UNKNOWN.*Do not execute, retry or preview/s);
        // A repeated execute answers the existing unknown record and sends nothing.
        const repeat = await cli([
          "requests",
          "execute",
          id,
          "--confirm",
          "--json",
        ]);
        assert.deepEqual(
          [repeat.code, repeat.json?.data.status],
          [10, "unknown"]
        );
        // The blocked account cannot even preview, so no execute command is offered for it.
        await fails(
          [
            "orders",
            "preview",
            "--account",
            mainId,
            "--symbol",
            "EURUSD",
            "--side",
            "buy",
            "--type",
            "market",
            "--lots",
            "0.05",
          ],
          7,
          "account-unresolved"
        );
        const other = await ok([
          "orders",
          "preview",
          "--account",
          secondId,
          "--symbol",
          "EURUSD",
          "--side",
          "buy",
          "--type",
          "market",
          "--lots",
          "0.05",
          "--json",
        ]);
        executedIds.push(other.json.data.requestId);
        assert.equal(
          (
            await ok([
              "requests",
              "execute",
              other.json.data.requestId,
              "--confirm",
              "--json",
            ])
          ).json.data.status,
          "succeeded",
          "another account is independent"
        );
        await fails(
          ["requests", "review", id, "--note", "checked MT4 history"],
          2,
          "usage"
        );
        await fails(
          ["requests", "review", id, "--note", "short", "--acknowledge"],
          8,
          "invalid-review"
        );
        const reviewed = await ok([
          "requests",
          "review",
          id,
          "--note",
          "Checked MT4 open orders and history: not filled",
          "--acknowledge",
          "--json",
        ]);
        assert.deepEqual(
          [reviewed.json.data.status, reviewed.json.data.reviewed],
          ["unknown", true]
        );
        assert.equal(
          (await cli(["requests", "show", id])).code,
          0,
          "a reviewed unknown is settled for the CLI"
        );
      }
    );

    await t.test("journal pagination with cursors and --all", async () => {
      const all = await ok(["requests", "list", "--all", "--json"]);
      // Exactly the executed requests: no preview, refused admission or repeat execute is journaled.
      assert.deepEqual(
        all.json.data.map((r: any) => r.requestId).sort(),
        [...executedIds].sort()
      );
      assert.equal(executedIds.length, 4);
      assert.equal(all.json.meta.nextCursor, null);
      const first = await ok(["requests", "list", "--limit", "1", "--json"]);
      assert.equal(first.json.data.length, 1);
      const next = await ok([
        "requests",
        "list",
        "--limit",
        "1",
        "--cursor",
        first.json.meta.nextCursor,
        "--json",
      ]);
      assert.equal(next.json.data[0].requestId, all.json.data[1].requestId);
      const human = await ok(["requests", "list", "--limit", "1"]);
      assert.match(human.err, /More: add --cursor/);
      const mine = await ok([
        "requests",
        "list",
        "--account",
        secondId,
        "--all",
        "--json",
      ]);
      assert.ok(mine.json.data.every((r: any) => r.accountId === secondId));
      await fails(
        ["requests", "list", "--all", "--cursor", first.json.meta.nextCursor],
        2,
        "usage"
      );
    });

    await t.test(
      "exports write a file, never overwrite silently, and --json reports metadata",
      async () => {
        const file = join(scratch, "eurusd.csv");
        const saved = await ok([
          "markets",
          "export",
          "EURUSD",
          "--broker",
          DEMO,
          "--timeframe",
          "H1",
          "--format",
          "csv",
          "--output",
          file,
          "--json",
        ]);
        const text = await readFile(file, "utf8");
        assert.match(text, /^time,open,high,low,close/);
        assert.deepEqual(
          [saved.json.data.path, saved.json.data.bytes],
          [file, Buffer.byteLength(text)]
        );
        assert.ok(
          !saved.out.includes("time,open"),
          "stdout carries metadata, not the file"
        );
        await writeFile(file, "keep me");
        const exists = await fails(
          [
            "markets",
            "export",
            "EURUSD",
            "--broker",
            DEMO,
            "--timeframe",
            "H1",
            "--format",
            "csv",
            "--output",
            file,
          ],
          13,
          "output-exists"
        );
        assert.equal(exists.details.path, file);
        assert.equal(await readFile(file, "utf8"), "keep me");
        await ok([
          "markets",
          "export",
          "EURUSD",
          "--broker",
          DEMO,
          "--timeframe",
          "H1",
          "--format",
          "hst",
          "--output",
          file,
          "--force",
        ]);
        assert.equal((await readFile(file)).readInt32LE(0), 401);
        await fails(
          [
            "markets",
            "export",
            "EURUSD",
            "--broker",
            DEMO,
            "--timeframe",
            "H1",
            "--format",
            "csv",
          ],
          2,
          "usage"
        );
        await fails(
          [
            "markets",
            "export",
            "EURUSD",
            "--broker",
            DEMO,
            "--timeframe",
            "M5",
            "--format",
            "csv",
            "--output",
            join(scratch, "none.csv"),
          ],
          5,
          "no-history"
        );
        assert.ok(
          !existsSync(join(scratch, "none.csv")),
          "a refused export leaves no file"
        );
      }
    );

    await t.test(
      "stale and offline sources are reported, never fabricated",
      async () => {
        app.clock.advance(30_000);
        const quote = await ok([
          "markets",
          "quote",
          "EURUSD",
          "--broker",
          DEMO,
          "--json",
        ]);
        assert.equal(quote.json.data.stale, true);
        assert.notEqual(quote.json.data.state, "connected");
        const account = (
          await ok(["accounts", "show", "--account", mainId, "--json"])
        ).json.data;
        assert.equal(account.connected, false);
        const funds = await ok([
          "accounts",
          "funds",
          "--account",
          mainId,
          "--json",
        ]);
        assert.equal(funds.json.data.state, "stale");
        await fails(
          ["accounts", "conditions", "EURUSD", "--account", mainId],
          9,
          "unavailable-source"
        );
        await fails(
          [
            "orders",
            "preview",
            "--account",
            mainId,
            "--symbol",
            "EURUSD",
            "--side",
            "buy",
            "--type",
            "market",
            "--lots",
            "0.05",
          ],
          7
        );
      }
    );
  }
);
