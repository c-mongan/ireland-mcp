import { describe, expect, it } from "vitest";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { fakeFetch } from "../../../test/helpers/fakeFetch.js";
import { croModule } from "./index.js";

type CroBody = { data: { total: number; datasets: Array<{ id: string; title: string; licence: string }> } };
const fx = (name: string) => fixturePath(import.meta.url, name);

describe("cro", () => {
  it("searches CRO CKAN company datasets", async () => {
    const fetch = fakeFetch([{ match: /package_search\?q=company/, file: fx("package-search-company.json") }]);
    const result = await callTool<CroBody>(croModule, "cro_search_datasets", { query: "company", limit: 2 }, fetch);
    expect(result.ok).toBe(true);
    expect(result.body.data.total).toBeGreaterThanOrEqual(2);
    expect(result.body.data.datasets[0]).toMatchObject({ id: "companies", title: "Company Records", licence: "Creative Commons Attribution 4.0" });
  });
});
