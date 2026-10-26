// Builds the offline place crosswalk (web/data/crosswalk/places-2022.json) from official boundary data.
// Run by hand; it calls the CSO and Tailte Éireann ArcGIS services. No hosted request uses this code.
// Usage: node scripts/build-crosswalk.mjs [--as-of YYYY-MM-DD]
//
// Method (see docs/crosswalk.md):
//   1. Every Census 2022 small area (CSO) gives its electoral division, administrative county,
//      local electoral area (CSO_LEA) and NUTS3 region. These are CSO's own attributes, not overlays.
//   2. Each small area's population comes from the CSO Census 2022 SAPS table T1_1.
//   3. Each small area's interior point is tested against the Dáil constituency boundaries (2023 order)
//      and the statutory LEA boundaries (2024 local elections). An ED that straddles a boundary gets
//      one entry per constituency, with the share of its population on each side.
//   4. The 34 Census administrative counties map to the 31 local authorities under the Local
//      Government Reform Act 2014, and to the 26 counties and 4 provinces by statute.
import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { URLSearchParams } from "node:url";

const CSO = "https://services-eu1.arcgis.com/BuS9rtTsYEV5C0xh/arcgis/rest/services";
const TE = "https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services";
const LAYERS = {
  smallAreas: `${CSO}/SMALL_AREA_2022_Genralised_20m_view/FeatureServer/0`,
  population: `${CSO}/CensusHub2022_T1_1_SA/FeatureServer/0`,
  constituencies: `${TE}/ConstituencyBoundariesUngeneralised_National_Electoral_Boundaries_2023/FeatureServer/0`,
  leas: `${TE}/LocalElectoralArea_NationalStatutoryBoundaries_Ungeneralised_2024/FeatureServer/1`
};
const UA = "ireland-mcp crosswalk builder (+https://github.com/c-mongan/ireland-mcp)";

const asOfArg = process.argv.indexOf("--as-of");
const AS_OF = asOfArg > 0 ? process.argv[asOfArg + 1] : new Date().toISOString().slice(0, 10);

async function getJson(url, params) {
  const body = new URLSearchParams({ f: "json", ...params });
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${url}/query`, { method: "POST", body, headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded" } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      if (json.error) throw new Error(JSON.stringify(json.error));
      return json;
    } catch (error) {
      if (attempt >= 3) throw new Error(`${url}: ${error.message}`, { cause: error });
      await sleep(1000 * 2 ** attempt);
    }
  }
}

/** Pages a layer by OBJECTID order; returns features and a canonical hash of the attribute rows. */
async function pageAll(url, params, pageSize = 2000, oid = "OBJECTID") {
  const count = (await getJson(url, { where: params.where ?? "1=1", returnCountOnly: "true" })).count;
  const features = [];
  for (let offset = 0; offset < count; offset += pageSize) {
    const page = await getJson(url, { where: "1=1", orderByFields: oid, resultOffset: String(offset), resultRecordCount: String(pageSize), ...params });
    features.push(...page.features);
    process.stderr.write(`  ${url.split("/").at(-3)}: ${features.length}/${count}\r`);
    await sleep(200);
  }
  process.stderr.write("\n");
  if (features.length !== count) throw new Error(`${url}: expected ${count} features, got ${features.length}`);
  return { features, count };
}

const hashRows = (rows) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");

// ---------- geometry (ITM, EPSG:2157) ----------
function bbox(rings) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) {
    if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}
/** Even-odd test over every ring, so holes and multi-part polygons both work. */
function inside(rings, x, y) {
  let hit = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}
/** A point guaranteed inside the polygon: the largest ring's centroid if inside, else the widest scanline midpoint. */
function interiorPoint(rings) {
  const outer = rings.reduce((best, r) => (Math.abs(ringArea(r)) > Math.abs(ringArea(best)) ? r : best), rings[0]);
  let cx = 0, cy = 0, a6 = 0;
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    const f = outer[j][0] * outer[i][1] - outer[i][0] * outer[j][1];
    cx += (outer[j][0] + outer[i][0]) * f;
    cy += (outer[j][1] + outer[i][1]) * f;
    a6 += f * 3;
  }
  if (a6 !== 0) {
    const c = [cx / a6, cy / a6];
    if (inside(rings, c[0], c[1])) return c;
  }
  const [, minY, , maxY] = bbox([outer]);
  for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
    const y = minY + (maxY - minY) * t;
    const xs = [];
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y)) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
      }
    }
    xs.sort((p, q) => p - q);
    let best = null;
    for (let k = 0; k + 1 < xs.length; k += 2) if (!best || xs[k + 1] - xs[k] > best[1] - best[0]) best = [xs[k], xs[k + 1]];
    if (best && inside(rings, (best[0] + best[1]) / 2, y)) return [(best[0] + best[1]) / 2, y];
  }
  return outer[0];
}
function sqDistToRings(rings, x, y) {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[j];
      const [x2, y2] = ring[i];
      const dx = x2 - x1, dy = y2 - y1;
      const t = dx || dy ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy))) : 0;
      const d = (x1 + t * dx - x) ** 2 + (y1 + t * dy - y) ** 2;
      if (d < best) best = d;
    }
  }
  return best;
}
/** Assigns a point to the polygon group containing it, or the nearest one within 2 km (coastal slivers). */
function makeLocator(pieces) {
  const indexed = pieces.map((p) => ({ ...p, box: bbox(p.rings) }));
  return (x, y) => {
    for (const p of indexed) {
      const [a, b, c, d] = p.box;
      if (x >= a && x <= c && y >= b && y <= d && inside(p.rings, x, y)) return { key: p.key, fallback: false };
    }
    let best = null;
    for (const p of indexed) {
      const [a, b, c, d] = p.box;
      if (x < a - 2000 || x > c + 2000 || y < b - 2000 || y > d + 2000) continue;
      const dist = sqDistToRings(p.rings, x, y);
      if (!best || dist < best.dist) best = { key: p.key, dist };
    }
    return best && best.dist <= 2000 ** 2 ? { key: best.key, fallback: true } : null;
  };
}

// ---------- statutory tables ----------
// Census 2022 administrative county -> local authority (Local Government Reform Act 2014) and county.
const ADMIN = {
  CARLOW: ["Carlow County Council", "Carlow"], CAVAN: ["Cavan County Council", "Cavan"], CLARE: ["Clare County Council", "Clare"],
  "CORK CITY": ["Cork City Council", "Cork"], CORK: ["Cork County Council", "Cork"], DONEGAL: ["Donegal County Council", "Donegal"],
  "DUBLIN CITY": ["Dublin City Council", "Dublin"], "DUN LAOGHAIRE/RATHDOWN": ["Dún Laoghaire-Rathdown County Council", "Dublin"],
  FINGAL: ["Fingal County Council", "Dublin"], "SOUTH DUBLIN": ["South Dublin County Council", "Dublin"],
  "GALWAY CITY": ["Galway City Council", "Galway"], GALWAY: ["Galway County Council", "Galway"], KERRY: ["Kerry County Council", "Kerry"],
  KILDARE: ["Kildare County Council", "Kildare"], KILKENNY: ["Kilkenny County Council", "Kilkenny"], LAOIS: ["Laois County Council", "Laois"],
  LEITRIM: ["Leitrim County Council", "Leitrim"], "LIMERICK CITY": ["Limerick City and County Council", "Limerick"],
  LIMERICK: ["Limerick City and County Council", "Limerick"], LONGFORD: ["Longford County Council", "Longford"], LOUTH: ["Louth County Council", "Louth"],
  MAYO: ["Mayo County Council", "Mayo"], MEATH: ["Meath County Council", "Meath"], MONAGHAN: ["Monaghan County Council", "Monaghan"],
  OFFALY: ["Offaly County Council", "Offaly"], ROSCOMMON: ["Roscommon County Council", "Roscommon"], SLIGO: ["Sligo County Council", "Sligo"],
  "NORTH TIPPERARY": ["Tipperary County Council", "Tipperary"], "SOUTH TIPPERARY": ["Tipperary County Council", "Tipperary"],
  "WATERFORD CITY": ["Waterford City and County Council", "Waterford"], WATERFORD: ["Waterford City and County Council", "Waterford"],
  WESTMEATH: ["Westmeath County Council", "Westmeath"], WEXFORD: ["Wexford County Council", "Wexford"], WICKLOW: ["Wicklow County Council", "Wicklow"]
};
const LA_IRISH = {
  "Carlow County Council": "Comhairle Contae Cheatharlach", "Cavan County Council": "Comhairle Contae an Chabháin", "Clare County Council": "Comhairle Contae an Chláir",
  "Cork City Council": "Comhairle Cathrach Chorcaí", "Cork County Council": "Comhairle Contae Chorcaí", "Donegal County Council": "Comhairle Contae Dhún na nGall",
  "Dublin City Council": "Comhairle Cathrach Bhaile Átha Cliath", "Dún Laoghaire-Rathdown County Council": "Comhairle Contae Dhún Laoghaire-Ráth an Dúin",
  "Fingal County Council": "Comhairle Contae Fhine Gall", "South Dublin County Council": "Comhairle Contae Átha Cliath Theas",
  "Galway City Council": "Comhairle Cathrach na Gaillimhe", "Galway County Council": "Comhairle Contae na Gaillimhe", "Kerry County Council": "Comhairle Contae Chiarraí",
  "Kildare County Council": "Comhairle Contae Chill Dara", "Kilkenny County Council": "Comhairle Contae Chill Chainnigh", "Laois County Council": "Comhairle Contae Laoise",
  "Leitrim County Council": "Comhairle Contae Liatroma", "Limerick City and County Council": "Comhairle Cathrach agus Contae Luimnigh",
  "Longford County Council": "Comhairle Contae an Longfoirt", "Louth County Council": "Comhairle Contae Lú", "Mayo County Council": "Comhairle Contae Mhaigh Eo",
  "Meath County Council": "Comhairle Contae na Mí", "Monaghan County Council": "Comhairle Contae Mhuineacháin", "Offaly County Council": "Comhairle Contae Uíbh Fhailí",
  "Roscommon County Council": "Comhairle Contae Ros Comáin", "Sligo County Council": "Comhairle Contae Shligigh", "Tipperary County Council": "Comhairle Contae Thiobraid Árann",
  "Waterford City and County Council": "Comhairle Cathrach agus Contae Phort Láirge", "Westmeath County Council": "Comhairle Contae na hIarmhí",
  "Wexford County Council": "Comhairle Contae Loch Garman", "Wicklow County Council": "Comhairle Contae Chill Mhantáin"
};
const COUNTIES = {
  Carlow: ["Ceatharlach", "Leinster"], Cavan: ["An Cabhán", "Ulster"], Clare: ["An Clár", "Munster"], Cork: ["Corcaigh", "Munster"],
  Donegal: ["Dún na nGall", "Ulster"], Dublin: ["Baile Átha Cliath", "Leinster"], Galway: ["Gaillimh", "Connacht"], Kerry: ["Ciarraí", "Munster"],
  Kildare: ["Cill Dara", "Leinster"], Kilkenny: ["Cill Chainnigh", "Leinster"], Laois: ["Laois", "Leinster"], Leitrim: ["Liatroim", "Connacht"],
  Limerick: ["Luimneach", "Munster"], Longford: ["An Longfort", "Leinster"], Louth: ["Lú", "Leinster"], Mayo: ["Maigh Eo", "Connacht"],
  Meath: ["An Mhí", "Leinster"], Monaghan: ["Muineachán", "Ulster"], Offaly: ["Uíbh Fhailí", "Leinster"], Roscommon: ["Ros Comáin", "Connacht"],
  Sligo: ["Sligeach", "Connacht"], Tipperary: ["Tiobraid Árann", "Munster"], Waterford: ["Port Láirge", "Munster"], Westmeath: ["An Iarmhí", "Leinster"],
  Wexford: ["Loch Garman", "Leinster"], Wicklow: ["Cill Mhantáin", "Leinster"]
};
const PROVINCES = { Connacht: "Connachta", Leinster: "Laighin", Munster: "An Mhumhain", Ulster: "Ulaidh" };

const SMALL_WORDS = new Set(["and", "of", "the", "na", "an", "le"]);
function titleCase(s) {
  return s
    .toLowerCase()
    .split(/(\s+|-|\/|\()/)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.replace(/^(\p{L})/u, (m) => m.toUpperCase())))
    .join("")
    .replace(/\b(Mc|O')(\p{L})/gu, (_, p, l) => p + l.toUpperCase())
    .replace(/ (a|b|c|d|e|f|g|h)$/i, (m) => m.toUpperCase());
}
const foldKey = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

// ---------- build ----------
console.error("Small areas (with geometry)…");
const sa = await pageAll(LAYERS.smallAreas, {
  outFields: "OBJECTID,SA_PUB2022,SA_GEOGID_2022,ED_ID_STR,ED_ENGLISH,ED_GAEILGE,COUNTY_CODE,COUNTY_ENGLISH,CSO_LEA,SA_NUTS2,SA_NUTS2_NAME,SA_NUTS3,SA_NUTS3_NAME",
  returnGeometry: "true",
  outSR: "2157",
  maxAllowableOffset: "5",
  geometryPrecision: "1"
}, 1000);
console.error("Population (T1_1)…");
const pop = await pageAll(LAYERS.population, { outFields: "OBJECTID,SA_GEOGID_2022,T1_1AGETT", returnGeometry: "false" });
console.error("Constituencies 2023…");
const con = await pageAll(LAYERS.constituencies, { outFields: "ESRI_OID,BDY_ID,ENG_NAME_VALUE,GLE_NAME_VALUE", returnGeometry: "true", outSR: "2157", maxAllowableOffset: "5", geometryPrecision: "1" }, 200, "ESRI_OID");
console.error("LEAs 2024…");
const lea = await pageAll(LAYERS.leas, { outFields: "OBJECTID,BDY_ID,ENG_NAME_VALUE,GLE_NAME_VALUE", returnGeometry: "true", outSR: "2157", maxAllowableOffset: "5", geometryPrecision: "1" }, 200);

const popBySa = new Map(pop.features.map((f) => [f.attributes.SA_GEOGID_2022, Number(f.attributes.T1_1AGETT)]));

const seatSplit = (name) => {
  const m = /^(.*?)\s*\((\d+)\)\s*$/.exec(name.trim());
  return m ? [m[1], Number(m[2])] : [name.trim(), null];
};
const constituencies = new Map();
for (const f of con.features) {
  const [name, seats] = seatSplit(f.attributes.ENG_NAME_VALUE);
  const [irish] = seatSplit(f.attributes.GLE_NAME_VALUE ?? "");
  const c = constituencies.get(name) ?? { name, irish: irish || null, seats, boundary_id: String(f.attributes.BDY_ID ?? ""), pieces: 0 };
  c.pieces += 1;
  constituencies.set(name, c);
}
// Two LEAs can share a name (Athlone is in Westmeath and in Roscommon), so boundaries are keyed by BDY_ID.
const leaPolys = new Map();
for (const f of lea.features) {
  const m = /^(.*?)\s+LEA-(\d+)$/.exec(f.attributes.ENG_NAME_VALUE.trim());
  if (!m) throw new Error(`Unexpected LEA name ${f.attributes.ENG_NAME_VALUE}`);
  const id = String(f.attributes.BDY_ID);
  const prev = leaPolys.get(id);
  if (prev && (prev.seats !== Number(m[2]) || prev.key !== foldKey(m[1]))) throw new Error(`LEA boundary ${id} has two names or seat counts`);
  leaPolys.set(id, { name: m[1], key: foldKey(m[1]), seats: Number(m[2]), boundary_id: id, irish: (f.attributes.GLE_NAME_VALUE ?? "").replace(/\s+(LEA|TA)-\d+$/, "").trim() || null });
}
const conLocate = makeLocator(con.features.filter((f) => f.geometry?.rings).map((f) => ({ key: seatSplit(f.attributes.ENG_NAME_VALUE)[0], rings: f.geometry.rings })));
const leaLocate = makeLocator(lea.features.filter((f) => f.geometry?.rings).map((f) => ({ key: String(f.attributes.BDY_ID), rings: f.geometry.rings })));

const stats = { small_areas: sa.count, sa_missing_population: 0, constituency_fallback: 0, constituency_unassigned: 0, lea_fallback: 0, lea_unassigned: 0, lea_point_disagrees_with_cso: 0 };
const eds = new Map();
const leaNames = new Map();
const leaConPop = new Map();
const nuts3 = new Map();
const leaDisagreements = [];
for (const f of sa.features) {
  const a = f.attributes;
  const admin = ADMIN[a.COUNTY_ENGLISH];
  if (!admin) throw new Error(`Unknown admin county ${a.COUNTY_ENGLISH}`);
  const people = popBySa.get(a.SA_GEOGID_2022);
  if (people == null || !Number.isFinite(people)) stats.sa_missing_population += 1;
  const p = people ?? 0;
  const rings = f.geometry?.rings;
  if (!rings?.length) throw new Error(`Small area ${a.SA_PUB2022} has no geometry`);
  const [x, y] = interiorPoint(rings);
  const c = conLocate(x, y);
  if (!c) stats.constituency_unassigned += 1;
  else if (c.fallback) stats.constituency_fallback += 1;
  const l = leaLocate(x, y);
  if (!l) stats.lea_unassigned += 1;
  else if (l.fallback) stats.lea_fallback += 1;
  const csoLeaKey = `${admin[0]}|${foldKey(a.CSO_LEA)}`;
  const votes = leaNames.get(csoLeaKey) ?? { cso: a.CSO_LEA, la: admin[0], votes: new Map() };
  if (l) votes.votes.set(l.key, (votes.votes.get(l.key) ?? 0) + 1);
  leaNames.set(csoLeaKey, votes);
  nuts3.set(a.SA_NUTS3, { code: a.SA_NUTS3, name: a.SA_NUTS3_NAME, nuts2: a.SA_NUTS2, nuts2_name: a.SA_NUTS2_NAME });
  const ed = eds.get(a.ED_ID_STR) ?? {
    id: a.ED_ID_STR, name: titleCase(a.ED_ENGLISH), irish: a.ED_GAEILGE ? titleCase(a.ED_GAEILGE) : null, la: admin[0], county: admin[1],
    nuts3: a.SA_NUTS3, population: 0, small_areas: 0, leas: new Map(), constituencies: new Map()
  };
  // A few EDs straddle an LEA boundary (CSO assigns LEA per small area), so LEAs are shares like constituencies.
  if (ed.la !== admin[0] || ed.nuts3 !== a.SA_NUTS3) throw new Error(`ED ${a.ED_ID_STR} spans two local authorities or NUTS3 regions`);
  ed.population += p;
  ed.small_areas += 1;
  ed.leas.set(csoLeaKey, (ed.leas.get(csoLeaKey) ?? 0) + p);
  if (c) ed.constituencies.set(c.key, (ed.constituencies.get(c.key) ?? 0) + p);
  eds.set(a.ED_ID_STR, ed);
  if (c) {
    const k = `${csoLeaKey}|${c.key}`;
    leaConPop.set(k, (leaConPop.get(k) ?? 0) + p);
  }
}
if (stats.constituency_unassigned > 0 || stats.lea_unassigned > 0) throw new Error(`Unassigned small areas: ${JSON.stringify(stats)}`);
// Match each CSO LEA to the statutory boundary that holds most of its small areas, and require the names to agree.
const boundaryOwner = new Map();
for (const [key, v] of leaNames) {
  const ranked = [...v.votes.entries()].sort((p, q) => q[1] - p[1]);
  const [boundary, n] = ranked[0] ?? [];
  const poly = boundary && leaPolys.get(boundary);
  if (!poly || poly.key !== foldKey(v.cso)) throw new Error(`CSO LEA ${key} best matches boundary ${poly?.name ?? "none"}`);
  if (boundaryOwner.has(boundary)) throw new Error(`Boundary ${poly.name} matches two CSO LEAs`);
  boundaryOwner.set(boundary, key);
  v.boundary = boundary;
  const total = ranked.reduce((s, [, c]) => s + c, 0);
  stats.lea_point_disagrees_with_cso += total - n;
  if (total - n > 0) leaDisagreements.push(`${key}: ${total - n} of ${total}`);
}
for (const id of leaPolys.keys()) if (!boundaryOwner.has(id)) throw new Error(`2024 LEA ${leaPolys.get(id).name} has no Census 2022 small areas`);
// CSO codes LEA per small area; a few 2022 small areas sit across the statutory line. Keep CSO's coding
// (it is what CSO's LEA tables use) but fail if the two drift apart materially.
if (stats.lea_point_disagrees_with_cso / sa.count > 0.02) throw new Error(`CSO LEA and 2024 LEA boundaries disagree for ${stats.lea_point_disagrees_with_cso} small areas: ${leaDisagreements.join("; ")}`);

// ---------- compact output ----------
const laList = [...new Set(Object.values(ADMIN).map(([la]) => la))].sort();
const countyList = Object.keys(COUNTIES).sort();
const conList = [...constituencies.keys()].sort();
const leaList = [...leaNames.keys()].sort();
const nutsList = [...nuts3.keys()].sort();
const laCounty = Object.fromEntries(Object.values(ADMIN).map(([la, county]) => [la, county]));

/** Population shares, largest first; equal shares when the parts have no residents. */
function shares(map, list) {
  const total = [...map.values()].reduce((s, v) => s + v, 0);
  return [...map.entries()]
    .sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0]))
    .map(([key, v]) => [list.indexOf(key), Math.round((total > 0 ? v / total : 1 / map.size) * 1000) / 1000]);
}
const edRows = [...eds.values()].sort((p, q) => p.id.localeCompare(q.id)).map((ed) =>
  [ed.id, ed.name, ed.irish, laList.indexOf(ed.la), shares(ed.leas, leaList), nutsList.indexOf(ed.nuts3), ed.population, ed.small_areas, shares(ed.constituencies, conList)]
);

const leaConShares = (key) => {
  const rows = conList.map((c, i) => [i, leaConPop.get(`${key}|${c}`) ?? 0]).filter(([, v]) => v > 0);
  const total = rows.reduce((s, [, v]) => s + v, 0);
  return rows.sort((p, q) => q[1] - p[1]).map(([i, v]) => [i, Math.round((v / total) * 1000) / 1000]);
};

const retrievedAt = new Date().toISOString();
const output = {
  schema: "https://irishopendata.ie/data/crosswalk/places-2022.json#v1",
  title: "Ireland place crosswalk (Census 2022 geography)",
  description: "Every CSO Census 2022 electoral division with its local authority, county, province, local electoral area, Dáil constituency (2023 boundaries) and NUTS3 region, built from official boundary data.",
  as_of: AS_OF,
  generated_at: retrievedAt,
  licence: "CC BY 4.0",
  attribution: "Contains Central Statistics Office (CSO) Census 2022 data and Tailte Éireann boundary data, both licensed under CC BY 4.0. Derived by Ireland MCP.",
  vintages: {
    electoral_division: "CSO Census 2022 electoral divisions (as used in Census 2022 and the Pobal HP Deprivation Index 2022)",
    small_area: "CSO Census 2022 small areas",
    local_electoral_area: "166 LEAs used for the 2019 and 2024 local elections (CSO_LEA in Census 2022; checked against the 2024 statutory boundaries)",
    dail_constituency: "Electoral (Amendment) Act 2023: 43 constituencies, first used at the 2024 general election",
    local_authority: "31 local authorities (Local Government Reform Act 2014; Cork city boundary 2019)",
    nuts3: "NUTS3 regions as coded by CSO in Census 2022 (NUTS 2016 codes IE041–IE063)"
  },
  sources: [
    { name: "CSO Census 2022 small areas (generalised 20 m)", url: LAYERS.smallAreas, licence: "CC BY 4.0", attribution: "© CSO / Tailte Éireann", retrieved_at: retrievedAt, feature_count: sa.count, attributes_sha256: hashRows(sa.features.map((f) => f.attributes)) },
    { name: "CSO Census 2022 SAPS table T1_1 (population by small area)", url: LAYERS.population, licence: "CC BY 4.0", attribution: "© CSO", retrieved_at: retrievedAt, feature_count: pop.count, attributes_sha256: hashRows(pop.features.map((f) => f.attributes)) },
    { name: "Tailte Éireann Dáil constituency boundaries 2023 (ungeneralised)", url: LAYERS.constituencies, licence: "CC BY 4.0", attribution: "© Tailte Éireann", retrieved_at: retrievedAt, feature_count: con.count, attributes_sha256: hashRows(con.features.map((f) => f.attributes)) },
    { name: "Tailte Éireann local electoral area boundaries 2024 (ungeneralised)", url: LAYERS.leas, licence: "CC BY 4.0", attribution: "© Tailte Éireann", retrieved_at: retrievedAt, feature_count: lea.count, attributes_sha256: hashRows(lea.features.map((f) => f.attributes)) }
  ],
  method: [
    "ED, local authority, LEA and NUTS3 come straight from CSO's small-area attributes; no overlay is involved. A few EDs straddle two LEAs, so an ED's LEAs are population shares of its small areas.",
    "Constituency: each small area's interior point is tested against the 2023 constituency boundaries; an ED's constituency shares are the population shares of its small areas.",
    "LEA follows CSO's small-area coding, which CSO's LEA tables (for example NDA05) use. The 2024 statutory LEA boundaries were checked against it: see quality.lea_point_disagrees_with_cso.",
    "Small areas whose point fell just outside every boundary (coastline differences) take the nearest boundary within 2 km.",
    "County and province follow the local authority by statute; Dublin's four councils, Cork's two and Galway's two each sit in one county."
  ],
  quality: { ...stats, lea_disagreements: leaDisagreements.sort(), ed_count: edRows.length, population_total: edRows.reduce((s, r) => s + r[6], 0) },
  provinces: Object.entries(PROVINCES).map(([name, irish]) => ({ name, irish })),
  counties: countyList.map((name) => ({ name, irish: COUNTIES[name][0], province: COUNTIES[name][1] })),
  local_authorities: laList.map((name) => ({ name, irish: LA_IRISH[name] ?? null, county: countyList.indexOf(laCounty[name]) })),
  leas: leaList.map((key) => {
    const p = leaPolys.get(leaNames.get(key).boundary);
    return { name: titleCase(leaNames.get(key).cso), irish: p.irish, la: laList.indexOf(leaNames.get(key).la), seats: p.seats, boundary_id: p.boundary_id, constituencies: leaConShares(key) };
  }),
  constituencies: conList.map((name) => {
    const c = constituencies.get(name);
    return { name, irish: c.irish, seats: c.seats, boundary_id: c.boundary_id };
  }),
  nuts3: nutsList.map((code) => nuts3.get(code)),
  ed_columns: ["id", "name", "irish", "local_authority", "leas[[index, population_share]]", "nuts3", "population_2022", "small_areas", "constituencies[[index, population_share]]"],
  eds: edRows
};

for (const l of output.local_authorities) if (l.county < 0) throw new Error(`LA ${l.name} has no county`);
if (output.constituencies.length !== 43) throw new Error(`Expected 43 constituencies, got ${output.constituencies.length}`);
if (output.leas.length !== 166) throw new Error(`Expected 166 LEAs, got ${output.leas.length}`);
if (output.local_authorities.length !== 31) throw new Error(`Expected 31 local authorities, got ${output.local_authorities.length}`);
const seatSum = output.leas.reduce((s, l) => s + l.seats, 0);
if (seatSum !== 949) throw new Error(`Expected 949 council seats, got ${seatSum}`);
const conSeats = output.constituencies.reduce((s, c) => s + c.seats, 0);
if (conSeats !== 174) throw new Error(`Expected 174 Dáil seats, got ${conSeats}`);

const dir = new URL("../web/data/crosswalk/", import.meta.url);
await mkdir(dir, { recursive: true });
const destination = new URL("places-2022.json", dir);
const temporary = new URL(`places-2022.json.${process.pid}.tmp`, dir);
await writeFile(temporary, `${JSON.stringify(output)}\n`, { flag: "wx" });
await rename(temporary, destination);
console.error(JSON.stringify(output.quality, null, 2));
console.error(`Wrote ${edRows.length} EDs. Review the diff, then run npm test and npm run build.`);
