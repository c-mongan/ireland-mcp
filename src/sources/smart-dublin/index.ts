import { createCkanModule } from "../ckan/factory.js";

export const smartDublinModule = createCkanModule({
  info: {
    id: "smart-dublin",
    name: "Smart Dublin open data (Dublin local authorities)",
    licence: "Per dataset (mostly CC BY 4.0); see each dataset's licence field",
    attribution: "Data from Smart Dublin (data.smartdublin.ie) and the four Dublin local authorities.",
    homepage: "https://data.smartdublin.ie"
  },
  prefix: "smartdublin",
  portal: "Smart Dublin",
  site: "https://data.smartdublin.ie",
  summary: "Dublin city/county datasets: cycle counters, parking, footfall, planning, environment; queryable tables.",
  domain: "stats",
  coverage: "Dublin's four local authorities' open-data catalogue (transport, environment, footfall, bikes), plus DataStore rows."
});
