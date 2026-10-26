import type { SourceCard } from "../../gateway/cards.js";

const ingested = "Only pages ingested by the operator's legal source sync; enacted text and consolidation cut-offs do not certify current law.";

export const irishLegalCard: SourceCard = {
  topics: ["law"],
  geo_levels: ["national"],
  time: { start: "unknown", end: "present", series: true, note: "Versioned documents with as_of lookups; coverage depends on what was ingested." },
  cadence: "irregular",
  dimensions: ["Act and section", "enacted or revised version", "amendment and commencement evidence", "citations with source dates"],
  join_keys: ["eli", "act_year_number"],
  freshness: `Stored snapshots with per-document source dates and legal-currentness warnings. ${ingested}`,
  auth: { required: false },
  examples: ["Revised text of section 3 of an Act as of a date, with citations", "What amendment evidence is stored for an Act?"],
  unknowns: { time: "Coverage depends on the operator's ingested corpus, which varies by deployment." }
};

export const citizensInfoCard: SourceCard = {
  topics: ["welfare", "law", "civic", "housing", "health", "labour"],
  geo_levels: ["national"],
  time: { start: "present", end: "present", series: false, note: "Current guidance as ingested, with versions." },
  cadence: "irregular",
  dimensions: ["article title and URL", "topic", "section text", "source date and version"],
  join_keys: [],
  freshness: `Stored Citizens Information snapshots with source dates. ${ingested}`,
  auth: { required: false },
  examples: ["Who qualifies for Jobseeker's Allowance?", "What does Citizens Information say about rent pressure zones?"],
  unknowns: { join_keys: "Guidance articles carry no structured place or statute keys." }
};
