import { z } from "zod";
import { MINUTE } from "../../gateway/context.js";
import { bound, envelope, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule, type ToolContext } from "../../gateway/module.js";

export const bikesInfo: SourceInfo = {
  id: "bikes",
  name: "Irish bike-share availability (CityBikes/GBFS)",
  licence: "CityBikes free service with attribution/link requirement; Dublin Bikes GBFS/Open Licence where supplied.",
  attribution:
    "Source: CityBikes API / PyBikes (citybik.es), with underlying operators including JCDecaux Dublin Bikes and TFI Bikes. Link to CityBikes when reusing.",
  homepage: "https://api.citybik.es/v2/"
};

const CITYBIKES = "https://api.citybik.es/v2";

interface Network {
  id: string;
  name: string;
  href: string;
  company?: string[] | string;
  system?: string;
  source?: string;
  gbfs_href?: string;
  license?: { name?: string; url?: string };
  location: { city: string; country: string; latitude: number; longitude: number };
}

interface Station {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  timestamp?: string;
  free_bikes?: number;
  empty_slots?: number;
  extra?: Record<string, unknown>;
}

const haversine = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const r = 6371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(a)));
};

async function networks(ctx: ToolContext) {
  const url = `${CITYBIKES}/networks?fields=id,name,href,company,system,source,gbfs_href,license,location`;
  const r = await ctx.cachedJson<{ networks?: Network[] }>(url, 10 * MINUTE, {
    label: "CityBikes networks",
    validate: (value) => {
      if (!Array.isArray(value.networks)) throw new ToolError("UPSTREAM_DOWN", "CityBikes returned an unexpected network list.");
    }
  });
  const irish = (r.value.networks ?? []).filter((n) => n.location?.country === "IE").sort((a, b) => a.location.city.localeCompare(b.location.city));
  return { ...r, url, networks: irish };
}

async function stationFeed(ctx: ToolContext, network: string) {
  if (!/^[a-z0-9_-]{2,60}$/i.test(network)) throw new ToolError("BAD_ARGS", "Network id must be a CityBikes network id.");
  const url = `${CITYBIKES}/networks/${encodeURIComponent(network)}?fields=id,name,location,stations`;
  const r = await ctx.cachedJson<{ network?: Network & { stations?: Station[] } }>(url, MINUTE, {
    label: "CityBikes stations",
    validate: (value) => {
      if (!value.network || !Array.isArray(value.network.stations)) throw new ToolError("UPSTREAM_DOWN", "CityBikes returned an unexpected station feed.");
    }
  });
  return { ...r, url, id: network, network: r.value.network! };
}

function publicNetwork(n: Network) {
  return {
    id: n.id,
    name: n.name,
    city: n.location.city,
    lat: n.location.latitude,
    lon: n.location.longitude,
    company: n.company,
    system: n.system,
    gbfs_href: n.gbfs_href ?? null,
    licence: n.license ?? null,
    source: n.source ?? `${CITYBIKES}${n.href}`
  };
}

const networksTool = defineTool({
  name: "bikes_networks",
  title: "List Irish bike-share networks",
  description: "List Irish bike-share systems visible through CityBikes, including Dublin Bikes and TFI Bikes city networks.",
  inputSchema: {},
  handler: async (_args, ctx) => {
    const r = await networks(ctx);
    return envelope(bikesInfo, { data: { networks: r.networks.map(publicNetwork) }, url: r.url, cached: r.cached, stale: r.stale });
  }
});

const stationsTool = defineTool({
  name: "bikes_stations_near",
  title: "Bike-share stations near a point",
  description: "Find Irish bike-share stations near a WGS84 point with free bikes, empty docks, ebikes and distance in metres.",
  inputSchema: {
    lat: z.number().min(51).max(56).describe("Latitude in Ireland."),
    lon: z.number().min(-11).max(-5).describe("Longitude in Ireland."),
    radius: z.number().int().min(50).max(20_000).default(1000).describe("Search radius in metres."),
    network: z.string().min(2).max(60).optional().describe("Optional CityBikes network id, e.g. dublinbikes, cork, galway.")
  },
  handler: async ({ lat, lon, radius, network }, ctx) => {
    const nets = await networks(ctx);
    const selected = network
      ? nets.networks.filter((n) => n.id === network)
      : nets.networks.filter((n) => haversine(lat, lon, n.location.latitude, n.location.longitude) <= Math.max(radius, 3000));
    if (network && selected.length === 0) throw new ToolError("NOT_FOUND", `No Irish CityBikes network '${network}'.`, { hint: "Use bikes_networks." });
    const feeds = await Promise.all(selected.map((n) => stationFeed(ctx, n.id)));
    const stations = feeds
      .flatMap((f) =>
        (f.network.stations ?? []).map((s) => ({
          network_id: f.network.id ?? f.id,
          network_name: f.network.name,
          station_id: s.id,
          name: s.name,
          lat: s.latitude,
          lon: s.longitude,
          distance_m: haversine(lat, lon, s.latitude, s.longitude),
          free_bikes: s.free_bikes ?? null,
          empty_slots: s.empty_slots ?? null,
          ebikes: typeof s.extra?.ebikes === "number" ? s.extra.ebikes : null,
          slots: typeof s.extra?.slots === "number" ? s.extra.slots : null,
          updated_at: s.timestamp ?? null
        }))
      )
      .filter((s) => s.distance_m <= radius)
      .sort((a, b) => a.distance_m - b.distance_m);
    const b = bound(stations, 50);
    return envelope(bikesInfo, {
      data: { lat, lon, radius_m: radius, networks_considered: selected.map((n) => n.id), stations: b.items },
      url: feeds[0]?.url ?? nets.url,
      cached: nets.cached && feeds.every((f) => f.cached),
      stale: nets.stale || feeds.some((f) => f.stale),
      truncated: b.truncated
    });
  }
});

export const bikesModule: SourceModule = {
  info: bikesInfo,
  summary: "Transport: Irish bike-share networks and nearby station availability from CityBikes/GBFS.",
  domain: "transport",
  coverage: "Irish CityBikes networks: Dublin Bikes and TFI Bikes in Cork, Galway, Limerick and Waterford where feeds are available.",
  tools: [networksTool, stationsTool]
};
