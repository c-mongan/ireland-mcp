import type { SourceCard } from "../../gateway/cards.js";

export const heritageCard: SourceCard = {
  topics: ["heritage", "places"],
  geo_levels: ["point", "county"],
  time: { start: "present", end: "present", series: false, note: "Current Sites and Monuments Record entries." },
  cadence: "irregular",
  dimensions: ["SMR number", "monument class", "townland", "county", "coordinates", "distance (m)"],
  join_keys: ["lat_lon", "county_name"],
  freshness: "National Monuments Service ArcGIS layer; updated by the publisher on its own schedule.",
  auth: { required: false },
  examples: ["Recorded monuments within 1 km of Kilkenny Castle", "Ringforts near a proposed site"]
};