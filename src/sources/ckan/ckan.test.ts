import { describe, expect, it } from "vitest";
import { fakeFetch, type Route } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { createContext } from "../../gateway/context.js";
import { dataGovIeModule } from "../data-gov-ie/index.js";
import { smartDublinModule } from "../smart-dublin/index.js";

const f = (name: string) => fixturePath(import.meta.url, name);
const routes: Route[] = [
  { match: /data\.gov\.ie\/api\/3\/action\/package_search/, file: f("search-data.gov.ie.json") },
  { match: /smartdublin\.ie\/api\/3\/action\/package_search/, file: f("search-data.smartdublin.ie.json") },
  { match: /package_show\?id=moby-bikes/, file: f("show-moby-bikes.json") },
  { match: /package_show\?id=missing/, status: 404, body: '{"success":false,"error":{"__type":"Not Found Error","message":"Not found"}}' },
  { match: /datastore_search/, file: f("datastore.json") }
];

describe("CKAN modules", () => {
  it("searches data.gov.ie with filters", async () => {
    const fetch = fakeFetch(routes);
    const { ok, body } = await callTool(dataGovIeModule, "datagov_search_datasets", { query: "bike", format: "CSV", organization: "dublin-city-council", limit: 1 }, fetch);
    expect(ok).toBe(true);
    expect(body.data.datasets).toHaveLength(1);
    expect(body.data.datasets[0]).toMatchObject({ id: "moby-bikes", publisher: "Dublin City Council" });
    expect(body.truncated).toBe(true);
    const url = decodeURIComponent(fetch.calls[0]!.url).replace(/\+/g, " ");
    expect(url).toContain('fq=organization:dublin-city-council AND res_format:"CSV"');
  });

  it("gets a dataset with resources and maps not-found", async () => {
    const { body } = await callTool(dataGovIeModule, "datagov_get_dataset", { id: "moby-bikes" }, fakeFetch(routes));
    expect(body.data.resources.length).toBeGreaterThan(0);
    expect(body.url).toBe("https://data.gov.ie/dataset/moby-bikes");
    const missing = await callTool(dataGovIeModule, "datagov_get_dataset", { id: "missing" }, fakeFetch(routes));
    expect(missing.body.error.code).toBe("NOT_FOUND");
    const bad = await callTool(dataGovIeModule, "datagov_get_dataset", { id: "../x" }, fakeFetch(routes));
    expect(bad.body.error.code).toBe("BAD_ARGS");
  });

  it("queries a Smart Dublin datastore table", async () => {
    const fetch = fakeFetch(routes);
    const { body } = await callTool(
      smartDublinModule,
      "smartdublin_query_datastore",
      { resource_id: "330d9b75-0e85-4c95-b948-58b86acaa577", filters: { Time: "2026-01-01T00:00:00" }, limit: 3 },
      fetch
    );
    expect(body.data.total).toBe(5880);
    expect(body.data.records).toHaveLength(3);
    expect(body.data.fields[0]).toEqual({ name: "Time", type: "timestamp" });
    expect(body.truncated).toBe(true);
    expect(decodeURIComponent(fetch.calls[0]!.url)).toContain('filters={"Time":"2026-01-01T00:00:00"}');
  });

  it("participates in cross-source search and fetch", async () => {
    const ctx = createContext({ fetch: fakeFetch(routes) });
    const hits = await smartDublinModule.search!("bike", 2, ctx);
    expect(hits[0]).toEqual({
      id: "smart-dublin:dublin-city-centre-cycle-counts",
      title: expect.stringContaining("Smart Dublin"),
      url: "https://data.smartdublin.ie/dataset/dublin-city-centre-cycle-counts"
    });
    const doc = await dataGovIeModule.fetchById!("moby-bikes", ctx);
    expect(doc.id).toBe("data-gov-ie:moby-bikes");
    expect(doc.text).toContain("Resources:");
  });
});
