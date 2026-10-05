import { z } from "zod";
import { DAY, MINUTE } from "../../gateway/context.js";
import { bound, envelope, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { decodeXml } from "../../gateway/xml.js";
import { defineTool, type SourceModule, type ToolContext } from "../../gateway/module.js";

export const irishRailInfo: SourceInfo = {
  id: "irish-rail",
  name: "Iarnród Éireann (Irish Rail) realtime API",
  licence: "Public open data (Irish Rail realtime API terms)",
  attribution: "Source: Iarnród Éireann / Irish Rail realtime API (api.irishrail.ie). Live data may be delayed or incomplete.",
  homepage: "https://api.irishrail.ie/realtime/"
};

export const RAIL_BASE = "https://api.irishrail.ie/realtime/realtime.asmx";

const blocks = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1] ?? "");
const text = (block: string, tag: string) => {
  const v = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim();
  return v ? decodeXml(v) : null;
};
const int = (v: string | null) => (v === null || !/^-?\d+$/.test(v) ? null : Number(v));
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f'’.-]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

export interface RailStation {
  name: string;
  alias: string | null;
  code: string;
  lat: number;
  lon: number;
}

export function parseStations(xml: string): RailStation[] {
  return blocks(xml, "objStation").map((b) => ({
    name: text(b, "StationDesc") ?? "",
    alias: text(b, "StationAlias"),
    code: text(b, "StationCode") ?? "",
    lat: Number(text(b, "StationLatitude")),
    lon: Number(text(b, "StationLongitude"))
  }));
}

async function loadStations(ctx: ToolContext) {
  const url = `${RAIL_BASE}/getAllStationsXML`;
  const r = await ctx.cachedText(url, DAY, { label: "Irish Rail stations" });
  if (!r.value.includes("<ArrayOfObjStation")) throw new ToolError("UPSTREAM_DOWN", "Irish Rail returned an unexpected station list.");
  return { url, stations: parseStations(r.value), cached: r.cached, stale: r.stale };
}

export function matchStations(stations: RailStation[], query: string): RailStation[] {
  const q = fold(query);
  const score = (s: RailStation) => {
    const names = [s.name, s.alias ?? "", s.code].map(fold);
    if (names.includes(q)) return 0;
    if (names.some((n) => n.startsWith(q))) return 1;
    if (names.some((n) => n.includes(q))) return 2;
    return 9;
  };
  return stations
    .map((s) => [score(s), s] as const)
    .filter(([sc]) => sc < 9)
    .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
    .map(([, s]) => s);
}

const findStationTool = defineTool({
  name: "rail_find_station",
  title: "Find an Irish Rail station",
  description: "Search Irish Rail / DART / Commuter / Intercity stations by name, alias or code. Returns station codes for rail_get_departures.",
  inputSchema: {
    query: z.string().min(2).max(60).describe("Station name, e.g. 'Pearse', 'Heuston', 'Galway'."),
    limit: z.number().int().min(1).max(50).default(10)
  },
  handler: async ({ query, limit }, ctx) => {
    const r = await loadStations(ctx);
    const b = bound(matchStations(r.stations, query), limit);
    return envelope(irishRailInfo, { data: { query, stations: b.items }, url: r.url, cached: r.cached, stale: r.stale, truncated: b.truncated });
  }
});

const departuresTool = defineTool({
  name: "rail_get_departures",
  title: "Live train departures",
  description:
    "Live Irish Rail trains (DART, Commuter, Intercity) due at a station in the next N minutes: due time, lateness, origin, destination and last known location.",
  inputSchema: {
    station: z.string().min(2).max(60).describe("Station name or code, e.g. 'Dublin Pearse', 'Cork', 'PERSE'."),
    minutes: z.number().int().min(5).max(90).default(60).describe("Look-ahead window in minutes (5-90).")
  },
  handler: async ({ station, minutes }, ctx) => {
    const { stations } = await loadStations(ctx);
    const found = matchStations(stations, station)[0];
    if (!found) throw new ToolError("NOT_FOUND", `No Irish Rail station matches '${station}'.`, { hint: "Use rail_find_station to look up the station name or code." });
    // The feed lists some stations under several internal codes (e.g. Adamstown); query them all.
    const codes = [...new Set(stations.filter((s) => s.name === found.name).map((s) => s.code))];
    const urlFor = (code: string) => `${RAIL_BASE}/getStationDataByCodeXML_WithNumMins?StationCode=${encodeURIComponent(code)}&NumMins=${minutes}`;
    const url = urlFor(found.code);
    const feeds = await Promise.all(codes.map((code) => ctx.cachedText(urlFor(code), MINUTE, { label: "Irish Rail departures" })));
    if (feeds.some((r) => !r.value.includes("<ArrayOfObjStationData"))) throw new ToolError("UPSTREAM_DOWN", "Irish Rail returned an unexpected departures format.");
    const seen = new Set<string>();
    const departures = feeds
      .flatMap((r) => blocks(r.value, "objStationData"))
      .map((b) => ({
        train_code: text(b, "Traincode") ?? "",
        type: text(b, "Traintype"),
        origin: text(b, "Origin"),
        destination: text(b, "Destination"),
        direction: text(b, "Direction"),
        due_in_min: int(text(b, "Duein")),
        late_min: int(text(b, "Late")),
        scheduled_departure: text(b, "Schdepart"),
        expected_departure: text(b, "Expdepart"),
        status: text(b, "Status"),
        last_location: text(b, "Lastlocation")
      }))
      .filter((d) => !seen.has(d.train_code) && seen.add(d.train_code))
      .sort((a, b) => (a.due_in_min ?? Infinity) - (b.due_in_min ?? Infinity));
    return envelope(irishRailInfo, {
      data: { station: { name: found.name, code: found.code, codes }, minutes, count: departures.length, departures },
      url,
      cached: feeds.every((r) => r.cached),
      stale: feeds.some((r) => r.stale)
    });
  }
});

export const irishRailModule: SourceModule = {
  info: irishRailInfo,
  summary: "Trains: Irish Rail station lookup and live DART/Commuter/Intercity departures.",
  tools: [findStationTool, departuresTool]
};
