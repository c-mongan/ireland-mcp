import type { SourceCard } from "../../gateway/cards.js";

export const lobbyingCard: SourceCard = {
  topics: ["lobbying", "politics", "law"],
  geo_levels: ["national"],
  time: { start: "2015-09", end: "present", series: true, note: "The register began on 1 September 2015. One search covers at most 366 days." },
  cadence: "daily",
  dimensions: ["lobbyist", "designated public official", "subject matter", "intended results", "return period and date", "number of returns"],
  join_keys: ["company_name", "date"],
  freshness: "Returns appear as filed with SIPO. Results carry retrieved_at; cached for an hour.",
  auth: { required: false },
  examples: ["How many lobbying returns in 2024 mention the Planning and Development Bill?", "Which officials were lobbied about housing supply this year?"]
};