import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Saved server and sign-in, stored in the user's profile directory. */
export type Profile = {
  server: string;
  username?: string;
  /** The API key; absent until "auth login". Always belongs to `server`. */
  token?: string;
  /** Dashboard name and scope of the saved API key. */
  keyName?: string;
  scope?: "read" | "trade";
  /** Epoch milliseconds; null when the key never expires. */
  expires?: number | null;
  savedAt: number;
};

export const DEFAULT_SERVER = "http://localhost:3000";

export function configPath() {
  return (
    process.env.MT4QB_CONFIG ??
    join(homedir(), ".mt4-quote-bridge", "config.json")
  );
}

export async function loadProfile(): Promise<Profile | undefined> {
  try {
    const value = JSON.parse(await readFile(configPath(), "utf8"));
    if (typeof value?.server === "string") return value as Profile;
  } catch {
    /* Missing or unreadable profile means no saved server or sign-in. */
  }
  return undefined;
}

export async function saveProfile(profile: Profile) {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(profile, null, 2) + "\n", {
    mode: 0o600,
  });
  // writeFile's mode only applies on creation; tighten an existing file too.
  await chmod(path, 0o600).catch(() => {});
}

export async function clearProfile() {
  await rm(configPath(), { force: true });
}

/** Save the server URL. The API key only stays when the server is unchanged. */
export async function saveServer(server: string) {
  const saved = await loadProfile();
  const same = !!saved && normalizeServer(saved.server) === server;
  await saveProfile(
    same
      ? { ...saved, server, savedAt: Date.now() }
      : { server, savedAt: Date.now() }
  );
  return { changed: !same, droppedToken: !same && !!saved?.token };
}

/** Forget the API key but keep the configured server. */
export async function clearToken() {
  const saved = await loadProfile();
  if (saved) await saveProfile({ server: saved.server, savedAt: Date.now() });
  else await clearProfile();
}

/** Effective connection: environment overrides the saved profile. */
export async function connection() {
  const profile = await loadProfile();
  const server = normalizeServer(
    process.env.MT4QB_SERVER ?? profile?.server ?? DEFAULT_SERVER
  );
  // MT4QB_TOKEN is the pre-API-key name, still honoured.
  const token =
    process.env.MT4QB_API_KEY ??
    process.env.MT4QB_TOKEN ??
    (profile && normalizeServer(profile.server) === server
      ? profile.token
      : undefined);
  return { server, token, profile };
}

export function normalizeServer(value: string) {
  const url = new URL(value.includes("://") ? value : `http://${value}`);
  if (!["http:", "https:"].includes(url.protocol))
    throw Error("Server URL must use http or https");
  return url.origin + url.pathname.replace(/\/+$/, "");
}
