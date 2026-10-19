export type Format = "table" | "json" | "csv";
export type Column<T> = {
  header: string;
  value: (row: T) => unknown;
  align?: "left" | "right";
};

export function formatOf(options: { json?: boolean; csv?: boolean }): Format {
  if (options.json && options.csv) throw Error("Choose either --json or --csv");
  return options.json ? "json" : options.csv ? "csv" : "table";
}

const cell = (v: unknown) =>
  v === undefined || v === null
    ? ""
    : Array.isArray(v)
      ? v.join(" ")
      : String(v);

export function table<T>(rows: T[], columns: Column<T>[]): string {
  const data = rows.map((r) => columns.map((c) => cell(c.value(r))));
  const widths = columns.map((c, i) =>
    Math.max(c.header.length, ...data.map((r) => r[i].length))
  );
  const line = (values: string[]) =>
    values
      .map((v, i) =>
        columns[i].align === "right"
          ? v.padStart(widths[i])
          : v.padEnd(widths[i])
      )
      .join("  ")
      .trimEnd();
  return [
    line(columns.map((c) => c.header)),
    line(widths.map((w) => "-".repeat(w))),
    ...data.map(line),
  ].join("\n");
}

export function csv<T>(rows: T[], columns: Column<T>[]): string {
  const quote = (v: string) =>
    /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return [
    columns.map((c) => quote(c.header)).join(","),
    ...rows.map((r) => columns.map((c) => quote(cell(c.value(r)))).join(",")),
  ].join("\n");
}

/** Print rows as a table/CSV, or the full raw payload as JSON. */
export function emit<T>(
  format: Format,
  payload: unknown,
  rows: T[],
  columns: Column<T>[],
  footer?: string
) {
  if (format === "json") print(JSON.stringify(payload, null, 2));
  else if (format === "csv") print(csv(rows, columns));
  else {
    print(rows.length ? table(rows, columns) : "(no rows)");
    if (footer) print(footer);
  }
}

export function print(text: string) {
  process.stdout.write(text + "\n");
}

export const fixed = (digits: number | undefined) => (n: unknown) =>
  typeof n === "number"
    ? digits === undefined
      ? String(n)
      : n.toFixed(digits)
    : n;
