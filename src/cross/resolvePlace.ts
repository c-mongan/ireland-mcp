import { z } from "zod";
import { envelope, MAX_LIMIT, type SourceInfo } from "../gateway/envelope.js";
import { ToolError } from "../gateway/errors.js";
import { defineTool } from "../gateway/module.js";
import { smallAreaAt, smallAreaByCode } from "../sources/census-areas/index.js";
import { assertInIreland, locatePlace } from "../sources/geohive/index.js";
import {
  crosswalkMeta,
  CROSSWALK_FILE,
  CROSSWALK_LEVELS,
  dublinDistrictEds,
  edById,
  findEntities,
  listChildren,
  profileEds,
  profileEntity,
  type CrosswalkLevel,
  type Entity
} from "./crosswalk.js";
import { dublinDistrict, routingKey, splitQualifier, stripDecorations } from "./names.js";

export const crosswalkInfo: SourceInfo = {
  id: "cross",
  name: "Ireland MCP place crosswalk (CSO Census 2022 and Tailte Éireann boundaries)",
  licence: "CC BY 4.0",
  attribution: "Contains Central Statistics Office (CSO) Census 2022 data and Tailte Éireann boundary data, both licensed under CC BY 4.0. Derived by Ireland MCP.",
  homepage: "https://github.com/c-mongan/ireland-mcp/blob/main/docs/crosswalk.md"
};

const NOT_COVERED = "Garda divisions, HSE areas and Eircode routing-key areas are not included: no open boundary file was found.";
const MAX_CANDIDATES = 10;

const describe = (e: Entity) => ({ level: e.level, name: e.name, ...(e.code ? { code: e.code } : {}) });

/** Compact codes for an ED id, for the nearby and snapshot tools. Undefined when the id is unknown. */
export function codesForEd(edId: string | null | undefined) {
  const ed = edId ? edById(edId) : undefined;
  if (!ed) return undefined;
  const p = profileEntity(ed, 3);
  const one = (level: CrosswalkLevel) => p.codes[level]?.map((c) => (c.share < 1 ? `${c.name} (${Math.round(c.share * 100)}%)` : c.name)).join("; ") ?? null;
  return {
    ed: { id: ed.code, name: ed.name },
    lea: one("lea"),
    dail_constituency: one("constituency"),
    local_authority: one("local_authority"),
    county: one("county"),
    nuts3: p.codes.nuts3?.[0] ? `${p.codes.nuts3[0].code} ${p.codes.nuts3[0].name}` : null,
    as_of: crosswalkMeta().as_of
  };
}

const childLevels = ["local_authority", "county", "nuts3", "constituency", "lea", "ed"] as const;

export const resolvePlaceTool = defineTool({
  name: "ireland_resolve_place",
  pinned: true,
  example: { place: "Galway City Council", list: "ed" },
  title: "Resolve an Irish place to every geography code",
  description:
    "All geography codes for an Irish place: county, province, council, LEA, Dáil constituency, NUTS3, electoral division (ED) and, for lat/lon, small area, with population shares where areas straddle. Takes a name (English or Irish, 'Co. Mayo', 'Dublin 8', 'Tallaght Central, South Dublin'), an ED/small-area/NUTS3 code, or lat/lon. list returns the EDs, LEAs, constituencies or councils inside.",
  inputSchema: {
    place: z.string().min(1).max(120).optional().describe("Name or code, e.g. 'Ballymun', 'Galway West', 'IE042', '268015'."),
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    level: z.enum(CROSSWALK_LEVELS).optional().describe("Only match this level."),
    list: z.enum(childLevels).optional().describe("List areas of this level inside the place."),
    limit: z.number().int().min(1).max(MAX_LIMIT).default(50),
    offset: z.number().int().min(0).max(10_000).default(0)
  },
  handler: async ({ place, lat, lon, level, list, limit, offset }, ctx) => {
    const meta = crosswalkMeta();
    let url = CROSSWALK_FILE;
    let cached = true;
    let stale = false;
    let match: Record<string, unknown>;
    let profile: ReturnType<typeof profileEntity> | (ReturnType<typeof profileEds> & { place?: unknown });
    let primary: Entity | undefined;
    let candidates: Entity[] = [];
    let smallArea: Record<string, unknown> | undefined;

    const fromPoint = async (pLat: number, pLon: number, via: string, note?: string) => {
      assertInIreland(pLat, pLon);
      const sa = await smallAreaAt(ctx, pLat, pLon);
      url = sa.url;
      cached = sa.cached;
      stale = sa.stale;
      const ed = edById(sa.result?.electoral_division.code ?? "");
      if (!sa.result || !ed) {
        throw new ToolError("NOT_FOUND", `No Census 2022 small area at (${pLat}, ${pLon}).`, { hint: "The point may be at sea, on an island outside the census grid, or in Northern Ireland." });
      }
      smallArea = { code: sa.result.small_area.code, geogid: sa.result.small_area.geogid, population_2022: sa.result.small_area.population };
      match = { via, lat: pLat, lon: pLon, ...(note ? { note } : {}) };
      primary = ed;
    };

    if (lat !== undefined || lon !== undefined) {
      if (lat === undefined || lon === undefined) throw new ToolError("BAD_ARGS", "Give both lat and lon.");
      await fromPoint(lat, lon, "point");
    } else if (place) {
      const text = place.trim();
      const district = dublinDistrict(text);
      if (/^A?\d{9}(\/\d{2})?$/i.test(text)) {
        const sa = await smallAreaByCode(ctx, text.replace(/\/\d{2}$/, ""));
        url = sa.url;
        cached = sa.cached;
        stale = sa.stale;
        primary = sa.result?.ed_id ? edById(sa.result.ed_id) : undefined;
        if (!sa.result || !primary) throw new ToolError("NOT_FOUND", `No Census 2022 small area "${text}".`, { hint: "Small-area codes have 9 digits, e.g. '268098009', or a GEOGID like 'A268098009'." });
        smallArea = { code: sa.result.code, geogid: sa.result.geogid };
        match = { via: "small_area_code" };
      } else if (district && !level) {
        const eds = dublinDistrictEds(district);
        match = {
          via: "dublin_postal_district",
          district,
          approximate: true,
          note: "Postal districts are delivery areas, not statistical ones; these are the EDs whose names belong to the district. Check edge areas.",
          eds: eds.slice(0, 40).map((e) => ({ id: e.code, name: e.name }))
        };
        profile = profileEds(eds);
      } else {
        const hits = findEntities(text, level);
        if (hits.length) {
          primary = hits[0];
          candidates = hits.slice(1);
          match = { via: "name_or_code" };
        } else if (routingKey(text) && !level) {
          throw new ToolError("NOT_FOUND", `"${text}" looks like an Eircode routing key. Routing-key areas are not open data, so they are not mapped.`, {
            hint: "Give the post town (e.g. 'Galway' for H91), a Dublin district ('Dublin 8'), or lat/lon."
          });
        } else if (level && level !== "ed") {
          throw new ToolError("NOT_FOUND", `No ${level.replace("_", " ")} matches "${text}".`, { hint: "Drop level to search every level, or check the spelling." });
        } else {
          // A town, village or neighbourhood: use the Tailte Éireann gazetteer point.
          const q = splitQualifier(text);
          const name = stripDecorations(q?.name ?? text);
          const found = await locatePlace(ctx, name, 10).catch(() => null);
          const county = q ? stripDecorations(q.qualifier).toLowerCase().replace(/ (city|county)( and county)?$/, "") : null;
          const hit = found?.places.find((p) => !county || p.county?.toLowerCase() === county) ?? (county ? undefined : found?.places[0]);
          if (!hit) {
            throw new ToolError("NOT_FOUND", `"${text}" is not a county, council, LEA, constituency, NUTS3 region or ED, and is not in the Tailte Éireann gazetteer.`, {
              hint: "Check the spelling, try the Irish name, or give lat and lon."
            });
          }
          await fromPoint(hit.lat, hit.lon, "gazetteer_point", `Codes for the gazetteer point of ${hit.name}${hit.county ? `, Co. ${hit.county}` : ""}. A town can span several EDs or LEAs; list from the LEA or council for the full picture.`);
          match = { ...match!, approximate: true, gazetteer: { name: hit.name, county: hit.county, kind: hit.kind } };
          if (found?.places && found.places.length > 1) match.other_gazetteer_matches = found.places.filter((p) => p !== hit).slice(0, 5).map((p) => `${p.name}, ${p.county}`);
        }
      }
    } else {
      throw new ToolError("BAD_ARGS", "Give a place (name or code) or both lat and lon.");
    }

    if (primary) profile = profileEntity(primary);
    let children: Record<string, unknown> | undefined;
    if (list) {
      if (!primary) throw new ToolError("BAD_ARGS", "list needs a single area; a postal district is a set of EDs.", { hint: "Resolve a council, LEA or constituency instead." });
      if (list === primary.level) throw new ToolError("BAD_ARGS", `"${primary.name}" is itself a ${list.replace("_", " ")}.`, { hint: "Choose a smaller level, e.g. list: 'ed'." });
      const rows = listChildren(primary, list);
      const page = rows.slice(offset, offset + limit);
      children = { level: list, total: rows.length, offset, count: page.length, ...(offset + page.length < rows.length ? { next_offset: offset + page.length } : {}), items: page };
    }
    return envelope(crosswalkInfo, {
      data: {
        query: place ?? { lat, lon },
        match: match!,
        ...profile!,
        ...(smallArea ? { small_area: smallArea } : {}),
        ...(candidates.length ? { other_matches: candidates.slice(0, MAX_CANDIDATES).map(describe), ...(candidates.length > MAX_CANDIDATES ? { other_matches_total: candidates.length } : {}) } : {}),
        ...(children ? { children } : {}),
        not_covered: NOT_COVERED,
        crosswalk: { as_of: meta.as_of, file: meta.file, file_sha256: meta.file_sha256, vintages: meta.vintages }
      },
      url,
      cached,
      stale,
      truncated: Boolean(children && (children as { next_offset?: number }).next_offset !== undefined)
    });
  }
});
