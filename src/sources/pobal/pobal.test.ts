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
