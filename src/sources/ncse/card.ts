import type { SourceCard } from "../../gateway/cards.js";

export const ncseCard: SourceCard = {
  topics: ["education"],
  geo_levels: ["county", "point"],
  time: { start: "unknown", end: "present", series: true, note: "One dataset per academic year; discover the available years with ncse_search_datasets." },
  cadence: "annual",
  dimensions: ["academic year", "school (roll number, name, address, county)", "special education teaching hours", "special classes", "SNA allocations"],
  join_keys: ["school_roll_number", "county_name", "dataset_id", "year"],
  freshness: "As published on the NCSE CKAN portal; resource IDs and field names can change between years.",
  auth: { required: false },
  examples: ["How many SNA allocations did schools in County Mayo get in 2025/26?", "Which schools have the most special classes this year?"],
  unknowns: { time: "The first academic year in the NCSE portal has not been verified." }
};