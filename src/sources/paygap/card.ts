import type { SourceCard } from "../../gateway/cards.js";

export const paygapCard: SourceCard = {
  topics: ["labour", "income", "business"],
  geo_levels: ["national"],
  time: { start: "2022", end: "present", series: true, note: "Employer reports under the Gender Pay Gap Information Act 2021; the first reporting year was 2022." },
  cadence: "annual",
  dimensions: ["employer", "report year", "NACE industry", "mean and median hourly pay gap", "bonus gap", "part-time and temporary gaps", "quartile shares"],
  join_keys: ["company_name", "nace_code", "year"],
  freshness: "Combined PayGap.ie export; when the export is refused an explicitly dated publisher snapshot is served and flagged.",
  auth: { required: false },
  examples: ["Median gender pay gap of financial-services employers in 2024", "Which employers reported a negative mean pay gap in 2023?"]
};