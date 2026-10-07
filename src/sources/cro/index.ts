import { createCkanModule } from "../ckan/factory.js";

export const croModule = createCkanModule({
  info: {
    id: "cro",
    name: "Companies Registration Office open data",
    licence: "Creative Commons Attribution 4.0",
    attribution: "Company and financial-statement open data © Companies Registration Office (CRO).",
    homepage: "https://opendata.cro.ie"
  },
  prefix: "cro",
  portal: "CRO open data",
  site: "https://opendata.cro.ie",
  summary: "Irish companies register open data: company records and financial-statement datasets.",
  domain: "economy",
  examples: { query: "'company register' or 'financial statements'", organization: "companies", dataset: "companies" },
  coverage: "CRO CKAN catalogue and queryable datastore resources for company and financial-statement records."
});
