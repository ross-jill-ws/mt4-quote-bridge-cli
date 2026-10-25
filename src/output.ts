// Output: stdout carries only results (tables or, with --json, the REST envelope verbatim); everything else is stderr.

export type Column<T> = { header: string; value: (row: T) => unknown; align?: "left" | "right" };

const cell = (v: unknown) => (v === undefined || v === null ? "" : Array.isArray(v) ? v.join(" ") : String(v));

export function table<T>(rows: T[], columns: Column<T>[]): string {
  if (!rows.length) return "(none)";
  const data = rows.map((r) => columns.map((c) => cell(c.value(r))));
  const widths = columns.map((c, i) => Math.max(c.header.length, ...data.map((r) => r[i].length)));
  const line = (values: string[]) =>
    values
      .map((v, i) => (columns[i].align === "right" ? v.padStart(widths[i]) : v.padEnd(widths[i])))
      .join("  ")
      .trimEnd();
  return [line(columns.map((c) => c.header)), line(widths.map((w) => "-".repeat(w))), ...data.map(line)].join("\n");
}

/** `label: value` lines, values aligned; null shows as "—". */
export function fields(pairs: [string, unknown][]): string {
  const width = Math.max(...pairs.map(([k]) => k.length));
  return pairs.map(([k, v]) => `${(k + ":").padEnd(width + 1)}  ${v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)}`).join("\n");
}

export function print(text: string) {
  process.stdout.write(text + "\n");
}

/** A diagnostic or hint: stderr, never mixed into results. */
export function note(text: string) {
  process.stderr.write(text + "\n");
}

/** Prints the envelope with --json, else the human rendering. */
export function emit(json: boolean | undefined, envelope: unknown, human: () => string) {
  print(json ? JSON.stringify(envelope, null, 2) : human());
}

/** For a page of a cursor-paged collection shown to people: how to get the next page. */
export function moreHint(meta: Record<string, any>) {
  if (meta?.nextCursor) note(`More: add --cursor ${meta.nextCursor} (or --all for everything).`);
}
