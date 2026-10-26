import type { SourceCard } from "../../gateway/cards.js";

export const croCard: SourceCard = {
  topics: ["business"],
  geo_levels: ["national", "county"],
  time: { start: "unknown", end: "present", series: true, note: "Per dataset." },
  cadence: "irregular",
  dimensions: ["company number and name", "status", "registered address", "registration date", "financial-statement records"],
  join_keys: ["company_number", "company_name", "county_name", "dataset_id"],
  freshness: "CRO open-data CKAN resources as published; each resource has its own modified date.",
  auth: { required: false },
  examples: ["Find a company's registration number and status", "Companies registered in 2024 with an address in Kerry"],
  unknowns: { time: "Coverage varies by dataset." }
};