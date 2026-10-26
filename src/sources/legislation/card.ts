import type { SourceCard } from "../../gateway/cards.js";

export const legislationCard: SourceCard = {
  topics: ["law", "politics"],
  geo_levels: ["national"],
  time: { start: "1922", end: "present", series: true, note: "Acts as enacted and SIs as made from 1922; not consolidated (as-amended) text." },
  cadence: "daily",
  dimensions: ["Act or SI year and number", "title", "enactment or made date", "sections and text", "amendments, repeals and commencements", "EU acts transposed", "Constitution articles"],
  join_keys: ["eli", "act_year_number", "si_year_number", "year"],
  freshness: "Irish Statute Book (eISB); new Acts appear after publication. Text is as enacted; check legislation_get_act_effects before relying on it. Cached for a day.",
  auth: { required: false },
  examples: ["Which Acts with 'Residential Tenancies' in the title were enacted in 2021?", "Text of section 2 of Act 7 of 2018", "Has section 34 of the Planning and Development Act 2000 been amended?"],
  operations: {
    legislation_get_constitution_article: { time: { start: "1937", end: "present", series: false }, join_keys: ["eli"], examples: ["What does Article 40.3 say?"] }
  }
};