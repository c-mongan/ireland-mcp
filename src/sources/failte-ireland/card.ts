import type { SourceCard } from "../../gateway/cards.js";

export const failteIrelandCard: SourceCard = {
  topics: ["tourism", "places", "business"],
  geo_levels: ["county", "town", "point"],
  time: { start: "present", end: "present", series: false, note: "Current listings only." },
  cadence: "irregular",
  dimensions: ["name", "sector or category", "rating", "registration number", "address, town, county, Eircode", "coordinates", "total units"],
  join_keys: ["county_name", "town_name", "eircode_routing_key", "lat_lon"],
  freshness: "Published Fáilte Ireland CSV exports; retrieval time is not a source update date. Stale exports are flagged.",
  auth: { required: false },
  examples: ["How many registered hotels are in County Kerry?", "Tourist attractions in Galway tagged 'walking'"]
};