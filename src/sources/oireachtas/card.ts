import type { SourceCard } from "../../gateway/cards.js";

export const oireachtasCard: SourceCard = {
  topics: ["politics", "law"],
  geo_levels: ["national", "constituency"],
  time: { start: "1919", end: "present", series: true, note: "Members and debates go back to the First Dáil (1919); coverage of bills, questions and votes starts later." },
  cadence: "daily",
  dimensions: ["member (name, party, constituency, member_code)", "bill (title, year, number, status, stages)", "sitting day and debate topics", "parliamentary question", "division (Tá/Níl/Staon)"],
  join_keys: ["member_code", "constituency_name", "party_name", "bill_ref", "act_year_number", "eli", "date"],
  freshness: "Oireachtas Open Data API; updated as the Houses sit. Cached for an hour.",
  auth: { required: false },
  examples: ["Who are the TDs for Galway West?", "What stage is the Planning and Development Bill 2023 at?", "Which ministers answered the most parliamentary questions from a TD last month?"],
  operations: {
    oireachtas_search_members: { geo_levels: ["constituency"], dimensions: ["name", "party", "constituency or panel", "member_code", "seat dates"], join_keys: ["member_code", "constituency_name", "party_name"], examples: ["Who are the TDs for Dublin South-West?"] },
    oireachtas_search_bills: {
      geo_levels: ["national"],
      time: { start: "unknown", end: "present", series: true },
      join_keys: ["bill_ref", "act_year_number", "year"],
      unknowns: { time: "The earliest bill year in the Oireachtas API has not been verified." },
      examples: ["Bills about housing enacted in 2024"]
    },
    oireachtas_get_bill: {
      geo_levels: ["national"],
      time: { start: "unknown", end: "present", series: false },
      dimensions: ["bill year and number", "status", "sponsors", "stages with chamber and date", "published versions", "Act number, date signed and ELI"],
      join_keys: ["bill_ref", "act_year_number", "eli", "date"],
      unknowns: { time: "The earliest bill year in the Oireachtas API has not been verified." },
      examples: ["Which bill became the Data Protection Act 2018, and when was it signed?"]
    },
    oireachtas_search_questions: {
      time: { start: "unknown", end: "present", series: true },
      join_keys: ["member_code", "date"],
      unknowns: { time: "The earliest parliamentary question in the API has not been verified." },
      examples: ["Written questions asked by a TD in 2025"]
    },
    oireachtas_get_votes: {
      geo_levels: ["national"],
      time: { start: "unknown", end: "present", series: true },
      join_keys: ["date"],
      unknowns: { time: "The earliest recorded division in the API has not been verified." },
      examples: ["How did the Dáil vote last week?"]
    },
    oireachtas_get_debates: { geo_levels: ["national"], join_keys: ["date"], examples: ["What did the Seanad debate on 1 October 2025?"] }
  }
};