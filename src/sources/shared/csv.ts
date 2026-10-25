import { ToolError } from "../../gateway/errors.js";

export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 10_000;

/** Strict CSV scanner: quoted commas, escaped quotes, embedded newlines, BOM and CRLF. */
export function csvRows(input: string, label = "CSV export"): string[][] {
  const invalid = (message: string): never => { throw new ToolError("UPSTREAM_DOWN", `Invalid ${label}: ${message}`, { retryable: false }); };
  if (Buffer.byteLength(input) > MAX_CSV_BYTES) invalid("byte bound exceeded.");
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closed = false;
  const pushField = () => { row.push(field); field = ""; closed = false; };
  const pushRow = () => {
    pushField();
    if (row.some((v) => v !== "")) rows.push(row);
    row = [];
    if (rows.length > MAX_CSV_ROWS + 1) invalid("row bound exceeded.");
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else { quoted = false; closed = true; }
      } else field += c;
    } else if (c === ",") pushField();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      pushRow();
    } else if (c === '"' && field === "" && !closed) quoted = true;
    else {
      if (closed || c === '"') invalid("malformed quoting.");
      field += c;
    }
  }
  if (quoted) invalid("unterminated quoted field.");
  if (row.length || field || closed) pushRow();
  return rows;
}
