import type { SourceCard } from "../../gateway/cards.js";

export const gsiCard: SourceCard = {
  topics: ["water", "environment", "geography"],
  geo_levels: ["point"],
  time: { start: "unknown", end: "unknown", series: false, note: "One map edition at 1:40,000." },
  cadence: "irregular",
  dimensions: ["vulnerability category", "description", "polygon id"],
  join_keys: ["lat_lon"],
  freshness: "GSI ArcGIS layer; the dataset revision is unknown.",
  auth: { required: false },
  examples: ["Groundwater vulnerability at a proposed septic-tank site", "Is this point in an extreme vulnerability zone?"],
  unknowns: { time: "GSI does not state the map revision date in the layer metadata used here." }
};