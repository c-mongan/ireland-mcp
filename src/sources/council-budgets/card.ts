import type { SourceCard } from "../../gateway/cards.js";

export const councilBudgetsCard: SourceCard = {
  topics: ["public-finance", "housing", "economy"],
  geo_levels: ["local_authority"],
  time: { start: "2015", end: "2026", series: true, note: "Adopted budgets 2015–2026 are parsed. 2013–2014 workbooks use a legacy structure and are listed but not parsed." },
  cadence: "annual",
  dimensions: ["budget year", "council", "service division A–H (A = Housing and Building)", "budget line", "expenditure or income (EUR)"],
  join_keys: ["local_authority_name", "year"],
  freshness: "Department of Housing budget workbooks; the resource list was observed on 2026-10-25. Budget estimates, not actual spend.",
  auth: { required: false },
  examples: ["Division A housing expenditure for Cork City Council in 2025", "Compare Dublin City Council's 2024 and 2025 roads budgets (Division B)"]
};