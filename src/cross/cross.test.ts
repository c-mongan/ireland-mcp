import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { fakeFetch, parseToolText, type Route } from "../../test/helpers/fakeFetch.js";
import { createContext } from "../gateway/context.js";
import { ToolError } from "../gateway/errors.js";
import type { SourceModule, ToolContext } from "../gateway/module.js";
import { runTool } from "../gateway/server.js";
import { sourceModules } from "../registry.js";
import { BOUNDARY_LAYERS } from "../sources/geohive/index.js";
import { SEARCH_TIMEOUT_MS, crossSourceTools, interleave } from "./index.js";
import { findPlace } from "./places.js";

const fx = (dir: string, name: string) => fileURLToPath(new URL(`../sources/${dir}/fixtures/${name}`, import.meta.url));
const routes: Route[] = [
  ...BOUNDARY_LAYERS.map((layer) => ({
    match: (url: string) => url.includes(`/services/${layer.service}/`) && url.includes("geometry=-6.2603"),
    file: fx("geohive", `point-${layer.service}.json`)
  })),
  { match: /locationforecast\?lat=53\.3498;long=-6\.2603$/, file: fx("met-eireann", "forecast-dublin.xml") },
  { match: /prodapi\.met\.ie\/v2\/warnings\//, file: fx("met-eireann", "warnings-synthetic.json") },
  { match: /ReadMetadata\/F1001\//, file: fx("cso", "metadata-F1001.json") },
  { match: (url, init) => url.includes("api.jsonrpc") && String(init?.body).includes("ReadDataset"), file: fx("cso", "data-F1001-dublin.json") }
];

function call(tools: ReturnType<typeof crossSourceTools>, name: string, args: unknown, ctx: ToolContext) {
  const tool = tools.find((t) => t.name === name)!;
  return runTool(tool, "cross", args, ctx).then((r) => ({ ok: !r.isError, body: parseToolText<any>(r) })); // eslint-disable-line @typescript-eslint/no-explicit-any
}

const fakeModule = (id: string, hits: number, fail = false): SourceModule => ({
  info: { id, name: id.toUpperCase(), licence: "CC BY 4.0", attribution: id, homepage: `https://${id}.example` },
  summary: id,
  tools: [],
  search: async (q) => {
    if (fail) throw new ToolError("UPSTREAM_DOWN", `${id} down`);
    return Array.from({ length: hits }, (_, i) => ({ id: `${id}:${q}-${i}`, title: `${id} ${i}`, url: `https://${id}.example/${i}` }));
  },
  fetchById: async (key) => ({ id: `${id}:${key}`, title: key, text: `text of ${key}`, url: `https://${id}.example/${key}`, metadata: {} })
});

describe("cross-source tools", () => {
  const ctx = createContext({ fetch: fakeFetch([]) });

  it("search interleaves sources, tolerates one failing, and returns the raw ChatGPT shape", async () => {
    const tools = crossSourceTools([fakeModule("a", 3), fakeModule("b", 1), fakeModule("c", 2, true)]);
    const { ok, body } = await call(tools, "search", { query: "x" }, ctx);
    expect(ok).toBe(true);
    expect(Object.keys(body)).toEqual(["results"]);
    expect(body.results.map((r: { id: string }) => r.id)).toEqual(["a:x-0", "b:x-0", "a:x-1", "a:x-2"]);
  });

  it("search answers within the per-source deadline when one source hangs", async () => {
    vi.useFakeTimers();
    try {
      const hanging: SourceModule = { ...fakeModule("slow", 1), search: () => new Promise(() => {}) };
      const pending = call(crossSourceTools([fakeModule("a", 2), hanging]), "search", { query: "x" }, ctx);
      await vi.advanceTimersByTimeAsync(SEARCH_TIMEOUT_MS + 10);
      const { ok, body } = await pending;
      expect(SEARCH_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
      expect(ok).toBe(true);
      expect(body.results.map((r: { id: string }) => r.id)).toEqual(["a:x-0", "a:x-1"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("search fails cleanly only when every source fails", async () => {
    const { ok, body } = await call(crossSourceTools([fakeModule("c", 1, true)]), "search", { query: "x" }, ctx);
    expect(ok).toBe(false);
    expect(body.error.code).toBe("UPSTREAM_DOWN");
  });

  it("fetch routes by the source prefix and rejects unknown ids", async () => {
    const tools = crossSourceTools([fakeModule("a", 1), fakeModule("b", 1)]);
    const { body } = await call(tools, "fetch", { id: "b:doc:with:colons" }, ctx);
    expect(body).toEqual({ id: "b:doc:with:colons", title: "doc:with:colons", text: "text of doc:with:colons", url: "https://b.example/doc:with:colons", metadata: {} });
    expect((await call(tools, "fetch", { id: "zzz:1" }, ctx)).body.error.code).toBe("NOT_FOUND");
  });

  it("list_sources covers every registered module with licences and tools", async () => {
    const { body } = await call(crossSourceTools(sourceModules), "list_sources", { max_tokens: 8000 }, ctx);
    expect(body.truncated).toBe(false);
    expect(body.data.sources.map((s: { id: string }) => s.id)).toEqual(sourceModules.map((m) => m.info.id));
    for (const s of body.data.sources) expect(s.licence && s.attribution && s.tools.length).toBeTruthy();
  });

  it("ireland_snapshot combines CSO, GeoHive and Met Éireann for a named place", async () => {
    const live = createContext({ fetch: fakeFetch(routes) });
    const { ok, body } = await call(crossSourceTools(sourceModules), "ireland_snapshot", { place: "Co. Dublin" }, live);
    expect(ok).toBe(true);
    expect(body.data).toMatchObject({ place: "Dublin", county: "Dublin", nearest_met_station: { name: "Phoenix Park" } });
    expect(body.data.population.area).toBe("Dublin");
    expect(body.data.boundaries.county.name).toBe("Dublin");
    expect(body.data.forecast.hours.length).toBe(6);
    expect(body.data.national_warnings).toHaveLength(1);
    expect(body.data.national_warnings[0].type).toBe("Wind");
    expect(body.truncated).toBe(false);
    expect(body.data.sources.map((s: { source: string }) => s.source)).toHaveLength(3);
  });

  it("ireland_snapshot finds places outside the built-in list through the Tailte Éireann gazetteer", async () => {
    const gazetteer = JSON.stringify({
      features: [{ attributes: { English_Na: "Ballymun", Irish_Name: "Baile Munna", County: "DUBLIN", Classifica: "CoP" }, geometry: { x: -6.2603, y: 53.3498 } }]
    });
    const withGazetteer: Route[] = [{ match: (url) => url.includes("Placenames_Gazetteer") && url.includes("BALLYMUN"), body: gazetteer }, ...routes];
    const { ok, body } = await call(crossSourceTools(sourceModules), "ireland_snapshot", { place: "Ballymun" }, createContext({ fetch: fakeFetch(withGazetteer) }));
    expect(ok).toBe(true);
    expect(body.data).toMatchObject({ place: "Ballymun", county: "Dublin", lat: 53.3498, lon: -6.2603 });
    expect(body.data.population.area).toBe("Dublin");
  });

  it("ireland_snapshot reports unknown places and partial upstream failures", async () => {
    const tools = crossSourceTools(sourceModules);
    const unknown = await call(tools, "ireland_snapshot", { place: "Atlantis" }, ctx);
    expect(unknown.body.error).toMatchObject({ code: "NOT_FOUND" });
    expect((await call(tools, "ireland_snapshot", {}, ctx)).body.error.code).toBe("BAD_ARGS");

    const noMet = createContext({ fetch: fakeFetch(routes.filter((r) => !String(r.file ?? "").includes("met-eireann"))) });
    const { ok, body } = await call(tools, "ireland_snapshot", { place: "Dublin" }, noMet);
    expect(ok).toBe(true);
    expect(body.data.forecast.error.code).toBe("UPSTREAM_DOWN");
    expect(body.data.population.area).toBe("Dublin");
  });

  it("nearby returns boundaries, nearest station and forecast; rejects points outside Ireland", async () => {
    const tools = crossSourceTools(sourceModules);
    const { body } = await call(tools, "nearby", { lat: 53.3498, lon: -6.2603, hours: 3 }, createContext({ fetch: fakeFetch(routes) }));
    expect(body.data.boundaries.local_authority).toBeTruthy();
    expect(body.data.forecast.hours).toHaveLength(3);
    expect(body.data.monuments.error).toBeTruthy();
    const far = await call(tools, "nearby", { lat: 48.85, lon: 2.35 }, ctx);
    expect(far.body.data.boundaries.error.code).toBe("BAD_ARGS");
  });

  it("nearby adds monuments within 500 m and the protected sites at the point, with citations", async () => {
    const features = (rows: Record<string, unknown>[]) => JSON.stringify({ features: rows.map((attributes) => ({ attributes })) });
    const withMaps: Route[] = [
      ...routes,
      {
        match: (url: string) => url.includes("SMROpenData") && url.includes("distance=500"),
        body: features([{ SMRS: "DU018-020", COUNTY: "DUBLIN", TOWNLAND: "Dublin North City", MONUMENT_CLASS: "Historic town", WEBSITE_LINK: "https://example.ie/DU018-020" }])
      },
      { match: (url: string) => url.includes("NPWSDesignatedAreas/FeatureServer/3/query"), body: features([{ SITECODE: "000210", SITE_NAME: "South Dublin Bay SAC" }]) },
      { match: (url: string) => url.includes("NPWSDesignatedAreas/FeatureServer/"), body: features([]) }
    ];
    const tools = crossSourceTools(sourceModules);
    const { ok, body } = await call(tools, "nearby", { lat: 53.3498, lon: -6.2603, hours: 3 }, createContext({ fetch: fakeFetch(withMaps) }));
    expect(ok).toBe(true);
    expect(body.data.monuments).toMatchObject({ radius_m: 500, count: 1, items: [{ smr: "DU018-020", class: "Historic town" }] });
    expect(body.data.protected_sites).toMatchObject({ count: 1, items: [{ code: "000210", name: "South Dublin Bay SAC" }] });
    const cited = body.data.sources.map((s: { source: string }) => s.source);
    expect(cited).toEqual(expect.arrayContaining(["National Monuments Service SMR", "NPWS designated protected sites"]));
  });

  it("finds places by county, alias and Irish name", () => {
    expect(findPlace("county kerry")?.name).toBe("Tralee");
    expect(findPlace("Baile Átha Cliath")?.county).toBe("Dublin");
    expect(findPlace("dun laoghaire")?.name).toBe("Dún Laoghaire");
    expect(interleave([[1, 2], [3]], 2)).toEqual([1, 3]);
  });
});
