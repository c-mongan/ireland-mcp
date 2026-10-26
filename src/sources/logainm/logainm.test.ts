import { describe, expect, it } from "vitest";
import { fakeFetch } from "../../../test/helpers/fakeFetch.js";
import { callTool } from "../../../test/helpers/callTool.js";
import { createContext } from "../../gateway/context.js";
import { logainmModule as mod } from "./index.js";

// Synthetic API-shape fixture from https://docs.gaois.ie/en/data/logainm/v1.0/data.
// These names and coordinates are test data, not a captured provider response.
const place = {
  ID: 101, Permalink: "https://www.logainm.ie/101", DateCreated: "2020-01-01T00:00:00Z",
  Placenames: [{ ID: 1, Language: "ga", Wording: "Baile Átha Cliath", Main: true },
    { ID: 2, Language: "en", Wording: "Dublin", Main: true }],
  IncludedIn: [{ ID: 100002, NameEN: "Dublin", NameGA: "Baile Átha Cliath", Category: { ID: "CON" } }],
  Geography: { Accurate: false, Coordinates: [{ Latitude: 53.3, Longitude: -6.2 }] }
};
const page = { TotalCount: 2, TotalPages: 2, CurrentPage: 1, CountPerPage: 1, Results: [place] };
const env = { LOGAINM_API_KEY: "synthetic-secret" };

describe("Logainm search", () => {
  it("requires operator configuration without calling upstream", async () => {
    const fetch = fakeFetch([]);
    const { ok, body } = await callTool(mod, "logainm_search_places", { query: "Dublin" }, fetch, {});
    expect(ok).toBe(false);
    expect(body.error.code).toBe("NOT_CONFIGURED");
    expect(fetch.calls).toHaveLength(0);
  });
  it("returns bilingual names, stable IDs, containing units and coordinate accuracy with a bounded page", async () => {
    const fetch = fakeFetch([{ match: /www\.logainm\.ie\/api\/v1\.0/, body: JSON.stringify(page) }]);
    const { ok, body } = await callTool(mod, "logainm_search_places", { query: "Dublin", limit: 1 }, fetch, env);
    expect(ok).toBe(true);
    expect(body.data).toMatchObject({ total: 2, page: 1, next_page: 2, places: [{
      id: 101, names: [{ language: "ga", wording: "Baile Átha Cliath" }, { language: "en", wording: "Dublin" }],
      included_in: [{ id: 100002, name_en: "Dublin", name_ga: "Baile Átha Cliath", category_id: "CON" }],
      geography: { accurate: false, coordinates: [{ latitude: 53.3, longitude: -6.2 }] }
    }] });
    expect(body.truncated).toBe(true);
    const url = new URL(fetch.calls[0]!.url);
    expect(url.searchParams.get("Query")).toBe("Dublin");
    expect(url.searchParams.get("PerPage")).toBe("1");
    expect(url.searchParams.get("Page")).toBe("1");
    expect(fetch.calls[0]!.init?.headers).toMatchObject({ "X-Api-Key": "synthetic-secret" });
    expect(JSON.stringify(body)).not.toContain("synthetic-secret");
    expect(fetch.calls).toHaveLength(1);
  });
  it("rejects a provider page that exceeds the requested bound instead of skipping records", async () => {
    const fetch = fakeFetch([{ match: /api\/v1/, body: JSON.stringify({ ...page, Results: [place, { ...place, ID: 102 }] }) }]);
    const { ok, body } = await callTool(mod, "logainm_search_places", { query: "Dublin", limit: 1 }, fetch, env);
    expect(ok).toBe(false);
    expect(body.error.code).toBe("UPSTREAM_DOWN");
  });
  it("redacts an upstream parameter error that echoes credentials", async () => {
    const fetch = fakeFetch([{ match: /api\/v1/, status: 400, body: JSON.stringify({ error: "https://www.logainm.ie/?apiKey=synthetic-secret" }) }]);
    const { ok, body } = await callTool(mod, "logainm_search_places", { query: "Dublin" }, fetch, env);
    expect(ok).toBe(false);
    expect(body.error.code).toBe("BAD_ARGS");
    expect(JSON.stringify(body)).not.toContain("synthetic-secret");
    expect(JSON.stringify(body)).not.toContain("apiKey");
  });
  it("accepts camelCase JSON serialization of documented properties", async () => {
    const camel = JSON.stringify(page).replace(/"([A-Z][A-Za-z]*)":/g, (_match, key: string) => `"${key === "ID" ? "id" : key[0]!.toLowerCase() + key.slice(1)}":`);
    const { ok, body } = await callTool(mod, "logainm_search_places", { query: "Dublin", limit: 1 }, fakeFetch([{ match: /api\/v1/, body: camel }]), env);
    expect(ok).toBe(true);
    expect(body.data.places[0].id).toBe(101);
  });
  it.each([null, {}, { error: "denied" }, { ...page, TotalCount: -1 }, { ...page, TotalPages: 0 }, { ...page, Results: [{ ...place, DateCreated: "not-a-date" }] },
    { ...page, Results: [{ ...place, Placenames: [] }] },
    { ...page, Results: [{ ...place, Placenames: [{ ...place.Placenames[0], Wording: "  " }] }] },
    { ...page, Results: [{ ...place, Geography: { Accurate: true, Coordinates: [{ Latitude: 95, Longitude: 0 }] } }] },
    { ...page, CurrentPage: 2 }
  ])("rejects malformed provider data before caching: %j", async payload => {
    const fetch = fakeFetch([{ match: /api\/v1/, body: JSON.stringify(payload) }]);
    const ctx = createContext({ fetch, env });
    for (let attempt = 0; attempt < 2; attempt++) {
      const { ok, body } = await callTool(mod, "logainm_search_places", { query: "Dublin", limit: 1 }, ctx);
      expect(ok).toBe(false);
      expect(body.error.code).toBe("UPSTREAM_DOWN");
    }
    expect(fetch.calls).toHaveLength(2);
  });
  it("reports HTTP 401 without secrets or an empty successful result", async () => {
    const fetch = fakeFetch([{ match: /api\/v1/, status: 401, body: "synthetic-secret" }]);
    const { ok, body } = await callTool(mod, "logainm_search_places", { query: "Dublin" }, fetch, env);
    expect(ok).toBe(false);
    expect(body.error.code).toBe("UPSTREAM_DOWN");
    expect(body.error.message).toContain("401");
    expect(JSON.stringify(body)).not.toContain("synthetic-secret");
    expect(fetch.calls).toHaveLength(1);
  });
  it("returns the final page, does not invent missing coordinates, and caches repeated reads", async () => {
    const fetch = fakeFetch([{ match: /api\/v1/, body: JSON.stringify({ ...page, CurrentPage: 2,
      Results: [{ ...place, Geography: null, IncludedIn: [] }] }) }]);
    const ctx = createContext({ fetch, env });
    const args = { query: "Dublin", page: 2, limit: 1, place_id: 100002 };
    const { body } = await callTool(mod, "logainm_search_places", args, ctx);
    expect(body.data.next_page).toBeNull();
    expect(body.truncated).toBe(false);
    expect(body.data.places[0].geography).toBeNull();
    expect(body.data.places[0].modified_at).toBeNull();
    expect(new URL(fetch.calls[0]!.url).searchParams.get("PlaceID")).toBe("100002");
    expect((await callTool(mod, "logainm_search_places", args, ctx)).body.cached).toBe(true);
    expect(fetch.calls).toHaveLength(1);
  });
  it.each([{ query: " " }, { query: "Dublin", page: 0 }, { query: "Dublin", limit: 501 }])("rejects unsafe query bounds: %j", async args => {
    const fetch = fakeFetch([]);
    const { ok, body } = await callTool(mod, "logainm_search_places", args, fetch, env);
    expect(ok).toBe(false);
    expect(body.error.code).toBe("BAD_ARGS");
    expect(fetch.calls).toHaveLength(0);
  });
  it("returns a documented empty list without invented place data", async () => {
    const fetch = fakeFetch([{ match: /api\/v1/, body: JSON.stringify({ TotalCount: 0, TotalPages: 0, CurrentPage: 1, CountPerPage: 50, Results: [] }) }]);
    const { ok, body } = await callTool(mod, "logainm_search_places", { query: "No match" }, fetch, env);
    expect(ok).toBe(true);
    expect(body.data).toEqual({ total: 0, page: 1, next_page: null, places: [] });
  });
  it("does not hide a malformed refresh behind stale cached places", async () => {
    const route = { match: /api\/v1/, body: JSON.stringify(page) };
    const fetch = fakeFetch([route]);
    let time = 0;
    const ctx = createContext({ fetch, env, now: () => new Date(time) });
    expect((await callTool(mod, "logainm_search_places", { query: "Dublin", limit: 1 }, ctx)).ok).toBe(true);
    time += 86_400_001;
    route.body = JSON.stringify({ error: "invalid credentials" });
    const { ok, body } = await callTool(mod, "logainm_search_places", { query: "Dublin", limit: 1 }, ctx);
    expect(ok).toBe(false);
    expect(body.error.code).toBe("UPSTREAM_DOWN");
    expect(body.stale).toBeUndefined();
  });
  it("keeps the provider retrieval time on cache hits and stale fallback", async () => {
    const route = { match: /api\/v1/, body: JSON.stringify(page), status: 200 };
    const fetch = fakeFetch([route]);
    const downloadedAt = "2026-10-13T12:00:00.000Z";
    let time = Date.parse(downloadedAt);
    const ctx = createContext({ fetch, env, now: () => new Date(time) });
    const args = { query: "Dublin", limit: 1 };
    const first = await callTool(mod, "logainm_search_places", args, ctx);
    expect(first.body.retrieved_at).toBe(downloadedAt);
    time += 60_000;
    const hit = await callTool(mod, "logainm_search_places", args, ctx);
    expect(hit.body.cached).toBe(true);
    expect(hit.body.retrieved_at).toBe(downloadedAt);
    expect(fetch.calls).toHaveLength(1);
    time += 86_400_001;
    route.status = 503;
    route.body = "Unavailable";
    const stale = await callTool(mod, "logainm_search_places", args, ctx);
    expect(stale.ok).toBe(true);
    expect(stale.body.stale).toBe(true);
    expect(stale.body.retrieved_at).toBe(downloadedAt);
    expect(stale.body.data).toEqual(first.body.data);
  });
  it("rejects positive-total empty pages without caching them", async () => {
    const fetch = fakeFetch([{ match: /api\/v1/, body: JSON.stringify({ TotalCount: 2, TotalPages: 2, CurrentPage: 1, CountPerPage: 1, Results: [] }) }]);
    const ctx = createContext({ fetch, env });
    for (let attempt = 0; attempt < 2; attempt++) {
      const { ok, body } = await callTool(mod, "logainm_search_places", { query: "Dublin", limit: 1 }, ctx);
      expect(ok).toBe(false);
      expect(body.error.code).toBe("UPSTREAM_DOWN");
    }
    expect(fetch.calls).toHaveLength(2);
  });
  it.each([
    { TotalCount: 5, TotalPages: 3, CurrentPage: 1, CountPerPage: 2, Results: [place] },
    { TotalCount: 5, TotalPages: 3, CurrentPage: 2, CountPerPage: 2, Results: [place] },
    { TotalCount: 6, TotalPages: 3, CurrentPage: 3, CountPerPage: 2, Results: [place] },
    { TotalCount: 5, TotalPages: 3, CurrentPage: 3, CountPerPage: 2, Results: [place, place] },
    { TotalCount: 5, TotalPages: 3, CurrentPage: 4, CountPerPage: 2, Results: [place] }
  ])("rejects incomplete or overfilled pages without caching: %j", async payload => {
    const fetch = fakeFetch([{ match: /api\/v1/, body: JSON.stringify(payload) }]);
    const ctx = createContext({ fetch, env });
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await callTool(mod, "logainm_search_places", { query: "Dublin", page: payload.CurrentPage, limit: 2 }, ctx);
      expect(result.ok).toBe(false);
      expect(result.body.error.code).toBe("UPSTREAM_DOWN");
    }
    expect(fetch.calls).toHaveLength(2);
  });
  it.each([3, 4])("accepts exact final and beyond-final page sizes: page %i", async requested => {
    const payload = { TotalCount: 5, TotalPages: 3, CurrentPage: requested, CountPerPage: 2, Results: requested === 3 ? [place] : [] };
    const result = await callTool(mod, "logainm_search_places", { query: "Dublin", page: requested, limit: 2 }, fakeFetch([{ match: /api\/v1/, body: JSON.stringify(payload) }]), env);
    expect(result.ok).toBe(true);
    expect(result.body.data.next_page).toBeNull();
  });

});
