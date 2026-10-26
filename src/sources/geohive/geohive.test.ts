import { describe, expect, it } from "vitest";
import { createContext } from "../../gateway/context.js";
import { fakeFetch, type Route } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { BOUNDARY_LAYERS, geohiveModule as mod } from "./index.js";

const f = (name: string) => fixturePath(import.meta.url, name);
const pointRoutes: Route[] = BOUNDARY_LAYERS.map((layer) => ({
  match: (url: string) => url.includes(`/services/${layer.service}/`) && url.includes("geometry=-6.2603"),
  file: f(`point-${layer.service}.json`)
}));
const serviceMetadata: Route = { match: /Counties___OSi_National_Statutory_Boundaries\/FeatureServer\?f=json$/, body: JSON.stringify({ layers: [{ id: 0, name: "Counties", type: "Feature Layer" }] }) };
const routes: Route[] = [
  serviceMetadata,
  ...pointRoutes,
  { match: (url) => url.includes("geometry=-10.5"), body: '{"features":[]}' },
  { match: /services\?f=json$/, file: f("catalog.json") },
  { match: /Counties___OSi_National_Statutory_Boundaries\/FeatureServer\/0\/query\?.*where=PROVINCE/, file: f("query-munster.json") },
  { match: /where=bad/, body: '{"error":{"code":400,"message":"Cannot perform query. Invalid query parameters.","details":["\'where\' parameter is invalid"]}}' }
];

describe("GeoHive module", () => {
  const cop = JSON.stringify({
    features: [
      { attributes: { English_Na: "Dingle", Irish_Name: "An Daingean", County: "KERRY", Classifica: "CoP" }, geometry: { x: -10.27053109158031, y: 52.13875684321777 } },
      { attributes: { English_Na: "Daingean", Irish_Name: "An Daingean", County: "OFFALY", Classifica: "CoP" }, geometry: { x: -7.291977594966705, y: 53.29608106908466 } }
    ]
  });
  const townland = JSON.stringify({
    features: [{ attributes: { English_Na: "GLENDALOUGH", Irish_Name: "Gleann Dá Lachan", County: "WATERFORD", Classifica: "Td" }, geometry: { x: -7.659824093207472, y: 52.30172324387711 } }]
  });
  const empty = '{"features":[]}';

  it("locates a town by English or Irish name with coordinates from the gazetteer", async () => {
    const fetch = fakeFetch([{ match: (url) => url.includes("Centres_of_Population") && url.includes("DAINGEAN"), body: cop }]);
    const { ok, body } = await callTool(mod, "geohive_locate", { name: "An Daingean" }, fetch);
    expect(ok).toBe(true);
    expect(body.data.places[0]).toEqual({ name: "Dingle", irish: "An Daingean", county: "Kerry", kind: "town", lat: 52.13876, lon: -10.27053 });
    expect(body.data.places).toHaveLength(2);
    expect(decodeURIComponent(fetch.calls[0]!.url)).toContain("outSR=4326");
  });

  it("falls back to townlands, escapes quotes, and reports unknown names", async () => {
    const fetch = fakeFetch([
      { match: (url) => url.includes("Centres_of_Population"), body: empty },
      { match: (url) => url.includes("Townlands___OSi_National_Placenames_Gazetteer") && url.includes("GLENDALOUGH"), body: townland },
      { match: (url) => url.includes("Townlands___OSi_National_Placenames_Gazetteer"), body: empty }
    ]);
    const hit = await callTool(mod, "geohive_locate", { name: "Glendalough" }, fetch);
    expect(hit.body.data.places[0]).toMatchObject({ name: "Glendalough", county: "Waterford", kind: "townland", lat: 52.30172 });
    await callTool(mod, "geohive_locate", { name: "O'Brien's Bridge" }, fetch);
    expect(decodeURIComponent(fetch.calls.at(-1)!.url.replace(/\+/g, " "))).toContain("O''BRIEN''S BRIDGE");
    const miss = await callTool(mod, "geohive_locate", { name: "Atlantis" }, fetch);
    expect(miss.ok).toBe(false);
    expect(miss.body.error.code).toBe("NOT_FOUND");
  });

  it("resolves every boundary for a Dublin point", async () => {
    const fetch = fakeFetch(routes);
    const { ok, body } = await callTool(mod, "geohive_boundaries_at_point", { lat: 53.3498, lon: -6.2603 }, fetch);
    expect(ok).toBe(true);
    expect(body.data).toMatchObject({
      county: { name: "Dublin", irish: "Baile Átha Cliath", province: "Leinster" },
      local_authority: { name: "Dublin City Council" },
      dail_constituency: { name: "Dublin Central", seats: 4 },
      local_electoral_area: { name: "North Inner City", seats: 8 },
      electoral_division: { name: "North City", cso_code: "02075" },
      small_area: { code: "268106016", nuts3: "Dublin" },
      settlement: { name: "Dublin city and suburbs" }
    });
    expect(body.attribution).toContain("Tailte Éireann");
    expect(fetch.calls).toHaveLength(BOUNDARY_LAYERS.length);
  });

  it("returns nulls at sea and rejects points outside Ireland", async () => {
    const sea = await callTool(mod, "geohive_boundaries_at_point", { lat: 53.3, lon: -10.5 }, fakeFetch(routes));
    expect(sea.body.data.county).toBeNull();
    const paris = await callTool(mod, "geohive_boundaries_at_point", { lat: 48.85, lon: 2.35 }, fakeFetch(routes));
    expect(paris.body.error.code).toBe("BAD_ARGS");
  });

  it("reports layers that failed while returning the rest", async () => {
    const failing = BOUNDARY_LAYERS[6]!.service;
    const fetch = fakeFetch([{ match: (url) => url.includes(failing), status: 500, body: "" }, ...routes]);
    const { body } = await callTool(mod, "geohive_boundaries_at_point", { lat: 53.3498, lon: -6.2603 }, fetch);
    expect(body.data.unavailable).toEqual(["settlement"]);
    expect(body.data.county.name).toBe("Dublin");
  });

  it("lists and filters layers", async () => {
    const { body } = await callTool(mod, "geohive_list_layers", { query: "constituency ungeneralised" }, fakeFetch(routes));
    expect(body.data.services.map((s: { service: string }) => s.service)).toEqual([
      "Constituency_Boundaries_Ungeneralised",
      "Constituency_Boundaries_Ungeneralised_2017"
    ]);
  });

  it("discovers and queries a sole nonzero layer without a caller knowing its ID", async () => {
    const fetch = fakeFetch([
      { match: /Cadastral_Parcels_Freehold\/FeatureServer\?f=json$/, body: JSON.stringify({ layers: [{ id: 12, name: "Freehold parcels", type: "Feature Layer" }] }) },
      { match: /FeatureServer\/12\/query/, body: JSON.stringify({ features: [{ attributes: { SP_ID: 52854 } }], exceededTransferLimit: true }) }
    ]);
    const result = await callTool(mod, "geohive_query_layer", { service: "Cadastral_Parcels_Freehold", limit: 1 }, fetch);
    expect(result.ok).toBe(true);
    expect(result.body.data).toMatchObject({ layer_id: 12, count: 1, features: [{ SP_ID: 52854 }] });
    expect(result.body.truncated).toBe(true);
    expect(result.body.url).toContain("/12/query");
  });

  it("lists the layers of one service and honours an explicit layer ID", async () => {
    const fetch = fakeFetch([
      { match: /FeatureServer\?f=json$/, body: JSON.stringify({ layers: [{ id: 4, name: "East", type: "Feature Layer" }, { id: 12, name: "West", type: "Feature Layer" }] }) },
      { match: /FeatureServer\/12\/query/, body: JSON.stringify({ features: [{ attributes: { name: "West" } }] }) }
    ]);
    const listed = await callTool(mod, "geohive_list_layers", { service: "Example_Parcels", limit: 1 }, fetch);
    expect(listed.ok).toBe(true);
    expect(listed.body.data.layers).toEqual([{ id: 4, name: "East", type: "Feature Layer", url: expect.stringContaining("/4") }]);
    expect(listed.body.truncated).toBe(true);
    const queried = await callTool(mod, "geohive_query_layer", { service: "Example_Parcels", layer_id: 12 }, fetch);
    expect(queried.ok).toBe(true);
    expect(queried.body.data.features).toEqual([{ name: "West" }]);
  });

  it("requires a choice for ambiguous nonzero layers, and rejects invalid IDs", async () => {
    const fetch = fakeFetch([{ match: /FeatureServer\?f=json$/, body: JSON.stringify({ layers: [{ id: 4, name: "East" }, { id: 12, name: "West" }] }) }]);
    const ambiguous = await callTool(mod, "geohive_query_layer", { service: "Example_Parcels" }, fetch);
    expect(ambiguous.body.error.code).toBe("BAD_ARGS");
    expect(ambiguous.body.error.hint).toContain("layer_id");
    for (const layer_id of [-1, 1.5]) {
      const bad = await callTool(mod, "geohive_query_layer", { service: "Example_Parcels", layer_id }, fetch);
      expect(bad.body.error.code).toBe("BAD_ARGS");
    }
  });

  it("preserves layer zero for multi-layer services and rejects an unknown explicit layer", async () => {
    const fetch = fakeFetch([
      { match: /FeatureServer\?f=json$/, body: JSON.stringify({ layers: [{ id: 8, name: "Other" }, { id: 0, name: "Default" }] }) },
      { match: /FeatureServer\/0\/query/, body: JSON.stringify({ features: [{ attributes: { name: "Default" } }] }) }
    ]);
    const ctx = createContext({ fetch });
    const result = await callTool(mod, "geohive_query_layer", { service: "Example_Parcels" }, ctx);
    expect(result.body.data).toMatchObject({ layer_id: 0, features: [{ name: "Default" }] });
    const bad = await callTool(mod, "geohive_query_layer", { service: "Example_Parcels", layer_id: 99 }, ctx);
    expect(bad.body.error.code).toBe("BAD_ARGS");
    expect(fetch.calls.filter((call) => call.url.includes("/query"))).toHaveLength(1);
  });

  it("does not cache malformed service metadata as an empty result", async () => {
    const fetch = fakeFetch([{ match: /FeatureServer\?f=json$/, body: "{}" }]);
    const ctx = createContext({ fetch });
    for (let i = 0; i < 2; i++) {
      const result = await callTool(mod, "geohive_list_layers", { service: "Example_Parcels" }, ctx);
      expect(result.body.error.code).toBe("UPSTREAM_DOWN");
    }
    expect(fetch.calls).toHaveLength(2);
  });

  it("queries a layer and maps ArcGIS errors to BAD_ARGS", async () => {
    const fetch = fakeFetch(routes);
    const { body } = await callTool(
      mod,
      "geohive_query_layer",
      { service: "Counties___OSi_National_Statutory_Boundaries", where: "PROVINCE='Munster'", out_fields: "ENGLISH,GAEILGE,PROVINCE", order_by: "ENGLISH", limit: 3 },
      fetch
    );
    expect(body.data.features[0]).toMatchObject({ ENGLISH: "CLARE", PROVINCE: "Munster" });
    expect(fetch.calls.find((call) => call.url.includes("/query"))?.url).toContain("resultRecordCount=3");
    const bad = await callTool(mod, "geohive_query_layer", { service: "Counties___OSi_National_Statutory_Boundaries", where: "bad==" }, fetch);
    expect(bad.body.error.code).toBe("BAD_ARGS");
    const injection = await callTool(mod, "geohive_query_layer", { service: "../../evil", where: "1=1" }, fetch);
    expect(injection.body.error.code).toBe("BAD_ARGS");
  });

  it("rejects malformed successful query bodies and fetches again after recovery", async () => {
    let queries = 0;
    const fetch = async (url: string) => {
      if (url.includes("/query")) {
        queries += 1;
        return new Response(JSON.stringify(queries === 1 ? {} : { features: [{ attributes: { SP_ID: 1 } }] }));
      }
      return new Response(JSON.stringify({ layers: [{ id: 12, name: "Parcels" }] }));
    };
    const ctx = createContext({ fetch });
    const args = { service: "Example_Parcels", limit: 1 };
    expect((await callTool(mod, "geohive_query_layer", args, ctx)).body.error?.code).toBe("UPSTREAM_DOWN");
    const recovered = await callTool(mod, "geohive_query_layer", args, ctx);
    expect(recovered.body.data.features).toEqual([{ SP_ID: 1 }]);
    expect(queries).toBe(2);
  });

  it("does not cache transient ArcGIS error bodies", async () => {
    const fetch = fakeFetch([serviceMetadata, { match: /where=busy/, body: '{"error":{"code":500,"message":"Service busy"}}' }]);
    const ctx = createContext({ fetch });
    const args = { service: "Counties___OSi_National_Statutory_Boundaries", where: "busy" };
    expect((await callTool(mod, "geohive_query_layer", args, ctx)).body.error.code).toBe("UPSTREAM_DOWN");
    expect((await callTool(mod, "geohive_query_layer", args, ctx)).body.error.code).toBe("UPSTREAM_DOWN");
    expect(fetch.calls.filter((call) => call.url.includes("/query"))).toHaveLength(2);
  });
});
