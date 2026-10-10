import { z } from "zod";
import { MINUTE } from "../../gateway/context.js";
import { bound, DEFAULT_LIMIT, envelope, MAX_LIMIT, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule, type ToolContext } from "../../gateway/module.js";

export const ntaInfo: SourceInfo = {
  id: "nta",
  name: "National Transport Authority GTFS-Realtime",
  licence: "CC BY 4.0",
  attribution: "Contains data from the National Transport Authority (Transport for Ireland), licensed under CC BY 4.0.",
  homepage: "https://developer.nationaltransport.ie"
};

export const TRIP_UPDATES_URL = "https://api.nationaltransport.ie/gtfsr/v2/TripUpdates?format=json";
/** The NTA allows roughly one feed download per minute per key; every caller shares one load. */
const TTL = MINUTE;
const CACHE_KEY = "nta:trip-updates:v1";
const PUBLIC_URL = "https://developer.nationaltransport.ie/api-details#api=gtfsr";

export interface StopUpdate {
  stop_sequence: number | null;
  stop_id: string | null;
  arrival_delay_s: number | null;
  departure_delay_s: number | null;
  status: string;
}

export interface TripUpdate {
  trip_id: string;
  route_id: string | null;
  start_date: string | null;
  start_time: string | null;
  status: string;
  stops: StopUpdate[];
}

export interface Feed {
  timestamp: string | null;
  trips: TripUpdate[];
}

type Raw = Record<string, unknown>;
// The JSON rendering of the protobuf feed has used both snake_case and camelCase field names.
const pick = (o: unknown, snake: string): unknown => {
  if (!o || typeof o !== "object") return undefined;
  const r = o as Raw;
  if (snake in r) return r[snake];
  const camel = snake.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
  if (camel in r) return r[camel];
  const pascal = camel.charAt(0).toUpperCase() + camel.slice(1);
  return r[pascal];
};
const str = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));
const int = (v: unknown) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const object = (value: unknown): value is Raw => value !== null && typeof value === "object" && !Array.isArray(value);

/** Reject error documents before they can become cached empty feeds. */
function assertFeedEnvelope(raw: unknown): void {
  const header = pick(raw, "header");
  const version = pick(header, "gtfs_realtime_version");
  const timestamp = pick(header, "timestamp");
  const seconds = typeof timestamp === "number" || (typeof timestamp === "string" && /^\d+$/.test(timestamp))
    ? Number(timestamp) : NaN;
  const entities = pick(raw, "entity");
  if (!object(raw) || !object(header) || typeof version !== "string" || !["1.0", "2.0"].includes(version)
    || !Number.isSafeInteger(seconds) || seconds < 0 || seconds > 8_640_000_000_000
    || (entities !== undefined && (!Array.isArray(entities) || !entities.every(object)))) {
    throw new ToolError("UPSTREAM_DOWN", "NTA returned a malformed GTFS-Realtime feed.", { retryable: false });
  }
}

export function normaliseFeed(raw: unknown): Feed {
  assertFeedEnvelope(raw);
  const entities = pick(raw, "entity");
  const header = pick(raw, "header");
  const ts = int(pick(header, "timestamp"));
  const trips: TripUpdate[] = [];
  for (const entity of Array.isArray(entities) ? entities : []) {
    const tu = pick(entity, "trip_update");
    if (!tu) continue;
    const trip = pick(tu, "trip");
    const stus = pick(tu, "stop_time_update");
    trips.push({
      trip_id: str(pick(trip, "trip_id")) ?? str(pick(entity, "id")) ?? "unknown",
      route_id: str(pick(trip, "route_id")),
      start_date: str(pick(trip, "start_date")),
      start_time: str(pick(trip, "start_time")),
      status: str(pick(trip, "schedule_relationship")) ?? "SCHEDULED",
      stops: (Array.isArray(stus) ? stus : []).map((s) => ({
        stop_sequence: int(pick(s, "stop_sequence")),
        stop_id: str(pick(s, "stop_id")),
        arrival_delay_s: int(pick(pick(s, "arrival"), "delay")),
        departure_delay_s: int(pick(pick(s, "departure"), "delay")),
        status: str(pick(s, "schedule_relationship")) ?? "SCHEDULED"
      }))
    });
  }
  return { timestamp: ts === null ? null : new Date(ts * 1000).toISOString(), trips };
}

export async function loadFeed(ctx: ToolContext) {
  const key = ctx.env.NTA_API_KEY?.trim();
  if (!key) {
    throw new ToolError("NOT_CONFIGURED", "NTA real-time data is not configured on this server.", {
      hint: "The operator must set the NTA_API_KEY app setting (free key from developer.nationaltransport.ie)."
    });
  }
  // Normalise inside the loader so the cache holds the compact form, not the multi-MB raw feed.
  return ctx.cache.getOrLoad<Feed>(CACHE_KEY, TTL, async () =>
    normaliseFeed(
      await ctx.http.json(TRIP_UPDATES_URL, {
        headers: { "x-api-key": key, "cache-control": "no-cache" },
        label: "NTA GTFS-Realtime",
        maxBytes: 60 * 1024 * 1024,
        timeoutMs: 20_000
      })
    )
  );
}

const lastDelay = (t: TripUpdate) => {
  for (let i = t.stops.length - 1; i >= 0; i -= 1) {
    const s = t.stops[i]!;
    const d = s.arrival_delay_s ?? s.departure_delay_s;
    if (d !== null) return d;
  }
  return null;
};

export function summarise(feed: Feed) {
  const routes = new Map<string, { route_id: string; trips: number; cancelled: number; added: number; delays: number[] }>();
  for (const t of feed.trips) {
    const id = t.route_id ?? "unknown";
    const r = routes.get(id) ?? { route_id: id, trips: 0, cancelled: 0, added: 0, delays: [] };
    r.trips += 1;
    if (t.status === "CANCELED" || t.status === "CANCELLED") r.cancelled += 1;
    if (t.status === "ADDED") r.added += 1;
    const d = lastDelay(t);
    if (d !== null) r.delays.push(d);
    routes.set(id, r);
  }
  const rows = [...routes.values()].map(({ delays, ...r }) => ({
    ...r,
    avg_delay_s: delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : null,
    max_delay_s: delays.length ? Math.max(...delays) : null
  }));
  rows.sort((a, b) => b.cancelled - a.cancelled || (b.avg_delay_s ?? 0) - (a.avg_delay_s ?? 0));
  return {
    feed_timestamp: feed.timestamp,
    trips: feed.trips.length,
    cancelled: rows.reduce((n, r) => n + r.cancelled, 0),
    added: rows.reduce((n, r) => n + r.added, 0),
    routes: rows
  };
}

const summaryTool = defineTool({
  name: "nta_get_realtime_summary",
  title: "Public transport disruption summary",
  description:
    "Live summary of the NTA GTFS-Realtime feed (Dublin Bus, Bus Éireann, Go-Ahead, Luas, Irish Rail): trips, cancellations and delays per GTFS route_id, worst first.",
  inputSchema: {
    limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT).describe("Maximum routes to list.")
  },
  handler: async ({ limit }, ctx) => {
    const r = await loadFeed(ctx);
    const s = summarise(r.value);
    const routes = bound(s.routes, limit);
    return envelope(ntaInfo, {
      data: { ...s, routes: routes.items, note: "route_id values are GTFS identifiers from the NTA static GTFS feed." },
      url: PUBLIC_URL,
      cached: r.cached,
      stale: r.stale,
      truncated: routes.truncated
    });
  }
});

const tripsTool = defineTool({
  name: "nta_get_trip_updates",
  title: "Live trip updates",
  description:
    "Live NTA GTFS-Realtime trip updates filtered by GTFS route_id and/or stop_id (e.g. '8220DB000007'), with per-stop delays in seconds.",
  inputSchema: {
    route_id: z.string().max(64).optional().describe("GTFS route_id, e.g. '4497_86595'."),
    stop_id: z.string().max(64).optional().describe("GTFS stop_id, e.g. '8220DB000007'."),
    status: z.enum(["SCHEDULED", "CANCELED", "ADDED"]).optional().describe("Only trips with this schedule relationship."),
    limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT)
  },
  handler: async ({ route_id, stop_id, status, limit }, ctx) => {
    const r = await loadFeed(ctx);
    const trips = r.value.trips
      .filter((t) => !route_id || t.route_id === route_id)
      .filter((t) => !status || t.status === status)
      .map((t) => (stop_id ? { ...t, stops: t.stops.filter((s) => s.stop_id === stop_id) } : t))
      .filter((t) => !stop_id || t.stops.length > 0);
    const page = bound(trips, limit);
    return envelope(ntaInfo, {
      data: { feed_timestamp: r.value.timestamp, total: trips.length, trips: page.items },
      url: PUBLIC_URL,
      cached: r.cached,
      stale: r.stale,
      truncated: page.truncated
    });
  }
});

export const ntaModule: SourceModule = {
  info: ntaInfo,
  summary: "Live public transport: GTFS-Realtime cancellations and delays (needs a server-side NTA key).",
  domain: "transport",
  coverage: "GTFS-Realtime trip updates for Dublin Bus, Bus Éireann, Go-Ahead and other NTA-licensed services; needs a server-side key.",
  tools: [summaryTool, tripsTool]
};
