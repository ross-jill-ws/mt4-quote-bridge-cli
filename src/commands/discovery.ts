// Indicator packages and terminal diagnostics: read-only discovery.
import { Command } from "commander";
import { emit, fields, table } from "../output.js";
import { api, jsonOption, listCollection, pageOptions } from "./common.js";

export function indicatorsCommand() {
  const indicators = new Command("indicators").description(
    "enabled indicator packages (values: markets indicator)"
  );
  indicators.addCommand(
    jsonOption(pageOptions(new Command("list")))
      .description("list enabled indicator packages (GET /api/v1/indicators)")
      .action(async (o) => {
        await listCollection(await api(), "/api/v1/indicators", {}, o, [
          { header: "PACKAGE ID", value: (p: any) => p.id },
          { header: "NAME", value: (p: any) => p.name },
          { header: "VERSION", value: (p: any) => p.version },
          { header: "PLACEMENT", value: (p: any) => p.placement },
        ]);
      })
  );
  indicators.addCommand(
    jsonOption(new Command("show"))
      .description(
        "one package's parameters and outputs (GET /api/v1/indicators/{packageId})"
      )
      .argument("<packageId>", "exact package ID, e.g. quotebridge.macd")
      .action(async (id: string, o) => {
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
  const terminals = new Command("terminals").description(
    "read-only terminal diagnostics and their own feeds (never trade routing)"
  );
  terminals.addCommand(
    jsonOption(pageOptions(new Command("list")))
      .description("terminals heard from (GET /api/v1/terminals)")
      .action(async (o) => {
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
    jsonOption(new Command("show"))
      .description("one terminal (GET /api/v1/terminals/{terminalId})")
      .argument("<terminalId>")
      .action(async (id: string, o) => {
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
    jsonOption(pageOptions(new Command("feeds")))
      .description(
        "a terminal's feeds, or one feed (GET /api/v1/terminals/{terminalId}/feeds[/{feedId}])"
      )
      .argument("<terminalId>")
      .argument("[feedId]", "one feed's exact ID (see the list)")
      .action(async (terminalId: string, feedId: string | undefined, o) => {
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
