import { describe, expect, it } from "vitest";
import { createContext } from "../../gateway/context.js";
import { fakeFetch, type Route } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { normaliseTableCode } from "./client.js";
import { csoModule } from "./index.js";

const f = (name: string) => fixturePath(import.meta.url, name);
const rpcRoute = (method: string, file: string, extra?: (body: string) => boolean): Route => ({
  match: (url, init) =>
    url.includes("api.jsonrpc") && String(init?.body).includes(method) && (extra ? extra(String(init?.body)) : true),
  file: f(file)
});
const routes: Route[] = [
  rpcRoute("Navigation_API.Search", "search-population-county.json", (b) => b.includes("population")),
  { match: (url, init) => url.includes("api.jsonrpc") && String(init?.body).includes("zzqq"), body: '{"jsonrpc":"2.0","result":[],"id":1}' },
  { match: /ReadMetadata\/F1001\//, file: f("metadata-F1001.json") },
  { match: /ReadMetadata\/ZZZ99\//, status: 404, body: "NotFound" },
  rpcRoute("ReadDataset", "data-F1001-dublin.json", (b) => b.includes('"index":["02"]') && b.includes('"1"')),
  rpcRoute("ReadDataset", "data-F1001-2016-2022.json")
];

describe("CSO module", () => {
  it("normalises and validates table codes", () => {
    expect(normaliseTableCode(" f1001 ")).toBe("F1001");
    expect(normaliseTableCode("HPM09 - house prices")).toBe("HPM09");
    expect(() => normaliseTableCode("population")).toThrow("not a CSO table code");
  });

  it("cso_search_tables returns bounded tables with codes", async () => {
    const { ok, body } = await callTool(csoModule, "cso_search_tables", { query: "population county", limit: 3 }, fakeFetch(routes));
    expect(ok).toBe(true);
    expect(body.data).toHaveLength(3);
    expect(body.data[0]).toMatchObject({ code: "HRD35", url: "https://data.cso.ie/table/HRD35" });
    expect(body.truncated).toBe(true);
    expect(body.licence).toBe("CC BY 4.0");
  });

  it("cso_search_tables returns an empty list for no matches", async () => {
    const { body } = await callTool(csoModule, "cso_search_tables", { query: "zzqqxx" }, fakeFetch(routes));
    expect(body.data).toEqual([]);
  });

  it("cso_get_table_metadata lists dimensions and bounds categories", async () => {
    const { body } = await callTool(csoModule, "cso_get_table_metadata", { table_code: "F1001", max_categories: 5 }, fakeFetch(routes));
    expect(body.data.title).toBe("Population at Each Census");
    expect(body.data.dimensions.map((d: { code: string }) => d.code)).toEqual(["STATISTIC", "TLIST(A1)", "C02779V03348", "C02199V02655"]);
    expect(body.data.dimensions[2].categories).toHaveLength(5);
    expect(body.data.dimensions[2].total_categories).toBe(27);
    expect(body.truncated).toBe(true);
  });

  it("maps a missing table to NOT_FOUND", async () => {
    const { ok, body } = await callTool(csoModule, "cso_get_table_metadata", { table_code: "ZZZ99" }, fakeFetch(routes));
    expect(ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("cso_get_data decodes filtered JSON-stat rows", async () => {
    const fetch = fakeFetch(routes);
    const { body } = await callTool(
      csoModule,
      "cso_get_data",
      { table_code: "F1001", filters: { "TLIST(A1)": ["2016", "2022"], C02779V03348: ["-", "01"], C02199V02655: ["-"] } },
      fetch
    );
    expect(body.data.rows).toHaveLength(4);
    expect(body.data.rows[2]).toMatchObject({ CensusYear: "2022", County: "State", Sex: "Both sexes", value: 5149139 });
    const sent = JSON.parse(String(fetch.calls.at(-1)?.init?.body));
    expect(sent.params.extension.matrix).toBe("F1001");
    expect(sent.params.dimension["TLIST(A1)"].category.index).toEqual(["2016", "2022"]);
  });

  it("cso_get_data rejects unknown dimensions, codes and oversized queries", async () => {
    const fetch = fakeFetch(routes);
    const bad = await callTool(csoModule, "cso_get_data", { table_code: "F1001", filters: { Nope: ["1"] } }, fetch);
    expect(bad.body.error.code).toBe("BAD_ARGS");
    const badCode = await callTool(csoModule, "cso_get_data", { table_code: "F1001", filters: { County: ["99"] } }, fetch);
    expect(badCode.body.error.message).toContain("Unknown County codes");
  });

  it("cso_area_profile resolves county names and computes change", async () => {
    const { body } = await callTool(csoModule, "cso_area_profile", { area: "Co. Dublin", years: ["2016", "2022"] }, fakeFetch(routes));
    expect(body.data.area).toBe("Dublin");
    expect(body.data.census).toEqual([
      { year: "2016", total: 1347359, male: 658371, female: 688988 },
      { year: "2022", total: 1458154, male: 713606, female: 744548 }
    ]);
    expect(body.data.change).toEqual({ absolute: 110795, percent: 8.2 });
  });

  it("cso_area_profile rejects unknown areas and years", async () => {
    const fetch = fakeFetch(routes);
    expect((await callTool(csoModule, "cso_area_profile", { area: "Atlantis" }, fetch)).body.error.code).toBe("NOT_FOUND");
    expect((await callTool(csoModule, "cso_area_profile", { area: "Cork", years: ["2020"] }, fetch)).body.error.code).toBe("BAD_ARGS");
  });

  it("supports cross-source search and fetch", async () => {
    const ctx = createContext({ fetch: fakeFetch(routes) });
    const hits = await csoModule.search!("population county", 2, ctx);
    expect(hits[0]).toEqual({ id: "cso:HRD35", title: expect.stringContaining("HRD35"), url: "https://data.cso.ie/table/HRD35" });
    const doc = await csoModule.fetchById!("F1001", ctx);
    expect(doc.text).toContain("County [C02779V03348]");
    expect(doc.metadata.licence).toBe("CC BY 4.0");
  });

  it("maps PxStat JSON-RPC errors by code and never caches them", async () => {
    const rpcError = (code: number) => `{"jsonrpc":"2.0","error":{"code":${code},"message":"x"},"id":1}`;
    const fetch = fakeFetch([
      { match: (_u, init) => String(init?.body).includes("badparams"), body: rpcError(-32602) },
      { match: (_u, init) => String(init?.body).includes("serverfault"), body: rpcError(-32603) }
    ]);
    const ctx = createContext({ fetch });
    expect((await callTool(csoModule, "cso_search_tables", { query: "badparams" }, ctx)).body.error.code).toBe("BAD_ARGS");
    expect((await callTool(csoModule, "cso_search_tables", { query: "serverfault" }, ctx)).body.error.code).toBe("UPSTREAM_DOWN");
    expect((await callTool(csoModule, "cso_search_tables", { query: "serverfault" }, ctx)).body.error.code).toBe("UPSTREAM_DOWN");
    expect(fetch.calls).toHaveLength(3);
  });
});
