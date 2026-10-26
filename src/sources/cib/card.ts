import type { SourceCard } from "../../gateway/cards.js";

export const cibCard: SourceCard = {
  topics: ["welfare", "civic", "housing", "health"],
  geo_levels: ["national"],
  time: { start: "2021", end: "2025", series: true, note: "Annual national aggregates 2021–2025; no county breakdown." },
  cadence: "annual",
  dimensions: ["year", "callers", "queries", "query category (Social Welfare, Housing, Health…)", "phone-service contacts by mode"],
  join_keys: ["year"],
  freshness: "Pinned Citizens Information Board Data Hub reports with SHA-256 checksums; as_of is returned with each result. Not live.",
  auth: { required: false },
  examples: ["How did Social Welfare queries to Citizens Information change from 2023 to 2025?", "Share of 2025 queries about housing"]
};