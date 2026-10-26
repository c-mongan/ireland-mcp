import type { SourceCard } from "../../gateway/cards.js";

export const ntaCard: SourceCard = {
  topics: ["transport"],
  geo_levels: ["national"],
  time: { start: "live", end: "live", series: false, note: "Current GTFS-Realtime feed only." },
  cadence: "live",
  dimensions: ["GTFS route_id", "trip", "stop_id", "delay (seconds)", "cancellations"],
  join_keys: ["gtfs_route_id", "gtfs_stop_id"],
  freshness: "Live feed cached for one minute; results carry retrieved_at.",
  auth: { required: true, env: "NTA_API_KEY", error: "NOT_CONFIGURED", note: "The operator must set a free key from developer.nationaltransport.ie; without it every call returns NOT_CONFIGURED." },
  examples: ["Which bus routes have the most cancellations right now?", "Delays at stop 8220DB000007 now"]
};