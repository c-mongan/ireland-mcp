import type { SourceCard } from "../../gateway/cards.js";

export const tfiStaticCard: SourceCard = {
  topics: ["transport", "places"],
  geo_levels: ["point"],
  time: { start: "present", end: "present", series: false, note: "Current publisher snapshot of stop records." },
  cadence: "daily",
  dimensions: ["AtcoCode", "common name", "stop type", "coordinates", "snapshot date"],
  join_keys: ["atco_code", "lat_lon"],
  freshness: "TFI NaPTAN snapshot with its publisher date, cached daily. Not live services or schedules.",
  auth: { required: false },
  examples: ["Bus stops within 300 m of a point in Tallaght", "Stop details for an AtcoCode"]
};