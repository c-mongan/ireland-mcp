import type { SourceCard } from "../../gateway/cards.js";

export const bikesCard: SourceCard = {
  topics: ["transport"],
  geo_levels: ["point", "town"],
  time: { start: "live", end: "live", series: false },
  cadence: "live",
  dimensions: ["network", "station name and coordinates", "free bikes", "e-bikes", "empty docks", "distance (m)"],
  join_keys: ["lat_lon", "town_name"],
  freshness: "CityBikes and GBFS feeds, cached for a few minutes.",
  auth: { required: false },
  examples: ["Free Dublin Bikes near Trinity College", "Which Irish cities have bike-share?"]
};