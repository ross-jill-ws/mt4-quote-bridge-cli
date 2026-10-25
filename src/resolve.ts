// Exact identity resolution: never fuzzy, never a saved default, never a guess. Ambiguity lists the candidates and fails.
import { ApiClient, CliError, EXIT, usage } from "./client.js";

export type Market = { id: string; brokerServer: string; symbol: string; label: string; digits: number; connected: boolean };
export type Account = { id: string; brokerServer: string; login: string; label: string; demo: boolean | null; connected: boolean; currency: string | null; executor: { state: string; terminalId: string | null } };

export class AmbiguityError extends CliError {
  constructor(message: string, code: string, candidates: unknown[]) {
    super(message, EXIT.ambiguous, code, { candidates });
  }
}

/** What names a market on the command line: `--market-id`, or a symbol with an optional exact `--broker`. */
export type MarketRef = { marketId?: string; symbol?: string; broker?: string };

/**
 * One market: by exact ID; else by exact symbol on the exact broker server; a symbol alone only when exactly one
 * broker server has it.
 */
export async function resolveMarket(client: ApiClient, ref: MarketRef): Promise<Market> {
  if (ref.marketId !== undefined) {
    if (ref.symbol !== undefined || ref.broker !== undefined) throw usage("Name the market either by --market-id or by SYMBOL with --broker, not both.");
    return (await client.get<Market>(`/api/v1/markets/${encodeURIComponent(ref.marketId)}`)).data;
  }
  if (ref.symbol === undefined) throw usage("Name the market: SYMBOL (with --broker <exact broker server> if several have it) or --market-id <id>.");
  const { data } = await client.all<Market>("/api/v1/markets", { symbol: ref.symbol, brokerServer: ref.broker });
  if (data.length === 1) return data[0];
  if (!data.length) {
    throw new CliError(
      ref.broker === undefined
        ? `No market is named exactly "${ref.symbol}". Names are exact and case-sensitive; list them with: mt4-quote-bridge markets list`
        : `No market "${ref.symbol}" on broker server "${ref.broker}". Both are exact; list them with: mt4-quote-bridge markets list --broker "${ref.broker}"`,
      EXIT.notFound,
      "unknown-market"
    );
  }
  throw new AmbiguityError(
    `"${ref.symbol}" is on ${data.length} broker servers. Add --broker <exact broker server> or use --market-id.`,
    "ambiguous-market",
    data.map((m) => ({ marketId: m.id, brokerServer: m.brokerServer, symbol: m.symbol }))
  );
}

/**
 * One trading account from `--account`: its exact ID, or a login on the exact `--broker`; a bare login only when one
 * broker server has it.
 */
export async function resolveAccount(client: ApiClient, account: string | undefined, broker?: string): Promise<Account> {
  if (account === undefined) throw usage("Name the account with --account <account-id>, or --account <login> --broker <exact broker server>. There is no default account.");
  const { data } = await client.all<Account>("/api/v1/accounts");
  const byId = data.find((a) => a.id === account);
  if (byId) {
    if (broker !== undefined && byId.brokerServer !== broker) throw usage(`Account ${account} is on broker server "${byId.brokerServer}", not "${broker}".`);
    return byId;
  }
  const matches = data.filter((a) => a.login === account && (broker === undefined || a.brokerServer === broker));
  if (matches.length === 1) return matches[0];
  if (!matches.length) {
    throw new CliError(
      `No known account has the ID or login "${account}"${broker === undefined ? "" : ` on broker server "${broker}"`}. List them with: mt4-quote-bridge accounts list`,
      EXIT.notFound,
      "unknown-account"
    );
  }
  throw new AmbiguityError(
    `Login ${account} exists on ${matches.length} broker servers. Add --broker <exact broker server> or use the account ID.`,
    "ambiguous-account",
    matches.map((a) => ({ accountId: a.id, brokerServer: a.brokerServer, login: a.login }))
  );
}
