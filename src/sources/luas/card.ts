import type { SourceCard } from "../../gateway/cards.js";

export const luasCard: SourceCard = {
  topics: ["transport"],
  geo_levels: ["point"],
  time: { start: "live", end: "live", series: false },
  cadence: "live",
  dimensions: ["stop (code, name, line, coordinates, Park & Ride)", "direction", "destination", "minutes due", "service message"],
  join_keys: ["luas_stop_code", "lat_lon"],
  freshness: "Live Luas forecasting API; the stop list is static.",
  auth: { required: false },
  examples: ["Next Luas trams at Heuston", "Which Luas Green line stops have Park & Ride?"]
};