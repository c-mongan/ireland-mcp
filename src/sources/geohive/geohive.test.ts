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
const routes: Route[] = [
  ...pointRoutes,
  { match: (url) => url.includes("geometry=-10.5"), body: '{"features":[]}' },
  { match: /services\?f=json$/, file: f("catalog.json") },
  { match: /Counties___OSi_National_Statutory_Boundaries\/FeatureServer\/0\/query\?.*where=PROVINCE/, file: f("query-munster.json") },
  { match: /where=bad/, body: '{"error":{"code":400,"message":"Cannot perform query. Invalid query parameters.","details":["\'where\' parameter is invalid"]}}' }
];

describe("GeoHive module", () => {
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

  it("queries a layer and maps ArcGIS errors to BAD_ARGS", async () => {
    const fetch = fakeFetch(routes);
    const { body } = await callTool(
      mod,
      "geohive_query_layer",
      { service: "Counties___OSi_National_Statutory_Boundaries", where: "PROVINCE='Munster'", out_fields: "ENGLISH,GAEILGE,PROVINCE", order_by: "ENGLISH", limit: 3 },
      fetch
    );
    expect(body.data.features[0]).toMatchObject({ ENGLISH: "CLARE", PROVINCE: "Munster" });
    expect(fetch.calls[0]?.url).toContain("resultRecordCount=3");
    const bad = await callTool(mod, "geohive_query_layer", { service: "Counties___OSi_National_Statutory_Boundaries", where: "bad==" }, fetch);
    expect(bad.body.error.code).toBe("BAD_ARGS");
    const injection = await callTool(mod, "geohive_query_layer", { service: "../../evil", where: "1=1" }, fetch);
    expect(injection.body.error.code).toBe("BAD_ARGS");
  });

  it("does not cache transient ArcGIS error bodies", async () => {
    const fetch = fakeFetch([{ match: /where=busy/, body: '{"error":{"code":500,"message":"Service busy"}}' }]);
    const ctx = createContext({ fetch });
    const args = { service: "Counties___OSi_National_Statutory_Boundaries", where: "busy" };
    expect((await callTool(mod, "geohive_query_layer", args, ctx)).body.error.code).toBe("UPSTREAM_DOWN");
    expect((await callTool(mod, "geohive_query_layer", args, ctx)).body.error.code).toBe("UPSTREAM_DOWN");
    expect(fetch.calls).toHaveLength(2);
  });
});
