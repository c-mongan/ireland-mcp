import { z } from "zod";
import { DAY, MINUTE } from "../../gateway/context.js";
import { envelope, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { decodeXml as decode } from "../../gateway/xml.js";
import { defineTool, type SourceModule, type ToolContext } from "../../gateway/module.js";

export const luasInfo: SourceInfo = {
  id: "luas",
  name: "Luas Forecasting API (Transport Infrastructure Ireland)",
  licence: "CC BY 4.0",
  attribution: "Source: Transport Infrastructure Ireland, Luas Forecasting API (luasforecasts.rpa.ie). Licence: CC BY 4.0.",
  homepage: "https://data.gov.ie/dataset/luas-forecasting-api"
};

export const LUAS_BASE = "https://luasforecasts.rpa.ie/xml/get.ashx";

const attr = (tag: string, name: string) => {
  const v = tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
  return v === undefined ? null : decode(v);
};
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f'’.-]/g, "").replace(/\bst\b|\bsaint\b/g, "").replace(/\s+/g, " ").trim().toLowerCase();

export interface LuasStop {
  name: string;
  code: string;
  line: "Red" | "Green";
  lat: number;
  lon: number;
  park_and_ride: boolean;
}

export function parseStops(xml: string): LuasStop[] {
  const stops: LuasStop[] = [];
  for (const [, lineName = "", body = ""] of xml.matchAll(/<line name="([^"]*)">([\s\S]*?)<\/line>/g)) {
    const line = /green/i.test(lineName) ? "Green" : "Red";
    for (const [, tag = "", name = ""] of body.matchAll(/<stop\b([^>]*)>([^<]*)<\/stop>/g)) {
      stops.push({
        name: decode(name.trim()),
        code: attr(tag, "abrev") ?? "",
        line,
        lat: Number(attr(tag, "lat")),
        lon: Number(attr(tag, "long")),
        park_and_ride: attr(tag, "isParkRide") === "1"
      });
    }
  }
  return stops;
}

async function loadStops(ctx: ToolContext) {
  const url = `${LUAS_BASE}?action=stops&encrypt=false`;
  const r = await ctx.cachedText(url, DAY, { label: "Luas stops" });
  if (!r.value.includes("<stops")) throw new ToolError("UPSTREAM_DOWN", "Luas returned an unexpected stop list.");
  return { url, stops: parseStops(r.value), cached: r.cached, stale: r.stale };
}

export function findStop(stops: LuasStop[], query: string): LuasStop | undefined {
  const q = fold(query);
  return (
    stops.find((s) => s.code.toLowerCase() === query.trim().toLowerCase()) ??
    stops.find((s) => fold(s.name) === q) ??
    stops.find((s) => fold(s.name).startsWith(q)) ??
    stops.find((s) => fold(s.name).includes(q))
  );
}

const trams = (body: string) =>
  [...body.matchAll(/<tram\b([^>]*)\/>/g)]
    .map(([, tag = ""]) => {
      const due = attr(tag, "dueMins");
      return { destination: attr(tag, "destination") ?? "", due_in_min: due === "DUE" ? 0 : due?.trim() ? Number(due) : Number.NaN };
    })
    .filter((t) => t.destination && Number.isFinite(t.due_in_min) && !/no trams/i.test(t.destination));

const forecastTool = defineTool({
  name: "luas_get_forecast",
  title: "Live Luas tram times",
  description: "Live Luas (Dublin tram, Red and Green lines) arrivals at a stop, inbound and outbound, with any service disruption message.",
  inputSchema: {
    stop: z.string().min(2).max(60).describe("Stop name or code, e.g. 'St. Stephen's Green', 'Heuston', 'STS'.")
  },
  handler: async ({ stop }, ctx) => {
    const { stops } = await loadStops(ctx);
    const found = findStop(stops, stop);
    if (!found) throw new ToolError("NOT_FOUND", `No Luas stop matches '${stop}'.`, { hint: "Use luas_list_stops to see stop names and codes." });
    const url = `${LUAS_BASE}?action=forecast&stop=${encodeURIComponent(found.code)}&encrypt=false`;
    const r = await ctx.cachedText(url, MINUTE / 2, { label: "Luas forecast" });
    if (!r.value.includes("<stopInfo")) throw new ToolError("UPSTREAM_DOWN", "Luas returned an unexpected forecast format.");
    const direction = (name: string) => trams(r.value.match(new RegExp(`<direction name="${name}">([\\s\\S]*?)</direction>`))?.[1] ?? "");
    const message = r.value.match(/<message>([\s\S]*?)<\/message>/)?.[1]?.trim();
    return envelope(luasInfo, {
      data: {
        stop: { name: found.name, code: found.code, line: found.line },
        message: message ? decode(message) : null,
        inbound: direction("Inbound"),
        outbound: direction("Outbound")
      },
      url,
      cached: r.cached,
      stale: r.stale
    });
  }
});

const listStopsTool = defineTool({
  name: "luas_list_stops",
  title: "List Luas stops",
  description: "All Luas stops with codes, line (Red/Green), coordinates and Park & Ride flag. Optionally filter by line.",
  inputSchema: {
    line: z.enum(["Red", "Green"]).optional().describe("Only stops on this line.")
  },
  handler: async ({ line }, ctx) => {
    const r = await loadStops(ctx);
    const stops = line ? r.stops.filter((s) => s.line === line) : r.stops;
    return envelope(luasInfo, { data: { count: stops.length, stops }, url: r.url, cached: r.cached, stale: r.stale });
  }
});

export const luasModule: SourceModule = {
  info: luasInfo,
  summary: "Trams: live Luas arrival times and the stop list for the Red and Green lines.",
  domain: "transport",
  coverage: "Dublin Luas Red and Green line stops with live arrival forecasts.",
  tools: [forecastTool, listStopsTool]
};
