import { createCkanModule } from "../ckan/factory.js";

/** Discover each year's resources from CKAN; UUIDs and column names can change. */
export const ncseModule = createCkanModule({
  info: {
    id: "ncse",
    name: "National Council for Special Education open data",
    licence: "Creative Commons Attribution (see dataset for exact terms)",
    attribution: "School special-education teaching and SNA allocation data © National Council for Special Education.",
    homepage: "https://opendata.ncse.ie"
  },
  prefix: "ncse",
  portal: "NCSE open data",
  site: "https://opendata.ncse.ie",
  summary: "School allocations by academic year: special-education teaching (SET), special classes and special needs assistants (SNA). Allocations do not establish vacancies, capacity or school quality.",
  domain: "stats",
  examples: { query: "'school allocations' or 'special classes'", organization: "resource-allocation", dataset: "2026-2027-school-allocations" },
  coverage: "NCSE published school allocation datasets. Discover the academic year and its active datastore resources before querying; resource IDs and year-specific field names may change."
});

// Keep discovery generic, but supply examples verified against the published 2026–27 resource.
for (const tool of ncseModule.tools) {
  if (tool.name === "ncse_get_dataset") tool.example = { id: "2026-2027-school-allocations" };
  if (tool.name === "ncse_search_datasets") tool.example = { query: "school allocations", limit: 5 };
  if (tool.name === "ncse_query_datastore") tool.example = {
    resource_id: "f1f60760-d195-4be7-9a05-1a97159cbef6", filters: { "Roll Number": "00651R" }, limit: 5
  };
}
