import type { SourceCard } from "../../gateway/cards.js";

export const irishRailCard: SourceCard = {
  topics: ["transport"],
  geo_levels: ["point"],
  time: { start: "live", end: "live", series: false, note: "Departures in the next 90 minutes." },
  cadence: "live",
  dimensions: ["station (name, code, coordinates)", "train code", "origin and destination", "due and expected time", "lateness (minutes)"],
  join_keys: ["rail_station_code", "lat_lon"],
  freshness: "Live Irish Rail realtime API; results carry retrieved_at.",
  auth: { required: false },
  examples: ["Next DART departures from Connolly", "Is the Cork train from Heuston running late?"]
};