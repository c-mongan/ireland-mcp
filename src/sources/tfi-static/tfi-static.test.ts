import { describe, expect, it } from "vitest";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { fakeFetch } from "../../../test/helpers/fakeFetch.js";
import { createContext } from "../../gateway/context.js";
import { tfiStaticModule as mod } from "./index.js";

const fixture = fixturePath(import.meta.url, "stops-synthetic.json");
const fetchFixture = () => fakeFetch([{ match: /\/Data\/NaPTAN\.json$/, file: fixture }]);

describe("TFI static stop discovery", () => {
  it("pages results by stable identifier and rejects excessive limits", async () => {
    const fetch = fetchFixture();
    const ctx = createContext({ fetch, now: () => new Date("2026-10-13T18:00:00Z") });
    const first = await callTool(mod, "tfi_static_search_stops", { name: "Derry", limit: 1 }, ctx);
    expect(first.body.data.stops.map((s: { atco_code: string }) => s.atco_code)).toEqual(["701000002"]);
    expect(first.body.data.next_offset).toBe(1);
    expect(first.body.truncated).toBe(true);
    const second = await callTool(mod, "tfi_static_search_stops", { name: "Derry", offset: 1, limit: 1 }, ctx);
    expect(second.body.data.stops[0].atco_code).toBe("7010B158131");
    expect(second.body.data.next_offset).toBeNull();
    expect(second.body.cached).toBe(true);
    expect(second.body.data.fetched_at).toBe("2026-10-13T18:00:00.000Z");
    expect(fetch.calls).toHaveLength(1);
    expect((await callTool(mod, "tfi_static_search_stops", { limit: 101 }, ctx)).ok).toBe(false);
  });
  it("filters by exact AtcoCode and distance, and requires both coordinates", async () => {
    const exact = await callTool(mod, "tfi_static_search_stops", { atco_code: "7010B158131" }, fetchFixture());
    expect(exact.body.data.stops).toHaveLength(1);
    const near = await callTool(mod, "tfi_static_search_stops", { lat: 54.996629, lon: -7.317866, radius: 100 }, fetchFixture());
    expect(near.body.data.stops.map((s: { atco_code: string }) => s.atco_code)).toEqual(["7010B158131"]);
    expect(near.body.data.stops[0].distance_m).toBe(0);
    const partial = await callTool(mod, "tfi_static_search_stops", { lat: 54.99 }, fetchFixture());
    expect(partial.ok).toBe(false);
  });
  it("fails malformed upstream records without caching them or inventing empty results", async () => {
    let calls = 0;
    const ctx = createContext({ fetch: async () => { calls += 1; return Response.json({ NaPTAN: { StopPoints: { StopPoint: [{ AtcoCode: "broken" }] } } }); } });
    expect((await callTool(mod, "tfi_static_search_stops", {}, ctx)).ok).toBe(false);
    expect((await callTool(mod, "tfi_static_search_stops", {}, ctx)).ok).toBe(false);
    expect(calls).toBe(2);
    expect((await callTool(mod, "tfi_static_search_stops", {}, fakeFetch([{ match: /NaPTAN/, body: "not json" }]))).ok).toBe(false);
    const rejected = await callTool(mod, "tfi_static_search_stops", {}, fakeFetch([{ match: /NaPTAN/, status: 403 }]));
    expect(rejected.ok).toBe(false);
  });
  it("keeps missing or malformed coordinates null and excludes them from point searches", async () => {
    const fetch = fakeFetch([{ match: /NaPTAN/, body: JSON.stringify({ NaPTAN: { StopPoints: { StopPoint: [{ AtcoCode: "invalid-coords", Descriptor: { CommonName: { "#text": "Location unknown" } }, Place: { Location: { Translation: { Latitude: "", Longitude: "bad" } } } }] } } }) }]);
    const ctx = createContext({ fetch });
    const result = await callTool(mod, "tfi_static_search_stops", {}, ctx);
    expect(result.body.data.stops[0]).toMatchObject({ lat: null, lon: null });
    expect((await callTool(mod, "tfi_static_search_stops", { lat: 53.3, lon: -6.2 }, ctx)).body.data.stops).toEqual([]);
  });
  it("rejects oversized responses before parsing", async () => {
    const { ok } = await callTool(mod, "tfi_static_search_stops", {}, fakeFetch([{ match: /NaPTAN/, file: fixture, headers: { "content-length": String(31 * 1024 * 1024) } }]));
    expect(ok).toBe(false);
  });
  it("rejects an empty or excessive national stop feed while accepting a valid empty search", async () => {
    for (const points of [[], Array.from({ length: 100_001 }, () => ({ AtcoCode: "bound", Descriptor: { CommonName: "Bound" } }))]) {
      const result = await callTool(mod, "tfi_static_search_stops", {}, fakeFetch([{ match: /NaPTAN/, body: JSON.stringify({ NaPTAN: { StopPoints: { StopPoint: points } } }) }]));
      expect(result.ok).toBe(false);
      expect(result.body.error.code).toBe("UPSTREAM_DOWN");
    }
    const emptySearch = await callTool(mod, "tfi_static_search_stops", { name: "no such synthetic stop" }, fetchFixture());
    expect(emptySearch.ok).toBe(true);
    expect(emptySearch.body.data.stops).toEqual([]);
    expect(emptySearch.body.data.total).toBe(0);
  });
  it("preserves the original retrieval timestamp through cache hits and stale fallback", async () => {
    let clock = new Date("2026-10-13T18:00:00Z");
    let offline = false;
    const fixtureFetch = fetchFixture();
    const ctx = createContext({ now: () => clock, fetch: async (url, init) => offline ? new Response("unavailable", { status: 503 }) : fixtureFetch(url, init) });
    const initial = await callTool(mod, "tfi_static_search_stops", { limit: 1 }, ctx);
    clock = new Date("2026-10-13T19:00:00Z");
    const cached = await callTool(mod, "tfi_static_search_stops", { limit: 1 }, ctx);
    expect(cached.body.cached).toBe(true);
    expect(cached.body.retrieved_at).toBe(initial.body.retrieved_at);
    expect(cached.body.retrieved_at).toBe(cached.body.data.fetched_at);
    clock = new Date("2026-10-15T18:00:00Z");
    offline = true;
    const stale = await callTool(mod, "tfi_static_search_stops", { limit: 1 }, ctx);
    expect(stale.ok).toBe(true);
    expect(stale.body.stale).toBe(true);
    expect(stale.body.retrieved_at).toBe("2026-10-13T18:00:00.000Z");
    expect(stale.body.data.fetched_at).toBe(stale.body.retrieved_at);
  });
  it("finds names and preserves NaPTAN identifiers and WGS84 coordinates with snapshot evidence", async () => {
    const { ok, body } = await callTool(mod, "tfi_static_search_stops", { name: "bus station" }, fetchFixture());
    expect(ok).toBe(true);
    expect(body.data.stops).toEqual([{ atco_code: "7010B158131", name: "Derry Bus Station", plate_code: "158131", lat: 54.996629, lon: -7.317866, administrative_area_ref: "701", status: "active" }]);
    expect(body.data.snapshot_modified_at).toBe("2026-10-08T14:40:23.314941");
    expect(body.data.note).toContain("Static stop records");
    expect(body.licence).toBe("CC BY 4.0");
  });
});
