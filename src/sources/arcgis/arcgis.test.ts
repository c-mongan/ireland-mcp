import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createContext } from "../../gateway/context.js";
import { createAppServer } from "../../registry.js";
import { fakeFetch } from "../../../test/helpers/fakeFetch.js";
import { callTool } from "../../../test/helpers/callTool.js";
import { planningModule } from "../planning/index.js";
import { censusAreasModule } from "../census-areas/index.js";
import { heritageModule } from "../heritage/index.js";
import { environmentSitesModule } from "../environment-sites/index.js";
import { queryLayer } from "./client.js";

const features = (attributes: Record<string, unknown>[]) => JSON.stringify({ features: attributes.map((a) => ({ attributes: a })) });

describe("allowlisted ArcGIS sources", () => {
  it("searches planning with validated filters and no raw caller SQL", async () => {
    const fetch = fakeFetch([
      {
        match: (url) => url.includes("IrishPlanningApplications") && url.includes("DevelopmentDescription+LIKE") && url.includes("distance=1000"),
        body: features([
          {
            PlanningAuthority: "Dublin City Council",
            ApplicationNumber: "WEB1234/24",
            DevelopmentDescription: "Apartments and shop",
            DevelopmentAddress: "Dublin 1",
            ReceivedDate: Date.UTC(2024, 0, 2),
            LinkAppDetails: "https://example.ie/planning/WEB1234"
          }
        ])
      }
    ]);
    const { body } = await callTool(
      planningModule,
      "planning_search",
      { lat: 53.3498, lon: -6.2603, text: "Apartments", from: "2024-01-01", limit: 5 },
      fetch
    );
    expect(body.data.applications[0]).toMatchObject({ council: "Dublin City Council", application_ref: "WEB1234/24", received_date: "2024-01-02" });
    expect(decodeURIComponent(fetch.calls[0]!.url).replace(/\+/g, " ")).toContain("ReceivedDate >= DATE '2024-01-01'");
  });

  it("gets a planning application by reference through ireland_call", async () => {
    const fetch = fakeFetch([
      {
        match: (url) => url.includes("IrishPlanningApplications") && url.includes("ApplicationNumber"),
        body: features([{ PlanningAuthority: "Carlow County Council", ApplicationNumber: "20289", Decision: "CONDITIONAL" }])
      }
    ]);
    const server = createAppServer(createContext({ fetch }));
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientSide);
    const result = await client.callTool({ name: "ireland_call", arguments: { source: "planning", operation: "planning_get", args: { application_ref: "20289" } } });
    const body = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(body.operation).toBe("planning_get");
    expect(body.data.applications[0]).toMatchObject({ application_ref: "20289", decision: "CONDITIONAL" });
    await client.close();
  });

  it("returns small-area identity and population at a point", async () => {
    const fetch = fakeFetch([
      {
        match: (url) => url.includes("SMALL_AREA_2022") && url.includes("geometry=-6.2603"),
        body: features([
          { SA_PUB2022: "268098009", SA_GEOGID_2022: "A268098009", ED_ENGLISH: "MERCHANTS QUAY A", ED_ID_STR: "268098", COUNTY_ENGLISH: "DUBLIN" }
        ])
      },
      {
        match: (url) => url.includes("CensusHub2022_T1_1_SA") && url.includes("A268098009"),
        body: features([{ SA_GEOGID_2022: "A268098009", T1_1AGETT: 254, T1_1AGETM: 134, T1_1AGETF: 120, COUNTY: "DUBLIN" }])
      }
    ]);
    const { body } = await callTool(censusAreasModule, "census_small_area_at", { lat: 53.3498, lon: -6.2603 }, fetch);
    expect(body.data.area.small_area).toMatchObject({ code: "268098009", population: 254, male: 134, female: 120 });
    expect(body.data.area.electoral_division.name).toBe("MERCHANTS QUAY A");
  });

  it("finds SMR monuments near a point", async () => {
    const fetch = fakeFetch([
      {
        match: (url) => url.includes("SMROpenData") && url.includes("distance=500"),
        body: features([{ SMRS: "DU018-020----", COUNTY: "DUBLIN", TOWNLAND: "DUBLIN SOUTH CITY", MONUMENT_CLASS: "Castle - tower house", LATITUDE: 53.34, LONGITUDE: -6.27 }])
      }
    ]);
    const { body } = await callTool(heritageModule, "heritage_monuments_near", { lat: 53.3498, lon: -6.2603, radius_m: 500, limit: 5 }, fetch);
    expect(body.data.monuments[0]).toMatchObject({ smr: "DU018-020----", class: "Castle - tower house" });
  });

  it("queries protected site layers and rejects non-allowlisted URLs", async () => {
    const fetch = fakeFetch([
      { match: (url) => url.includes("FeatureServer/0/query"), body: features([{ SITECODE: "004024", SITE_NAME: "South Dublin Bay and River Tolka Estuary SPA" }]) },
      { match: (url) => url.includes("FeatureServer/1/query"), body: features([]) },
      { match: (url) => url.includes("FeatureServer/2/query"), body: features([]) },
      { match: (url) => url.includes("FeatureServer/3/query"), body: features([{ SITECODE: "000210", SITE_NAME: "South Dublin Bay SAC" }]) }
    ]);
    const { body } = await callTool(environmentSitesModule, "protected_sites_at", { lat: 53.33, lon: -6.16, limit: 4 }, fetch);
    expect(body.data.sites.map((s: { type: string }) => s.type)).toEqual(["SPA", "SAC"]);
    await expect(queryLayer(createContext({ fetch }), "https://example.com/arcgis/rest/services/Evil/FeatureServer/0", {})).rejects.toMatchObject({ code: "BAD_ARGS" });
  });
});
