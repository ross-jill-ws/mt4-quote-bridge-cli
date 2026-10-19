// MT4 bar/quote times are broker-server wall-clock seconds encoded as if UTC.
// The CLI therefore formats and parses them in UTC, never the local time zone.

/** Parse 20260901, 2026-09-01, "2026-09-01 13:30[:00]", 2026-09-01T13:30 or epoch seconds. */
export function parseTime(value: string, endOfDay = false): number {
  const s = value.trim();
  if (/^\d{9,11}$/.test(s)) return Number(s);
  const m =
    /^(\d{4})-?(\d{2})-?(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!m)
    throw Error(
      `Invalid date "${value}". Use YYYYMMDD, YYYY-MM-DD, "YYYY-MM-DD HH:MM" or epoch seconds.`
    );
  const [, y, mo, d, h, mi, sec] = m;
  const dateOnly = h === undefined;
  const ms = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    dateOnly ? (endOfDay ? 23 : 0) : Number(h),
    dateOnly ? (endOfDay ? 59 : 0) : Number(mi),
    dateOnly ? (endOfDay ? 59 : 0) : Number(sec ?? 0)
  );
  const check = new Date(ms);
  if (
    Number.isNaN(ms) ||
    check.getUTCFullYear() !== Number(y) ||
    check.getUTCMonth() !== Number(mo) - 1 ||
    check.getUTCDate() !== Number(d)
  )
    throw Error(`Invalid date "${value}"`);
  return Math.floor(ms / 1000);
}

/** "2026-10-17 13:00" (seconds shown only when non-zero). */
export function formatTime(seconds: number) {
  const iso = new Date(seconds * 1000).toISOString();
  const text = iso.slice(0, 10) + " " + iso.slice(11, 19);
  return text.endsWith(":00") ? text.slice(0, 16) : text;
}

export function formatMillis(ms: number) {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + "Z";
}
