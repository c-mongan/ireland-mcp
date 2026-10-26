import type { SourceCard } from "../../gateway/cards.js";

export const wikidataCard: SourceCard = {
  topics: ["places", "geography", "population"],
  geo_levels: ["county", "town", "point"],
  time: { start: "present", end: "present", series: false, note: "Current Wikidata statements; population figures carry their own point-in-time qualifiers." },
  cadence: "irregular",
  dimensions: ["entity (QID, label, Irish name)", "population", "county or admin area", "coordinates", "description"],
  join_keys: ["wikidata_qid", "lat_lon", "county_name", "town_name"],
  freshness: "Community-edited and live; check figures against the CSO before relying on them.",
  auth: { required: false },
  examples: ["Wikidata QID and coordinates for Galway city", "Irish name and county of Kenmare"]
};