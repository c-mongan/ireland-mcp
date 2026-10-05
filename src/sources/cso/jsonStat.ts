import { ToolError } from "../../gateway/errors.js";

/** Minimal JSON-stat 2.0 shape used by CSO PxStat (ported from ireland-open-data-mcp, simplified). */
export interface JsonStat {
  class?: string;
  label?: string;
  updated?: string;
  id: string[];
  size: number[];
  dimension: Record<
    string,
    {
      label?: string;
      category: {
        index: string[] | Record<string, number>;
        label?: Record<string, string>;
        unit?: Record<string, { label?: string; decimals?: number }>;
      };
    }
  >;
  role?: Record<string, string[]>;
  value?: Array<number | null> | Record<string, number | null>;
  status?: string | Array<string | null> | Record<string, string | null>;
  note?: string[];
  extension?: { matrix?: string; copyright?: { name?: string; href?: string } };
}

export interface DimensionInfo {
  code: string;
  label: string;
  role?: string;
  categories: Array<{ code: string; label: string }>;
}

export function orderedCodes(index: string[] | Record<string, number>): string[] {
  return Array.isArray(index)
    ? index
    : Object.entries(index)
        .sort(([, a], [, b]) => a - b)
        .map(([code]) => code);
}

export function assertJsonStat(value: unknown): JsonStat {
  const data = value as Partial<JsonStat> | null;
  if (
    !data ||
    !Array.isArray(data.id) ||
    !Array.isArray(data.size) ||
    data.id.length !== data.size.length ||
    typeof data.dimension !== "object" ||
    data.id.some((id) => !data.dimension?.[id])
  ) {
    throw new ToolError("UPSTREAM_DOWN", "CSO returned an unexpected JSON-stat document.");
  }
  return data as JsonStat;
}

export function dimensions(data: JsonStat): DimensionInfo[] {
  return data.id.map((code) => {
    const dim = data.dimension[code]!;
    const role = Object.entries(data.role ?? {}).find(([, ids]) => ids.includes(code))?.[0];
    return {
      code,
      label: dim.label ?? code,
      ...(role ? { role } : {}),
      categories: orderedCodes(dim.category.index).map((id) => ({ code: id, label: dim.category.label?.[id] ?? id }))
    };
  });
}

export function cellCount(size: number[]): number {
  return size.reduce((count, length) => count * length, 1);
}

export type Row = Record<string, string | number | null>;

/** Decodes row-major JSON-stat values into flat rows keyed by dimension label. */
export function rows(data: JsonStat, limit: number): { rows: Row[]; total: number } {
  const dims = dimensions(data);
  const total = cellCount(data.size);
  const out: Row[] = [];
  const statistic = data.dimension.STATISTIC?.category.unit;
  for (let index = 0; index < total && out.length < limit; index += 1) {
    const value = Array.isArray(data.value) ? data.value[index] : data.value?.[String(index)];
    let remainder = index;
    const row: Row = {};
    let unit: string | undefined;
    dims.forEach((dim, d) => {
      const block = data.size.slice(d + 1).reduce((a, b) => a * b, 1);
      const category = dim.categories[Math.floor(remainder / block)]!;
      remainder %= block;
      row[dim.label] = category.label;
      if (dim.code === "STATISTIC") unit = statistic?.[category.code]?.label;
    });
    row.value = value ?? null;
    if (unit) row.unit = unit;
    const status = typeof data.status === "string" ? data.status : Array.isArray(data.status) ? data.status[index] : data.status?.[String(index)];
    if (status) row.status = status;
    out.push(row);
  }
  return { rows: out, total };
}
