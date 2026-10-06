import { describe, expect, it } from "vitest";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { fakeFetch } from "../../../test/helpers/fakeFetch.js";
import { epaModule } from "./index.js";

type SearchBody = { data: { total: number; results: Array<{ name: string; type: string; code: string }> } };
type WaterbodyBody = { data: { code: string; name: string; tier1_risk: string; status_cycles: unknown[] } };
const fx = (name: string) => fixturePath(import.meta.url, name);

describe("epa", () => {
  it("searches WFD catchments and waterbodies", async () => {
    const fetch = fakeFetch([{ match: /\/api\/search\?v=Suir&page=1&size=5/, file: fx("wfd-search-suir.json") }]);
    const result = await callTool<SearchBody>(epaModule, "epa_wfd_search", { query: "Suir", limit: 5 }, fetch);
    expect(result.ok).toBe(true);
    expect(result.body.data.total).toBe(45);
    expect(result.body.data.results[0]).toMatchObject({ name: "Suir", type: "Catchment", code: "16" });
  });

  it("returns compact waterbody risk and status cycles", async () => {
    const fetch = fakeFetch([{ match: /\/api\/waterbody\/IE_SE_16B020080$/, file: fx("waterbody-blackwater.json") }]);
    const result = await callTool<WaterbodyBody>(epaModule, "epa_wfd_waterbody", { code: "IE_SE_16B020080" }, fetch);
    expect(result.ok).toBe(true);
    expect(result.body.data).toMatchObject({ code: "IE_SE_16B020080", name: "BLACKWATER (KILMACOW)_010", tier1_risk: "Not at risk" });
    expect(result.body.data.status_cycles.length).toBeGreaterThan(0);
  });
});
