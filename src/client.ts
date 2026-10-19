import { connection, normalizeServer } from "./config.js";

/** REST API version this CLI speaks; must equal the server's /api/v1/info apiVersion. */
export const API_VERSION = 1;

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
    readonly details?: unknown
  ) {
    super(message);
  }
}
export const EXIT = {
  error: 1,
  auth: 3,
  notExecuted: 4,
} as const;

type Query = Record<string, string | number | boolean | undefined>;

export class ApiClient {
  constructor(
    readonly server: string,
    private token?: string
  ) {}

  static async fromProfile() {
    const { server, token } = await connection();
    return new ApiClient(server, token);
  }

  async request<T = any>(
    method: "GET" | "POST",
    path: string,
    options: { query?: Query; body?: unknown; auth?: boolean } = {}
  ): Promise<T> {
    if (options.auth !== false && !this.token)
      throw new CliError(
        `Not signed in to ${this.server}. Run: mt4-quote-bridge auth login`,
        EXIT.auth
      );
    const url = new URL(this.server + path);
    for (const [k, v] of Object.entries(options.query ?? {}))
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.auth !== false && this.token)
      headers.authorization = `Bearer ${this.token}`;
    if (options.body !== undefined)
      headers["content-type"] = "application/json";
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: "manual",
        signal: AbortSignal.timeout(60000),
      });
    } catch (e) {
      throw new CliError(
        `Cannot reach Quote Bridge server at ${this.server} (${e instanceof Error ? ((e.cause as Error)?.message ?? e.message) : e}). Is it running? Check --server / MT4QB_SERVER.`
      );
    }
    // Never follow redirects: the Bearer token must only go to the configured server.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") ?? "";
      throw new RedirectError(
        `${this.server} redirects to ${location || "another address"}. Set that address with: mt4-quote-bridge auth server <url>`,
        new URL(location, url).href
      );
    }
    let data: any;
    if (response.headers.get("content-type")?.includes("application/json"))
      try {
        data = await response.json();
      } catch {
        throw new CliError(
          `Invalid JSON from ${path} (HTTP ${response.status})`
        );
      }
    if (response.status === 401 && options.auth !== false)
      throw new CliError(
        "Token missing, invalid or expired. Run: mt4-quote-bridge auth login",
        EXIT.auth
      );
    if (data === undefined)
      throw new CliError(
        `Unexpected response from ${this.server}${path} (HTTP ${response.status}). Is this a Quote Bridge server with the REST API (api v${API_VERSION})?`
      );
    if (!response.ok)
      throw new CliError(
        data.error ?? `Request failed (HTTP ${response.status})`,
        response.status === 401 ? EXIT.auth : EXIT.error,
        data.details
      );
    return data as T;
  }
  get<T = any>(path: string, query?: Query) {
    return this.request<T>("GET", path, { query });
  }
  post<T = any>(path: string, body: unknown) {
    return this.request<T>("POST", path, { body });
  }

  /** Verify the server speaks the same REST API version. */
  async checkCompatible() {
    let info: { service?: string; apiVersion?: number };
    try {
      info = await this.request("GET", "/api/v1/info", { auth: false });
    } catch (e) {
      // Unreachable or redirected is a different problem from "too old".
      if (
        e instanceof RedirectError ||
        (e instanceof CliError && e.message.startsWith("Cannot reach"))
      )
        throw e;
      throw new CliError(
        `${this.server} does not expose /api/v1/info. Update the Quote Bridge server (mt4-server-zeromq) to a version with the REST API.`,
        EXIT.error,
        e instanceof Error ? e.message : undefined
      );
    }
    if (info.service !== "mt4-quote-bridge" || info.apiVersion !== API_VERSION)
      throw new CliError(
        `Incompatible server: expected mt4-quote-bridge API v${API_VERSION}, got ${info.service ?? "unknown"} v${info.apiVersion ?? "?"}. Update the CLI or the server.`
      );
    return info;
  }

  /**
   * Check a server URL before saving it. Tunnels and HTTPS proxies (e.g. ngrok)
   * redirect http:// to https:// on the same host; adopt that upgrade only.
   */
  static async verifyServer(server: string) {
    try {
      await new ApiClient(server).checkCompatible();
      return { server, upgraded: false };
    } catch (e) {
      if (!(e instanceof RedirectError)) throw e;
      const from = new URL(server),
        to = new URL(e.location);
      if (
        from.protocol !== "http:" ||
        to.protocol !== "https:" ||
        to.hostname !== from.hostname
      )
        throw e;
      const secure = normalizeServer(`https://${to.host}${from.pathname}`);
      await new ApiClient(secure).checkCompatible();
      return { server: secure, upgraded: true };
    }
  }
}

export class RedirectError extends CliError {
  constructor(
    message: string,
    readonly location: string
  ) {
    super(message);
  }
}
