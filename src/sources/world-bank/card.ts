import type { SourceCard } from "../../gateway/cards.js";

export const worldBankCard: SourceCard = {
  topics: ["economy", "population", "international", "labour", "prices", "environment"],
  geo_levels: ["national"],
  time: { start: "1960", end: "present", series: true, note: "Most indicators start in 1960 or later; the latest year lags by one to two years." },
  cadence: "annual",
  dimensions: ["indicator", "country (ISO3)", "year", "value"],
  join_keys: ["iso3_country", "year"],
  freshness: "World Bank Open Data; the latest observation year is returned with each value. Cached for a day.",
  auth: { required: false },
  examples: ["Ireland's GDP per capita over the last 10 years", "Compare Ireland's and Denmark's unemployment rate"]
};