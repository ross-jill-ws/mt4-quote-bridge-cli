import { existsSync } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { Command } from "commander";
import { CliError, type ApiClient, type Envelope } from "../client.js";
import { emit, fields } from "../output.js";
import { resolveMarket, type MarketRef } from "../resolve.js";
import {
  api,
  describe,
  familyGuide,
  guide,
  jsonOption,
  MARKET_HELP,
  marketOptions,
  outputExists,
} from "./common.js";

/** A screenshot's health fields as the app answers them, beside the base64 PNG. */
type Shot = {
  view: "feeds" | "chart";
  marketId?: string;
  brokerServer?: string;
  symbol?: string;
  window: string;
  width: number;
  height: number;
  scale: number;
  live: string;
  capturedAt: string;
  contentType: string;
  png: string;
};
type ShotOptions = { json?: boolean; output?: string; force?: boolean };

/** The health table: what the window showed and how, never the image. */
const health = (s: Omit<Shot, "png">, saved: [string, unknown][] = []) =>
  fields([
    ["View", s.view],
    [
      "Market",
      s.symbol === undefined ? null : `${s.symbol} · ${s.brokerServer}`,
    ],
    ["Window", s.window],
    ["Live", s.live],
    ["Size", `${s.width} × ${s.height}`],
    ["Scale", s.scale],
    ["Time", s.capturedAt],
    ...saved,
  ]);

/** --json, --output and --force, with help on the output, the window and the refusals. */
const screenshotOptions = (cmd: Command) =>
  jsonOption(cmd)
    .option("--output <file>", "write the PNG to this file on this computer")
    .option("--force", "replace the output file if it exists")
    .addHelpText(
      "after",
      `
Output:
  A table of the window's health: view, market, window state (visible,
  minimised or hidden in the tray), live link, size, scale and capture time.
  --json prints the app's answer, the PNG in base64 included. --output writes
  the PNG on this computer, never replacing a file unless --force is given
  (exit 13; the window is not touched); with --json, stdout then gets the
  health fields plus path and bytes, without the base64.

    flags               stdout                           file
    (none)              health table                     -
    --json              health + png (base64) as JSON    -
    --output F          health table + Path, Bytes       F
    --output F --json   health + path, bytes as JSON     F

  Healthy looks like: Live "live" (else connecting, reconnecting or
  session-ended). To see the picture, open the --output file.

The app window:
  It is switched to the view and left there, and captured whether shown,
  minimised or in the tray, without being shown or focused. Only a trader key
  may take a screenshot. The app's refusals, in its own words:
    insufficient-scope  exit 4  a readonly key
    window-busy         exit 7  a dialog is open in the window; nothing taken
    no-feed             exit 7  (chart) no terminal streams the market
    window-unavailable  exit 9  no window to capture (app starting, recreated)
    screenshot-timeout  exit 9  not captured within ten seconds`
    );

/**
 * Writes the PNG, leaving no partial file: a new file is created only if none exists (exit 13 otherwise); with
 * --force, a temporary file beside it replaces it, so a failure never removes what was there.
 */
async function save(file: string, image: Buffer, force?: boolean) {
  const target = force ? `${file}.${process.pid}.tmp` : file;
  try {
    await writeFile(target, image, { flag: "wx" });
    if (force) await rename(target, file);
  } catch (e) {
    if (!force && (e as NodeJS.ErrnoException).code === "EEXIST")
      throw outputExists(file);
    await rm(target, { force: true }).catch(() => {});
    throw new CliError(`Cannot write ${file}: ${(e as Error).message}`);
  }
}

/** Takes the screenshot at `path` and prints it, or writes its PNG to --output. */
async function take(client: ApiClient, path: string, o: ShotOptions) {
  const file = o.output === undefined ? undefined : resolvePath(o.output);
  // Refuse before the app switches the trader's window for a file that could not be written.
  if (file !== undefined && !o.force && existsSync(file))
    throw outputExists(file);
  const envelope = await client.get<Shot>(path);
  if (file === undefined) {
    emit(o.json, envelope, () => health(envelope.data));
    return;
  }
  const { png, ...shot } = envelope.data;
  const image = Buffer.from(png, "base64");
  await save(file, image, o.force);
  emit(
    o.json,
    { data: { ...shot, path: file, bytes: image.length }, meta: envelope.meta },
    () =>
      health(shot, [
        ["Path", file],
        ["Bytes", image.length],
      ])
  );
}

export function screenshotCommand() {
  const screenshot = familyGuide(
    new Command("screenshot"),
    "capture the app window to check that it looks healthy (trader key; switches the window's view)",
    "A screenshot is of the user's own QuoteBridge window. It switches that window to Feeds or to a market's chart and leaves it there, so take one when someone asks to see the app or when data looks wrong, and say that the view changed. Read prices, candles and indicator values with the markets commands, never from a picture.",
    `feeds  the Feeds view: is every terminal's feed streaming, the live link up?
chart  one market's chart as the window draws it: candles, indicators, trades

Both need a trader key and print the window's health; --output FILE saves
the PNG. A dialog open in the window refuses with window-busy (exit 7).`,
    [
      "screenshot feeds",
      "screenshot feeds --output feeds.png",
      "screenshot chart EURUSD --broker EasyForex-Demo --output chart.png --json",
    ]
  );

  screenshot.addCommand(
    guide(
      screenshotOptions(
        describe(
          new Command("feeds"),
          "the app window on its Feeds view (GET /api/v1/screenshots/feeds)",
          "Use it to check that the app is running normally: every terminal's feeds listed and streaming, and the window's live link to the app up. The window is switched to Feeds and left there."
        )
      ),
      {
        examples: [
          "screenshot feeds",
          "screenshot feeds --output feeds.png",
          "screenshot feeds --output feeds.png --force --json",
        ],
        seeAlso: [
          "terminals list   (terminal health as data, without moving the window)",
        ],
      }
    ).action(async (o: ShotOptions) => {
      await take(await api(), "/api/v1/screenshots/feeds", o);
    })
  );

  screenshot.addCommand(
    guide(
      screenshotOptions(
        marketOptions(
          describe(
            new Command("chart"),
            "the app window on one market's chart, from its best source feed (GET /api/v1/screenshots/charts/{marketId})",
            "Use it to see one market's chart as the user's window draws it, from the market's best source feed: its remembered period, chart type, Ask line, indicators and trade lines. The image is taken once candles, indicator values and trades are drawn, or after six seconds with what the chart shows then. The window is left on that chart."
          ).argument("[symbol]", "exact symbol, e.g. EURUSD")
        )
      ).addHelpText("after", MARKET_HELP),
      {
        examples: [
          "screenshot chart EURUSD --broker EasyForex-Demo",
          "screenshot chart EURUSD --broker EasyForex-Demo --output eurusd.png",
          "screenshot chart --market-id <market-id> --output eurusd.png --force --json",
        ],
        seeAlso: [
          "markets candles SYMBOL --timeframe TF   (the bars as data)",
          "markets show SYMBOL   (is a terminal streaming it? no-feed otherwise)",
        ],
      }
    ).action(
      async (
        symbol: string | undefined,
        o: ShotOptions & Omit<MarketRef, "symbol">
      ) => {
        const client = await api();
        const market = await resolveMarket(client, {
          symbol,
          broker: o.broker,
          marketId: o.marketId,
        });
        await take(
          client,
          `/api/v1/screenshots/charts/${encodeURIComponent(market.id)}`,
          o
        );
      }
    )
  );
  return screenshot;
}
