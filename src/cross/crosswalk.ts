import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ToolError } from "../gateway/errors.js";
import { councilAliases, DUBLIN_DISTRICTS, edMatchesStem, foldName, placeKey, splitQualifier } from "./names.js";

/** Geography levels, spelled as in the dataset cards (src/gateway/cards.ts). */
export const CROSSWALK_LEVELS = ["province", "county", "local_authority", "nuts3", "constituency", "lea", "ed"] as const;
export type CrosswalkLevel = (typeof CROSSWALK_LEVELS)[number];

interface Snapshot {
  schema: string;
  as_of: string;
  generated_at: string;
  licence: string;
  attribution: string;
  vintages: Record<string, string>;
  sources: Array<{ name: string; url: string; licence: string; retrieved_at: string; feature_count: number; attributes_sha256: string }>;
  method: string[];
  provinces: Array<{ name: string; irish: string }>;
  counties: Array<{ name: string; irish: string; province: string }>;
  local_authorities: Array<{ name: string; irish: string | null; county: number }>;
  leas: Array<{ name: string; irish: string | null; la: number; seats: number; boundary_id: string }>;
  constituencies: Array<{ name: string; irish: string | null; seats: number; boundary_id: string }>;
  nuts3: Array<{ code: string; name: string; nuts2: string; nuts2_name: string }>;
  eds: Array<[string, string, string | null, number, Array<[number, number]>, number, number, number, Array<[number, number]>]>;
}

export interface Entity {
  level: CrosswalkLevel;
  index: number;
  name: string;
  irish: string | null;
  code: string | null;
  seats?: number;
}

/** One ED, or the part of an ED inside one LEA and one constituency. Weights are Census 2022 residents. */
interface Part {
  ed: number;
  weight: number;
  ids: Record<CrosswalkLevel, number>;
}

interface Index {
  snapshot: Snapshot;
  sha256: string;
  bytes: number;
  parts: Part[];
  entities: Record<CrosswalkLevel, Entity[]>;
  byKey: Map<string, Entity[]>;
  edById: Map<string, number>;
}

export const CROSSWALK_FILE = "https://irishopendata.ie/data/crosswalk/places-2022.json";
let loaded: Index | undefined;

// Resolves to web/data from src and to dist/web/data from the build (scripts/copy-assets.mjs).
export function loadCrosswalk(): Index {
  if (loaded) return loaded;
  let bytes: Buffer;
  try {
    bytes = readFileSync(new URL("../../web/data/crosswalk/places-2022.json", import.meta.url));
  } catch {
    throw new ToolError("UPSTREAM_DOWN", "The packaged place crosswalk is missing.", { retryable: false });
  }
  const snapshot = JSON.parse(bytes.toString("utf8")) as Snapshot;
  if (!Array.isArray(snapshot.eds) || !snapshot.eds.length || !Array.isArray(snapshot.leas) || !Array.isArray(snapshot.constituencies)) {
    throw new ToolError("UPSTREAM_DOWN", "The packaged place crosswalk failed validation.", { retryable: false });
  }
  loaded = build(snapshot, createHash("sha256").update(bytes).digest("hex"), bytes.length);
  return loaded;
}

function build(snapshot: Snapshot, sha256: string, size: number): Index {
  const provinceIdx = new Map(snapshot.provinces.map((p, i) => [p.name, i]));
  const entities: Record<CrosswalkLevel, Entity[]> = {
    province: snapshot.provinces.map((p, i) => ({ level: "province", index: i, name: p.name, irish: p.irish, code: null })),
    county: snapshot.counties.map((c, i) => ({ level: "county", index: i, name: c.name, irish: c.irish, code: null })),
    local_authority: snapshot.local_authorities.map((l, i) => ({ level: "local_authority", index: i, name: l.name, irish: l.irish, code: null })),
    nuts3: snapshot.nuts3.map((n, i) => ({ level: "nuts3", index: i, name: n.name, irish: null, code: n.code })),
    constituency: snapshot.constituencies.map((c, i) => ({ level: "constituency", index: i, name: c.name, irish: c.irish, code: c.boundary_id, seats: c.seats })),
    lea: snapshot.leas.map((l, i) => ({ level: "lea", index: i, name: l.name, irish: l.irish, code: l.boundary_id, seats: l.seats })),
    ed: snapshot.eds.map((e, i) => ({ level: "ed", index: i, name: e[1], irish: e[2], code: e[0] }))
  };
  const parts: Part[] = [];
  snapshot.eds.forEach((e, i) => {
    const la = e[3];
    const county = snapshot.local_authorities[la]!.county;
    const province = provinceIdx.get(snapshot.counties[county]!.province)!;
    for (const [lea, leaShare] of e[4]) {
      for (const [con, conShare] of e[8]) {
        // Uninhabited EDs keep a token weight so they still belong to their areas.
        parts.push({ ed: i, weight: Math.max(e[6], 0.001) * leaShare * conShare, ids: { province, county, local_authority: la, nuts3: e[5], constituency: con, lea, ed: i } });
      }
    }
  });
  const byKey = new Map<string, Entity[]>();
  const add = (key: string, entity: Entity) => {
    const k = placeKey(key);
    if (!k) return;
    const list = byKey.get(k) ?? [];
    if (!list.includes(entity)) list.push(entity);
    byKey.set(k, list);
  };
  for (const level of CROSSWALK_LEVELS) {
    for (const e of entities[level]) {
      add(e.name, e);
      if (e.irish) add(e.irish, e);
      if (e.code) add(e.code, e);
    }
  }
  for (const la of entities.local_authority) for (const alias of councilAliases(la.name)) add(alias, la);
  for (const l of entities.lea) {
    // CSO NDA05 labels: "<LEA>, <council short name>"; and Tailte names with the council's county.
    for (const alias of councilAliases(entities.local_authority[snapshot.leas[l.index]!.la]!.name)) add(`${l.name}, ${alias}`, l);
  }
  for (const n of entities.nuts3) add(`${n.name} region`, n);
  return { snapshot, sha256, bytes: size, parts, entities, byKey, edById: new Map(snapshot.eds.map((e, i) => [e[0], i])) };
}

export function crosswalkMeta() {
  const { snapshot, sha256 } = loadCrosswalk();
  return {
    as_of: snapshot.as_of,
    file: CROSSWALK_FILE,
    file_sha256: sha256,
    vintages: snapshot.vintages,
    sources: snapshot.sources.map((s) => ({ name: s.name, url: s.url, licence: s.licence, retrieved_at: s.retrieved_at }))
  };
}

export function crosswalkHealth(): { ok: true; note: string } | { ok: false; error: string } {
  try {
    const x = loadCrosswalk();
    return { ok: true, note: `place crosswalk as of ${x.snapshot.as_of}, ${x.snapshot.eds.length} EDs` };
  } catch {
    return { ok: false, error: "place crosswalk unreadable or invalid" };
  }
}

const LEVEL_RANK: Record<CrosswalkLevel, number> = { county: 0, local_authority: 1, constituency: 2, lea: 3, nuts3: 4, province: 5, ed: 6 };

/** Every entity whose name, Irish name, code or alias matches, best level first. */
export function findEntities(query: string, level?: CrosswalkLevel): Entity[] {
  const x = loadCrosswalk();
  const q = query.trim();
  const direct = x.byKey.get(placeKey(/^\d{5}$/.test(q) ? q.padStart(6, "0") : q)) ?? [];
  let hits = direct;
  if (!hits.length) {
    // "Ballybane, Galway" (RTB) or "Athlone, Roscommon": the qualifier names a county or council.
    const parts = splitQualifier(query);
    if (parts) {
      const within = x.byKey.get(placeKey(parts.qualifier))?.filter((e) => e.level === "county" || e.level === "local_authority") ?? [];
      hits = (x.byKey.get(placeKey(parts.name)) ?? []).filter((e) => within.some((w) => contains(w, e)));
    }
  }
  return hits.filter((e) => !level || e.level === level).sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.name.localeCompare(b.name));
}

export function edById(id: string): Entity | undefined {
  const x = loadCrosswalk();
  // Pobal and some spreadsheets drop the leading zero ("68001" for "068001").
  const clean = id.trim();
  const i = x.edById.get(/^\d{5}$/.test(clean) ? clean.padStart(6, "0") : clean);
  return i === undefined ? undefined : x.entities.ed[i];
}

export function entityAt(level: CrosswalkLevel, index: number): Entity {
  return loadCrosswalk().entities[level][index]!;
}

const partsOf = (e: Entity) => loadCrosswalk().parts.filter((p) => p.ids[e.level] === e.index);
/** True when any part of `inner` lies in `outer`. */
function contains(outer: Entity, inner: Entity): boolean {
  return partsOf(inner).some((p) => p.ids[outer.level] === outer.index);
}

/** EDs for a Dublin postal district (approximate: districts are delivery areas, not statistical ones). */
export function dublinDistrictEds(district: string): Entity[] {
  const x = loadCrosswalk();
  const dublin = new Set(x.entities.local_authority.filter((l) => x.snapshot.counties[x.snapshot.local_authorities[l.index]!.county]!.name === "Dublin").map((l) => l.index));
  const stems = DUBLIN_DISTRICTS[district] ?? [];
  return x.entities.ed.filter((ed) => dublin.has(x.snapshot.eds[ed.index]![3]) && stems.some((s) => edMatchesStem(ed.name, s)));
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export interface Overlap {
  name: string;
  code?: string;
  irish?: string;
  seats?: number;
  /** Share of the queried area's Census 2022 residents in this area (1 = wholly inside). */
  share: number;
}

function describeEntity(e: Entity, extra: Record<string, unknown> = {}) {
  return {
    level: e.level,
    name: e.name,
    ...(e.code ? { code: e.code } : {}),
    ...(e.irish ? { irish: e.irish } : {}),
    ...(e.seats ? { seats: e.seats } : {}),
    ...extra
  };
}

/** Population-weighted overlaps of a set of parts with each geography level. */
function overlaps(parts: Part[], skip: Set<CrosswalkLevel>, maxPerLevel: number) {
  const x = loadCrosswalk();
  const total = parts.reduce((s, p) => s + p.weight, 0) || 1;
  const out: Partial<Record<CrosswalkLevel, Overlap[]>> = {};
  const counts: Partial<Record<CrosswalkLevel, number>> = {};
  for (const level of CROSSWALK_LEVELS) {
    if (skip.has(level)) continue;
    const sums = new Map<number, number>();
    for (const p of parts) sums.set(p.ids[level], (sums.get(p.ids[level]) ?? 0) + p.weight);
    const ranked = [...sums.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    counts[level] = ranked.length;
    out[level] = ranked.slice(0, maxPerLevel).map(([i, w]) => {
      const e = x.entities[level][i]!;
      return { name: e.name, ...(e.code ? { code: e.code } : {}), ...(e.seats ? { seats: e.seats } : {}), share: round3(w / total) };
    });
  }
  return { codes: out, counts, population: Math.round(parts.reduce((s, p) => s + (p.weight >= 1 ? p.weight : 0), 0)) };
}

const NUTS2 = (e: Entity) => {
  const n = loadCrosswalk().snapshot.nuts3[e.index]!;
  return { nuts2: { code: n.nuts2, name: n.nuts2_name } };
};

/** All codes and names for one entity: the areas it sits in or overlaps, each with a population share. */
export function profileEntity(e: Entity, maxPerLevel = 12) {
  const parts = partsOf(e);
  const skip = new Set<CrosswalkLevel>([e.level]);
  if (e.level !== "ed") skip.add("ed");
  const o = overlaps(parts, skip, maxPerLevel);
  const edCount = new Set(parts.map((p) => p.ed)).size;
  return {
    place: describeEntity(e, e.level === "nuts3" ? NUTS2(e) : {}),
    population_2022: o.population,
    ed_count: edCount,
    codes: o.codes,
    ...(Object.entries(o.counts).some(([level, n]) => n > maxPerLevel && level !== "ed") ? { more: Object.fromEntries(Object.entries(o.counts).filter(([, n]) => n > maxPerLevel)) } : {})
  };
}

/** Codes for a set of EDs (a postal district, or a point's ED). */
export function profileEds(eds: Entity[], maxPerLevel = 12) {
  const set = new Set(eds.map((e) => e.index));
  const parts = loadCrosswalk().parts.filter((p) => set.has(p.ed));
  const o = overlaps(parts, new Set(eds.length > 1 ? ["ed" as const] : []), maxPerLevel);
  return { population_2022: o.population, ed_count: set.size, codes: o.codes };
}

/** Areas of `child` level inside or overlapping `e`, with the share of each child's residents inside `e`. */
export function listChildren(e: Entity, child: CrosswalkLevel) {
  const x = loadCrosswalk();
  const inside = new Map<number, number>();
  for (const p of x.parts) if (p.ids[e.level] === e.index) inside.set(p.ids[child], (inside.get(p.ids[child]) ?? 0) + p.weight);
  const totals = new Map<number, number>();
  for (const p of x.parts) if (inside.has(p.ids[child])) totals.set(p.ids[child], (totals.get(p.ids[child]) ?? 0) + p.weight);
  return [...inside.entries()]
    .map(([i, w]) => {
      const c = x.entities[child][i]!;
      const row: Record<string, unknown> = describeEntity(c);
      delete row.level;
      if (child === "ed") {
        const ed = x.snapshot.eds[i]!;
        row.population_2022 = ed[6];
        row.local_authority = x.snapshot.local_authorities[ed[3]]!.name;
        row.lea = ed[4].map(([l]) => x.snapshot.leas[l]!.name).join("; ");
        row.constituency = ed[8].map(([k]) => x.snapshot.constituencies[k]!.name).join("; ");
      } else {
        if (child === "lea") row.local_authority = x.snapshot.local_authorities[x.snapshot.leas[i]!.la]!.name;
        row.population_2022 = Math.round(totals.get(i)! >= 1 ? totals.get(i)! : 0);
      }
      row.share_inside = round3(w / (totals.get(i) || 1));
      return row;
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** Folded-name helper re-exported for callers that match labels from other sources. */
export { foldName };
