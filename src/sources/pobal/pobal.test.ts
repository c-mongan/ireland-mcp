import { describe, expect, it } from "vitest";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { fakeFetch } from "../../../test/helpers/fakeFetch.js";
import { createContext } from "../../gateway/context.js";
import { pobalModule } from "./index.js";

type PobalBody = { data: { areas: Array<{ ed_id: string; electoral_division: string; deprivation_label: string; population_2022: number }> } };
const fx = (name: string) => fixturePath(import.meta.url, name);

describe("pobal", () => {
  it("searches Pobal deprivation scores by electoral division", async () => {
    const fetch = fakeFetch([{ match: /datastore_search\?resource_id=0806f07b.*q=Galvone/, file: fx("deprivation-galvone.json") }]);
    const result = await callTool<PobalBody>(pobalModule, "pobal_deprivation_search", { query: "Galvone", limit: 3 }, fetch);
    expect(result.ok).toBe(true);
    expect(result.body.data.areas[0]).toMatchObject({ ed_id: "128020", electoral_division: "GALVONE B", deprivation_label: "Extremely Disadvantaged" });
    expect(result.body.data.areas[0]?.population_2022).toBe(739);
  });

  it("pads ED ids that Pobal stores without the leading zero, and accepts the 6-digit form", async () => {
    const body = JSON.stringify({ success: true, result: { total: 1, records: [{ ED_ID_STR: "68001", ED_ENGLISH: "BALLYBAAN", TOTPOP22: "1,000", Index22_ED_std_rel_wt: 1.23, Index22_ED_rel_wt_lab: "Marginally Above Average" }] } });
    const fetch = fakeFetch([{ match: /q=68001(&|$)/, body }]);
    const result = await callTool<PobalBody>(pobalModule, "pobal_deprivation_search", { query: "068001", limit: 3 }, fetch);
    expect(result.body.data.areas[0]).toMatchObject({ ed_id: "068001", electoral_division: "BALLYBAAN" });
  });

  it("lists every ED in _id order with offset paging when the query is omitted", async () => {
    const page = (offset: number) => JSON.stringify({ success: true, result: { total: 3, records: [{ ED_ID_STR: String(68001 + offset), ED_ENGLISH: `ED ${offset}` }] } });
    const fetch = fakeFetch([
      { match: /sort=_id&limit=1$/, body: page(0) },
      { match: /sort=_id&limit=1&offset=2$/, body: page(2) }
    ]);
    const first = await callTool<PobalBody & { data: { next_offset: number | null } }>(pobalModule, "pobal_deprivation_search", { limit: 1 }, fetch);
    expect(first.body.data).toMatchObject({ next_offset: 1 });
    const last = await callTool<PobalBody & { data: { next_offset: number | null } }>(pobalModule, "pobal_deprivation_search", { limit: 1, offset: 2 }, fetch);
    expect(last.body.data.areas[0]).toMatchObject({ ed_id: "068003" });
    expect(last.body.data.next_offset).toBeNull();
    expect(fetch.calls.every((c) => !c.url.includes("q="))).toBe(true);
  });
});

it("does not cache unsuccessful CKAN envelopes as empty results", async () => {
  let calls = 0;
  const ctx = createContext({ fetch: async () => {
    calls++;
    return Response.json(calls === 1 ? { success: false } : { success: true, result: { records: [] } });
  } });
  await expect(pobalModule.search!("Galvone", 3, ctx)).rejects.toThrow("unsuccessful");
  await expect(pobalModule.search!("Galvone", 3, ctx)).resolves.toEqual([]);
  expect(calls).toBe(2);
});
it("reports a missing Pobal area instead of inventing an empty score", async () => {
  const ctx = createContext({ fetch: async () => Response.json({ success: true, result: { records: [] } }) });
  await expect(pobalModule.fetchById!("missing", ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
});
