import type { ToolContext } from "../../gateway/module.js";
import type { PprIndex, PprIndexStore } from "./indexStore.js";
import { csvUrl, parsePprCsv, type SaleRow } from "./parse.js";

/** Downloads the national CSV for each year and writes one compact, sorted index. */
export async function buildPprIndex(ctx: ToolContext, store: PprIndexStore, years: number[]): Promise<PprIndex> {
  const rows: SaleRow[] = [];
  for (const year of years) {
    const bytes = await ctx.http.bytes(csvUrl(year), { label: "Property Price Register", maxBytes: 40 * 1024 * 1024, timeoutMs: 60_000 });
    rows.push(...parsePprCsv(bytes).filter((r) => r[0].startsWith(`${year}-`)));
  }
  rows.sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
  const index: PprIndex = { built_at: ctx.now().toISOString(), years, rows };
  await store.write(index);
  return index;
}

export const defaultYears = (now: Date) => [now.getUTCFullYear() - 1, now.getUTCFullYear()];
