import { connection, normalizeServer } from "./config.js";

/** REST API version this CLI speaks; must equal the server's /api/v1/info apiVersion. */
export const API_VERSION = 1;

/** Stable exit codes. Documented in --help, the README and the product's docs/cli.md. */
export const EXIT = {
  ok: 0,
  /** Any other failure: server unreachable, unexpected answer, internal error. */
  error: 1,
  /** Bad arguments, or the server answered 400 for a malformed value. */
  usage: 2,
  /** Not signed in, or the API key is missing, invalid or revoked (401). */
  auth: 3,
  /** Forbidden (403): readonly key, demo trading off, real account, broker refuses the symbol. */
  forbidden: 4,
  /** No such market, account, ticket, request, terminal or indicator (404). */
  notFound: 5,
  /** The CLI could not resolve a symbol or login to exactly one market or account. */
  ambiguous: 6,
  /** Conflict (409): cross-broker market, expired or invalidated preview, account unresolved, no executor. */
  conflict: 7,
  /** Invalid trading or indicator values (422). */
  invalid: 8,
  /** Source unavailable or the terminal did not answer in time (503, 504). Not an order failure. */
  unavailable: 9,
  /** The request's outcome is unknown. Never retry: check MetaTrader, then review it. */
  unknown: 10,
  /** The request failed definitively (MetaTrader or the EA refused it). */
  failed: 11,
  /** The request was sent and has no definitive result yet: GET it again with `requests show`. */
  dispatching: 12,
  /** An export's output file exists and --force was not given. */
  exists: 13,
} as const;

/** A failure with a stable code (the server's, or the CLI's own) and an exit status. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = EXIT.error,
    readonly code = "cli-error",
    readonly details: unknown = null
  ) {
    super(message);
  }
  /** The REST error envelope shape, also for errors the CLI raises itself. */
  envelope() {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export const usage = (message: string, details: unknown = null) => new CliError(message, EXIT.usage, "usage", details);

/** The exit status for an HTTP error status. */
export function exitFor(status: number): number {
  if (status === 400 || status === 405 || status === 413 || status === 415) return EXIT.usage;
  if (status === 401) return EXIT.auth;
  if (status === 403) return EXIT.forbidden;
  if (status === 404) return EXIT.notFound;
  if (status === 409) return EXIT.conflict;
  if (status === 422) return EXIT.invalid;
  if (status === 503 || status === 504) return EXIT.unavailable;
  return EXIT.error;
}

/** A REST v1 success envelope. */
export type Envelope<T = any> = { data: T; meta: Record<string, any> };
export type Query = Record<string, string | number | undefined>;

/** A server's error answer, kept verbatim: `--json` prints `envelope` as the server sent it. */
export class ApiError extends CliError {
  constructor(
    readonly status: number,
    code: string,
    message: string,
    details: unknown
  ) {
    super(message, exitFor(status), code, details);
  }
}

export class ApiClient {
  constructor(
    readonly server: string,
    private readonly token?: string
  ) {}

  static async fromProfile() {
    const { server, token } = await connection();
    return new ApiClient(server, token);
  }

  /** Sends one request; resolves with the raw Response when ok and `raw`, else the parsed envelope. */
  private async send(method: "GET" | "POST", path: string, options: { query?: Query; body?: unknown; auth?: boolean; raw?: boolean } = {}): Promise<any> {
    const auth = options.auth !== false;
    if (auth && !this.token) throw new CliError(`Not signed in to ${this.server}. Run: mt4-quote-bridge auth login`, EXIT.auth, "not-signed-in");
    const url = new URL(this.server + path);
    for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { accept: "application/json" };
    if (auth) headers.authorization = `Bearer ${this.token}`;
    if (options.body !== undefined) headers["content-type"] = "application/json";
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        // The API key must only ever go to the configured server.
        redirect: "manual",
        // The timeout also covers reading the body, so exports get longer.
        signal: AbortSignal.timeout(options.raw ? 30 * 60000 : 60000),
      });
    } catch (e) {
      const reason = e instanceof Error ? ((e.cause as Error | undefined)?.message ?? e.message) : String(e);
      throw new CliError(`Cannot reach QuoteBridge at ${this.server} (${reason}). Is the app running? Check the server with: mt4-quote-bridge config show`, EXIT.error, "unreachable");
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") ?? "";
      throw new RedirectError(`${this.server} redirects to ${location || "another address"}. Set that address with: mt4-quote-bridge auth server <url>`, new URL(location, url).href);
    }
    if (options.raw && response.ok) return response;
    let body: any;
    if (response.headers.get("content-type")?.includes("application/json")) {
      try {
        body = await response.json();
      } catch {
        throw new CliError(`Invalid JSON from ${path} (HTTP ${response.status}).`);
      }
    }
    if (response.ok && body && typeof body === "object" && "data" in body) return body;
    const error = body?.error;
    if (error && typeof error === "object" && typeof error.code === "string") throw new ApiError(response.status, error.code, String(error.message ?? ""), error.details ?? null);
    // /api/auth/session answers outside the v1 envelope.
    if (response.ok && body !== undefined) return body;
    if (response.status === 401) throw new ApiError(401, "unauthenticated", typeof error === "string" ? error : "The API key is missing, invalid or revoked.", null);
    throw new CliError(`Unexpected answer from ${this.server}${path} (HTTP ${response.status}). Is this QuoteBridge with REST API v${API_VERSION}?`);
  }

  get<T = any>(path: string, query?: Query): Promise<Envelope<T>> {
    return this.send("GET", path, { query });
  }
  post<T = any>(path: string, body: unknown): Promise<Envelope<T>> {
    return this.send("POST", path, { body });
  }
  /** GET /api/auth/session, which is not a v1 envelope. */
  session(): Promise<Session> {
    return this.send("GET", "/api/auth/session");
  }
  /** GET a file (an export); its errors still arrive as JSON. */
  download(path: string, query?: Query): Promise<Response> {
    return this.send("GET", path, { query, raw: true });
  }

  /** Every item of a cursor-paged collection, following `meta.nextCursor` until it is null. */
  async all<T = any>(path: string, query: Query = {}): Promise<{ data: T[]; pages: number }> {
    const data: T[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await this.get<T[]>(path, { ...query, limit: query.limit ?? 500, cursor });
      data.push(...page.data);
      pages++;
      cursor = page.meta.nextCursor ?? undefined;
    } while (cursor);
    return { data, pages };
  }

  /** Verifies that the server is QuoteBridge speaking this REST API version. */
  async checkCompatible() {
    let info: Envelope<{ service?: string; apiVersion?: number }>;
    try {
      info = await this.send("GET", "/api/v1/info", { auth: false });
    } catch (e) {
      if (e instanceof RedirectError || (e instanceof CliError && e.code === "unreachable")) throw e;
      throw new CliError(`${this.server} does not answer /api/v1/info. Is it QuoteBridge for MetaTrader with REST API v${API_VERSION}?`);
    }
    if (info.data?.service !== "mt4-quote-bridge" || info.data?.apiVersion !== API_VERSION) {
      throw new CliError(`Incompatible server: expected mt4-quote-bridge API v${API_VERSION}, got ${info.data?.service ?? "unknown"} v${info.data?.apiVersion ?? "?"}. Update the CLI or the app.`);
    }
    return info.data;
  }

  /** Checks a server URL before saving it; adopts only an http → https upgrade on the same host. */
  static async verifyServer(server: string) {
    try {
      await new ApiClient(server).checkCompatible();
      return { server, upgraded: false };
    } catch (e) {
      if (!(e instanceof RedirectError)) throw e;
      const from = new URL(server);
      const to = new URL(e.location);
      if (from.protocol !== "http:" || to.protocol !== "https:" || to.hostname !== from.hostname) throw e;
      const secure = normalizeServer(`https://${to.host}${from.pathname}`);
      await new ApiClient(secure).checkCompatible();
      return { server: secure, upgraded: true };
    }
  }
}

export type Session = { username: string; key: { name: string; prefix: string; scope: "readonly" | "trader" }; expires: number | null };

export class RedirectError extends CliError {
  constructor(
    message: string,
    readonly location: string
  ) {
    super(message, EXIT.error, "redirect");
  }
}
