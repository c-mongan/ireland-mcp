import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fakeFetch, type Route } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { createContext } from "../../gateway/context.js";
import { createLobbyingModule } from "./index.js";

const page1File = fixturePath(import.meta.url, "search-page-1.json");
const page2File = fixturePath(import.meta.url, "search-page-2.json");
const now = () => new Date("2026-10-25T12:00:00Z");
const searchRoutes: Route[] = [
  { match: (url) => new URL(url).searchParams.get("currentPage") === "1", file: page1File },
  { match: (url) => new URL(url).searchParams.get("currentPage") === "2", file: page2File }
];

describe("lobbying search module", () => {
  it("uses one-based Search API pages and returns distinct page records", async () => {
    const fetch = fakeFetch(searchRoutes);
    const ctx = createContext({ fetch, now });
    const mod = createLobbyingModule();
    const first = await callTool(mod, "lobbying_search_returns", { limit: 1 }, ctx);
    const second = await callTool(mod, "lobbying_search_returns", { page: 2, limit: 1 }, ctx);

    expect(first.body.data.returns[0]).toMatchObject({
      id: 148315,
      url: "https://www.lobbying.ie/return/148315/fictional-lobbyist-one",
      lobbyist: "Fictional Lobbyist One",
      submitted_at: "2026-10-24T18:10:36.423+00:00",
      submitted_date: "2026-10-24",
      nil_return: true,
      return_version_type: 2,
      subject_matter_text: null,
      dpo_name_resolved: null
    });
    expect(second.body.data.returns[0].id).toBe(148314);
    expect(first.body.data.total).toBe(2);
    expect(first.body.data.next_page).toBe(2);
    expect(second.body.data.next_page).toBeNull();

    const firstUrl = new URL(fetch.calls[0]!.url);
    const secondUrl = new URL(fetch.calls[1]!.url);
    expect(firstUrl.pathname).toBe("/api/Search");
    expect(firstUrl.searchParams.get("currentPage")).toBe("1");
    expect(secondUrl.searchParams.get("currentPage")).toBe("2");
    expect(firstUrl.searchParams.get("returnDateFrom")).toBe("01-01-2026");
    expect(firstUrl.searchParams.get("returnDateTo")).toBe("25-10-2026");
    expect(first.body.url).toBe(firstUrl.href);
    expect(first.body.licence).toMatch(/PSI/i);
    expect(first.body.attribution).toContain("Lobbying.ie");
  });

  it("preserves the API's textual answers separately from its boolean flags", async () => {
    const { ok, body } = await callTool(createLobbyingModule(), "lobbying_search_returns", { limit: 1 }, createContext({ fetch: fakeFetch(searchRoutes), now }));
    expect(ok).toBe(true);
    expect(body.data.returns[0]).toMatchObject({
      did_any_dpos_carry_out_lobbying: "No",
      on_behalf_of_client: "",
      is_on_behalf_of_client: false,
      is_published: true
    });
  });

  it("encodes filters, applies default dates, and omits private response fields", async () => {
    const fetch = fakeFetch(searchRoutes);
    const result = await callTool(createLobbyingModule(), "lobbying_search_returns", {
      query: "housing & supply", date_from: "2026-10-01", date_to: "2026-10-31",
      official: "Official Example", lobbyist: "Fictional Lobbyist", limit: 1
    }, createContext({ fetch, now }));
    const url = new URL(fetch.calls[0]!.url);
    expect(url.searchParams.get("queryText")).toBe("housing & supply");
    expect(url.searchParams.get("returnDateFrom")).toBe("01-10-2026");
    expect(url.searchParams.get("returnDateTo")).toBe("31-10-2026");
    expect(url.searchParams.get("dpo")).toBe("Official Example");
    expect(url.searchParams.get("lobbyist")).toBe("Fictional Lobbyist");
    expect(url.searchParams.get("pageSize")).toBe("1");
    expect(result.body.data).toMatchObject({ date_from: "2026-10-01", date_to: "2026-10-31" });
    expect(result.body.data.returns[0]).not.toHaveProperty("login_id");
    expect(result.body.data.returns[0]).not.toHaveProperty("last_edit_by_user");
    expect(result.body.data.returns[0]).not.toHaveProperty("return_mass_communication_contacts");
  });

  it("fills a missing bound within its calendar year and caps it at today", async () => {
    const fetch = fakeFetch(searchRoutes);
    const ctx = createContext({ fetch, now });
    const mod = createLobbyingModule();
    const fromDate = await callTool(mod, "lobbying_search_returns", { date_from: "2026-10-20", limit: 1 }, ctx);
    expect(new URL(fetch.calls[0]!.url).searchParams.get("returnDateTo")).toBe("25-10-2026");
    expect(fromDate.body.data).toMatchObject({ date_from: "2026-10-20", date_to: "2026-10-25" });

    const toDate = await callTool(mod, "lobbying_search_returns", { date_to: "2025-10-01", limit: 1 }, ctx);
    expect(new URL(fetch.calls[1]!.url).searchParams.get("returnDateFrom")).toBe("01-01-2025");
    expect(toDate.body.data).toMatchObject({ date_from: "2025-01-01", date_to: "2025-10-01" });
  });

  it("rejects impossible, future-only and over-366-day windows before fetching", async () => {
    const fetch = fakeFetch(searchRoutes);
    const ctx = createContext({ fetch, now });
    const mod = createLobbyingModule();
    expect((await callTool(mod, "lobbying_search_returns", { date_from: "2026-02-30" }, ctx)).body.error.code).toBe("BAD_ARGS");
    expect((await callTool(mod, "lobbying_search_returns", { date_from: "2027-01-01" }, ctx)).body.error.code).toBe("BAD_ARGS");
    expect((await callTool(mod, "lobbying_search_returns", { date_from: "2024-01-01", date_to: "2026-01-01" }, ctx)).body.error.hint).toContain("366 days");
    expect(fetch.calls).toHaveLength(0);
  });

  it("allows an inclusive 366-day date window", async () => {
    const fetch = fakeFetch(searchRoutes);
    const result = await callTool(createLobbyingModule(), "lobbying_search_returns", {
      date_from: "2024-01-01", date_to: "2024-12-31", limit: 1
    }, createContext({ fetch, now }));
    expect(result.body.data).toMatchObject({ date_from: "2024-01-01", date_to: "2024-12-31" });
    expect(fetch.calls).toHaveLength(1);
  });

  it("rejects invalid Search API payloads before caching them", async () => {
    let attempts = 0;
    const fetch = (async () => new Response(++attempts === 1
      ? JSON.stringify({ Message: "synthetic error body" })
      : readFileSync(page1File, "utf8"), { headers: { "content-type": "application/json" } })) as typeof globalThis.fetch;
    const ctx = createContext({ fetch, now });
    const mod = createLobbyingModule();
    expect((await callTool(mod, "lobbying_search_returns", { limit: 1 }, ctx)).body.error.code).toBe("UPSTREAM_DOWN");
    expect((await callTool(mod, "lobbying_search_returns", { limit: 1 }, ctx)).body.data.returns[0].id).toBe(148315);
    expect((await callTool(mod, "lobbying_search_returns", { limit: 1 }, ctx)).body.cached).toBe(true);
    expect(attempts).toBe(2);
  });

  it("accepts a valid empty page with a zero total", async () => {
    const fetch = fakeFetch([{ match: /api\/Search/, body: JSON.stringify({ Total: 0, Data: [], Facets: {} }) }]);
    const result = await callTool(createLobbyingModule(), "lobbying_search_returns", { limit: 1 }, createContext({ fetch, now }));
    expect(result.body.data).toMatchObject({ total: 0, returned: 0, next_page: null, returns: [] });
    expect(result.body.truncated).toBe(false);
  });

  it("rejects an invalid public return URL before caching the payload", async () => {
    const bad = JSON.parse(readFileSync(page1File, "utf8")) as { Data: Array<Record<string, unknown>> };
    bad.Data[0]!.FormattedUrl = "https://example.invalid/return/148315";
    let attempts = 0;
    const fetch = (async () => new Response(++attempts === 1 ? JSON.stringify(bad) : readFileSync(page1File, "utf8"), {
      headers: { "content-type": "application/json" }
    })) as typeof globalThis.fetch;
    const ctx = createContext({ fetch, now });
    const mod = createLobbyingModule();
    expect((await callTool(mod, "lobbying_search_returns", { limit: 1 }, ctx)).body.error.code).toBe("UPSTREAM_DOWN");
    expect((await callTool(mod, "lobbying_search_returns", { limit: 1 }, ctx)).body.data.returns[0].id).toBe(148315);
    expect(attempts).toBe(2);
  });

  it("rejects a row explicitly marked as private before caching it", async () => {
    const draft = JSON.parse(readFileSync(page1File, "utf8")) as { Data: Array<Record<string, unknown>> };
    draft.Data[0]!.IsDraft = true;
    let attempts = 0;
    const fetch = (async () => new Response(++attempts === 1 ? JSON.stringify(draft) : readFileSync(page1File, "utf8"), {
      headers: { "content-type": "application/json" }
    })) as typeof globalThis.fetch;
    const ctx = createContext({ fetch, now });
    const mod = createLobbyingModule();
    expect((await callTool(mod, "lobbying_search_returns", { limit: 1 }, ctx)).body.error.code).toBe("UPSTREAM_DOWN");
    expect((await callTool(mod, "lobbying_search_returns", { limit: 1 }, ctx)).body.data.returns[0].id).toBe(148315);
    expect(attempts).toBe(2);
  });

  it("rejects page and result limits outside the bounded range", async () => {
    const fetch = fakeFetch(searchRoutes);
    const result = await callTool(createLobbyingModule(), "lobbying_search_returns", { page: 0, limit: 501 }, createContext({ fetch, now }));
    expect(result.body.error.code).toBe("BAD_ARGS");
    expect(fetch.calls).toHaveLength(0);
  });
});
