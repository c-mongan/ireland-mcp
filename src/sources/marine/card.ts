import type { SourceCard } from "../../gateway/cards.js";

export const marineCard: SourceCard = {
  topics: ["weather", "environment"],
  geo_levels: ["point"],
  time: { start: "live", end: "live", series: false, note: "Latest hourly readings only." },
  cadence: "hourly",
  dimensions: ["buoy id and position", "wind speed and gusts", "wave height and period", "air and sea temperature", "pressure"],
  join_keys: ["lat_lon"],
  freshness: "Marine Institute ERDDAP; latest hourly reading with its timestamp.",
  auth: { required: false },
  examples: ["Wave height at the M6 buoy now", "Sea temperature off the west coast today"]
};