import { createCkanModule } from "../ckan/factory.js";

export const dataGovIeModule = createCkanModule({
  info: {
    id: "data-gov-ie",
    name: "data.gov.ie (Ireland's open data portal)",
    licence: "Per dataset (mostly CC BY 4.0); see each dataset's licence field",
    attribution: "Catalogue metadata from data.gov.ie, Department of Public Expenditure, NDP Delivery and Reform. Data © the publishing body.",
    homepage: "https://data.gov.ie"
  },
  prefix: "datagov",
  portal: "data.gov.ie",
  site: "https://data.gov.ie",
  summary: "National open-data catalogue: find datasets from any public body and read their resources.",
  domain: "stats",
  coverage: "Metadata for every dataset in the national open-data portal, plus DataStore rows where the publisher loaded them."
});
