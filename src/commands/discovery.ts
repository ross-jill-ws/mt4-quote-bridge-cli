// Indicator packages and terminal diagnostics: read-only discovery.
import { Command } from "commander";
import { emit, fields, table } from "../output.js";
import {
  api,
  describe,
  familyGuide,
  guide,
  jsonOption,
  listCollection,
  pageOptions,
} from "./common.js";

export function indicatorsCommand() {
  const indicators = familyGuide(
    new Command("indicators"),
    "enabled indicator packages (values: markets indicator)",
    "These commands describe packages; the values themselves come from markets indicator PACKAGE SYMBOL --timeframe TF.",
    `list  the enabled packages and their exact IDs (start here)
show  one package's parameters (type, default, range) and outputs

Then: mt4-quote-bridge markets indicator PACKAGE SYMBOL --timeframe TF
      [--param id=value]...`,
    [
      "indicators list",
      "indicators show quotebridge.macd",
      "markets indicator quotebridge.macd EURUSD --broker EasyForex-Demo --timeframe H1",
    ]
  );
  indicators.addCommand(
    guide(
      jsonOption(
        pageOptions(
          describe(
            new Command("list"),
            "list enabled indicator packages (GET /api/v1/indicators)",
            "Use it to find an indicator's exact package ID (quotebridge.macd, not macd) before markets indicator or indicators show. Only packages enabled in the app are listed."
          )
        )
      ),
      {
        output: `Table: PACKAGE ID, NAME, VERSION, PLACEMENT (overlay on the price chart,
or a separate pane).
--json: data is an array of packages, each as indicators show describes it.`,
        examples: ["indicators list", "indicators list --all --json"],
      }
    ).action(async (o) => {
      await listCollection(await api(), "/api/v1/indicators", {}, o, [
        { header: "PACKAGE ID", value: (p: any) => p.id },
        { header: "NAME", value: (p: any) => p.name },
        { header: "VERSION", value: (p: any) => p.version },
        { header: "PLACEMENT", value: (p: any) => p.placement },
      ]);
    })
  );
  indicators.addCommand(
    guide(
      jsonOption(
        describe(
          new Command("show"),
          "one package's parameters and outputs (GET /api/v1/indicators/{packageId})",
          "Use it before markets indicator to learn which --param ids a package takes, their defaults and allowed ranges or choices, and which outputs (columns) it answers. A disabled or unknown package exits 5."
        )
      ).argument("<packageId>", "exact package ID, e.g. quotebridge.macd"),
      {
        output: `Package (name, ID, version), Placement and Closed bars only; then a
PARAMETER / TYPE / DEFAULT / RANGE / CHOICES table and an OUTPUT / LABEL
table.
--json: data is { id, version, name, description, placement, closedBarsOnly,
parameters: [{ id, label, type, default, min, max } or { …, type: "choice",
choices: [{ value, label }] }], outputs: [{ id, label, render, styles }] }.`,
        examples: [
          "indicators show quotebridge.ma",
          "indicators show quotebridge.macd --json",
        ],
        seeAlso: [
          "markets indicator PACKAGE SYMBOL --timeframe TF --param id=value",
        ],
      }
    ).action(async (id: string, o) => {
      const envelope = await (
        await api()
      ).get(`/api/v1/indicators/${encodeURIComponent(id)}`);
      const p = envelope.data;
      emit(o.json, envelope, () =>
        [
          fields([
            ["Package", `${p.name} (${p.id} ${p.version})`],
            ["Placement", p.placement],
            ["Closed bars only", p.closedBarsOnly],
          ]),
          "",
          table(p.parameters, [
            { header: "PARAMETER", value: (x: any) => x.id },
            { header: "TYPE", value: (x: any) => x.type },
            { header: "DEFAULT", value: (x: any) => x.default },
            {
              header: "RANGE / CHOICES",
              value: (x: any) =>
                x.choices
                  ? x.choices.map((c: any) => c.value).join(" ")
                  : `${x.min}–${x.max}`,
            },
          ]),
          "",
          table(p.outputs, [
            { header: "OUTPUT", value: (x: any) => x.id },
            { header: "LABEL", value: (x: any) => x.label },
          ]),
        ].join("\n")
      );
    })
  );
  return indicators;
}

const FEED_COLUMNS = [
  { header: "SYMBOL", value: (f: any) => f.symbol },
  { header: "BROKER SERVER", value: (f: any) => f.brokerServer },
  {
    header: "ONLINE",
    value: (f: any) => (f.online ? (f.stale ? "stale" : "yes") : "no"),
  },
  { header: "BID", value: (f: any) => f.bid, align: "right" as const },
  { header: "ASK", value: (f: any) => f.ask, align: "right" as const },
  { header: "FEED ID", value: (f: any) => f.id },
];

export function terminalsCommand() {
  const terminals = familyGuide(
    new Command("terminals"),
    "read-only terminal diagnostics and their own feeds (never trade routing)",
    "A terminal is one running MT4 with the QuoteBridge EA; its feeds are its own charts. Reach for these when a market looks quiet or stale: market and account commands already pick the best source for you.",
    `list   every terminal the app has heard from, connected or not (start here)
show   one terminal: broker server, EA version, last hello, feed count
feeds  a terminal's own charts and their quotes, or one feed in full`,
    [
      "terminals list",
      "terminals show <terminal-id>",
      "terminals feeds <terminal-id>",
    ]
  );
  terminals.addCommand(
    guide(
      jsonOption(
        pageOptions(
          describe(
            new Command("list"),
            "terminals heard from (GET /api/v1/terminals)",
            "Use it to see which MT4 terminals are connected (a hello within the last seven seconds), which EA version each runs, and to get the terminal ID that terminals show and terminals feeds take."
          )
        )
      ),
      {
        output: `Table: TERMINAL ID, NAME, BROKER SERVER, EA, CONNECTED, FEEDS.
--json: data is an array of { id, name, brokerServer, eaVersion, connected,
lastHelloAt, feeds }.`,
        examples: ["terminals list", "terminals list --json"],
      }
    ).action(async (o) => {
      await listCollection(await api(), "/api/v1/terminals", {}, o, [
        { header: "TERMINAL ID", value: (t: any) => t.id },
        { header: "NAME", value: (t: any) => t.name },
        { header: "BROKER SERVER", value: (t: any) => t.brokerServer },
        { header: "EA", value: (t: any) => t.eaVersion },
        {
          header: "CONNECTED",
          value: (t: any) => (t.connected ? "yes" : "no"),
        },
        { header: "FEEDS", value: (t: any) => t.feeds, align: "right" },
      ]);
    })
  );
  terminals.addCommand(
    guide(
      jsonOption(
        describe(
          new Command("show"),
          "one terminal (GET /api/v1/terminals/{terminalId})",
          "Use it to check one terminal: whether it is connected, when it last said hello, which EA version it runs and how many feeds (charts) it has."
        )
      ).argument("<terminalId>", "exact terminal ID (see: terminals list)"),
      {
        output: `Terminal (name and ID), Broker server, EA version, Connected, Last hello
(UTC), Feeds.
--json: data is { id, name, brokerServer, eaVersion, connected, lastHelloAt,
feeds }.`,
        examples: [
          "terminals show <terminal-id>",
          "terminals show <terminal-id> --json",
        ],
        seeAlso: ["terminals feeds <terminal-id>"],
      }
    ).action(async (id: string, o) => {
      const envelope = await (
        await api()
      ).get(`/api/v1/terminals/${encodeURIComponent(id)}`);
      const t = envelope.data;
      emit(o.json, envelope, () =>
        fields([
          ["Terminal", `${t.name} (${t.id})`],
          ["Broker server", t.brokerServer],
          ["EA version", t.eaVersion],
          ["Connected", t.connected],
          ["Last hello (UTC)", t.lastHelloAt],
          ["Feeds", t.feeds],
        ])
      );
    })
  );
  terminals.addCommand(
    guide(
      jsonOption(
        pageOptions(
          describe(
            new Command("feeds"),
            "a terminal's feeds, or one feed (GET /api/v1/terminals/{terminalId}/feeds[/{feedId}])",
            "Use it to diagnose one terminal's charts: which symbols it streams, whether each is online or stale, and its latest bid/ask. These are that terminal's own quotes only, never used to route trading; for a market's best price, use markets quote."
          )
        )
      )
        .argument("<terminalId>", "exact terminal ID (see: terminals list)")
        .argument("[feedId]", "one feed's exact ID (see the list)"),
      {
        output: `Table: SYMBOL, BROKER SERVER, ONLINE (yes, stale or no), BID, ASK, FEED ID.
--json: data is an array of feeds (one feed, given feedId): { id, terminalId,
marketId, brokerServer, symbol, digits, timeframe, online, stale, instances,
quoteStatus, recording, bid, ask, time, brokerTime, receivedAt }.`,
        examples: [
          "terminals feeds <terminal-id>",
          `terminals feeds <terminal-id> '["<terminal-id>","EURUSD"]' --json`,
        ],
      }
    ).action(async (terminalId: string, feedId: string | undefined, o) => {
      const client = await api();
      const base = `/api/v1/terminals/${encodeURIComponent(terminalId)}/feeds`;
      if (feedId === undefined) {
        await listCollection(client, base, {}, o, FEED_COLUMNS);
        return;
      }
      const envelope = await client.get(
        `${base}/${encodeURIComponent(feedId)}`
      );
      emit(o.json, envelope, () => table([envelope.data], FEED_COLUMNS));
    })
  );
  return terminals;
}
