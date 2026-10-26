import type { SourceCard } from "../../gateway/cards.js";

export const planningCard: SourceCard = {
  topics: ["planning", "housing", "property"],
  geo_levels: ["local_authority", "point"],
  time: { start: "unknown", end: "present", series: true, note: "Received dates span many years; council coverage varies." },
  cadence: "irregular",
  dimensions: ["application reference", "planning authority", "development description and address", "received and decision dates", "decision", "coordinates"],
  join_keys: ["planning_ref", "local_authority_name", "lat_lon", "date"],
  freshness: "Department of Housing NPAD ArcGIS layer; refresh schedule set by the publisher. Results are capped at 100 rows with no total.",
  auth: { required: false },
  examples: ["Planning applications within 500 m of a Luas stop since 2024", "Status of application 23/1234 in Galway County Council"],
  unknowns: { time: "The earliest received date per council has not been verified." }
};