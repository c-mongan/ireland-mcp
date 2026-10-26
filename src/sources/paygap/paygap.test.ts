import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fakeFetch, type Route } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { createContext, DAY } from "../../gateway/context.js";
import { paygapModule as mod } from "./index.js";
import { parseGithubReports } from "./github.js";

const f = (name: string) => fixturePath(import.meta.url, name);
const route: Route = {
  match: /paygap\.ie\/downloads\/annotated$/,
  file: f("annotated-reports.csv"),
  headers: { "content-type": "text/csv; charset=utf-8" }
};
const tool = "paygap_search_reports";
const snapshot = "a35d6c57d54528d1bd2e339179eab048543fd993";
const githubBase = `https://raw.githubusercontent.com/zenbuffy/irishGenderPayGap/${snapshot}/`;
const fallbackRoutes: Route[] = [
  { match: /paygap\.ie\/downloads\/annotated$/, status: 403 },
  { match: (url) => url === `${githubBase}fullDenormalised.csv`, file: f("github-curated.csv") }
];

describe("PayGap reports module", () => {
  it("uses the publisher GitHub snapshot after HTTP 403 with source, metrics and exclusion evidence", async () => {
    const fetch = fakeFetch(fallbackRoutes);
    const { ok, body } = await callTool(mod, tool, { year: 2025 }, fetch);
    expect(fetch.calls).toHaveLength(2);
    expect(ok).toBe(true);
    expect(body.url).toBe(`${githubBase}fullDenormalised.csv`);
    expect(body.data.dataset).toMatchObject({ total_reports: 2, available_years: [2026, 2025], fallback: true,
      snapshot_commit: snapshot, snapshot_published_at: "2026-10-12T03:00:09Z", excluded_reports: { invalid_or_missing_year: 0 } });
    expect(body.data.dataset.coverage_note).toContain("may differ");
    expect(body.data.dataset.source_urls).toEqual([`${githubBase}fullDenormalised.csv`]);
    expect(body.data.reports[0]).toMatchObject({ company_name: "Mirror Example Ltd", company_site: "https://example.test",
      report_year: 2025, report_link: "https://example.test/report.pdf", nace_division: "47", nace_letter: "G", annotations_available: false,
      metrics: { mean_hourly_gap: -12.5, median_hourly_gap: null, mean_bonus_gap: 0, median_bonus_gap: "not reported", board_exec_female: 40, board_exec_male: 60 },
      annotations: { late_filing: null, report_removed: null, data_missing: null, notes: null } });
  });

  it("does not reuse the older array-shaped dataset cache after an upgrade", async () => {
    const fetch = fakeFetch([route]);
    const ctx = createContext({ fetch });
    await ctx.cache.getOrLoad("GET https://paygap.ie/downloads/annotated", DAY, async () => []);
    const result = await callTool(mod, tool, { company: "Acme", limit: 1 }, ctx);
    expect(result.ok).toBe(true);
    expect(result.body.data.reports).toHaveLength(1);
    expect(fetch.calls).toHaveLength(1);
  });

  it("caches a validated snapshot for one day and keeps its original source identity", async () => {
    const fetch = fakeFetch(fallbackRoutes);
    let now = new Date("2026-10-25T12:00:00Z");
    const ctx = createContext({ fetch, now: () => now });
    const first = await callTool(mod, tool, { limit: 1 }, ctx);
    const second = await callTool(mod, tool, { limit: 1 }, ctx);
    expect(first.ok && second.ok).toBe(true);
    expect(second.body.cached).toBe(true);
    expect(second.body.url).toBe(`${githubBase}fullDenormalised.csv`);
    const calls = fetch.calls.length;
    now = new Date(now.getTime() + DAY + 1);
    expect((await callTool(mod, tool, { limit: 1 }, ctx)).ok).toBe(true);
    expect(fetch.calls.length).toBeGreaterThan(calls);
  });

  it("fails closed for a malformed GitHub schema and does not fallback on other HTTP statuses", async () => {
    const malformed = fakeFetch([fallbackRoutes[0]!, { match: /raw\.githubusercontent\.com/, body: "unexpected,header\n1,2" }]);
    expect((await callTool(mod, tool, {}, malformed)).ok).toBe(false);
    for (const status of [401, 404]) {
      const fetch = fakeFetch([{ match: () => true, status }]);
      expect((await callTool(mod, tool, {}, fetch)).ok).toBe(false);
      expect(fetch.calls.every((call) => new URL(call.url).hostname === "paygap.ie")).toBe(true);
    }
  });

  it("marks source annotations unavailable instead of inventing false flags", async () => {
    const parsed = parseGithubReports(await readFile(f("github-curated.csv"), "utf8"));
    expect(parsed.annotations_available).toBe(false);
    expect(parsed.reports.every((report) => report.annotations_available === false)).toBe(true);
    expect(parsed.reports[1]!.annotations).toEqual(Object.fromEntries(Object.keys(parsed.reports[1]!.annotations).map((key) => [key, null])));
  });

  it("excludes invalid and missing report years without inventing a year", async () => {
    const curated = await readFile(f("github-curated.csv"), "utf8");
    for (const year of ["0", "", "202x", "1999", "2101"]) {
      const parsed = parseGithubReports(curated.replace(",2026,", `,${year},`));
      expect(parsed.reports).toHaveLength(1);
      expect(parsed.excluded_reports.invalid_or_missing_year).toBe(1);
    }
  });

  it("rejects malformed GitHub rows instead of silently losing fields", async () => {
    const curated = await readFile(f("github-curated.csv"), "utf8");
    expect(() => parseGithubReports(`${curated}broken,row\n`)).toThrow("wrong field count");
  });

  it("serves a stale validated fallback snapshot when its refresh has an availability failure", async () => {
    let unavailable = false;
    const fetch = fakeFetch([
      { match: (url) => unavailable && new URL(url).hostname === "raw.githubusercontent.com", status: 503 },
      ...fallbackRoutes
    ]);
    let now = new Date("2026-10-25T12:00:00Z");
    const ctx = createContext({ fetch, now: () => now });
    expect((await callTool(mod, tool, { limit: 1 }, ctx)).ok).toBe(true);
    unavailable = true;
    now = new Date(now.getTime() + DAY + 1);
    const result = await callTool(mod, tool, { limit: 1 }, ctx);
    expect(result.ok).toBe(true);
    expect(result.body.cached).toBe(true);
    expect(result.body.stale).toBe(true);
    expect(result.body.url).toBe(`${githubBase}fullDenormalised.csv`);
  });

  it("retains source row identity, blank and zero values, negative gaps, and annotation flags", async () => {
    const { ok, body } = await callTool(mod, tool, { company: "acme", year: 2025 }, fakeFetch([route]));
    expect(ok).toBe(true);
    expect(body.data.total_reports).toBe(2);
    expect(body.data.dataset).toEqual({ total_reports: 3, available_years: [2025, 2024] });
    expect(body.data.metric_unit).toBe("percent");
    expect(body.data.measurement_kind).toBe("employer_reported");
    expect(body.data.population_coverage).toBe("not_established");
    expect(body.data.reports).toHaveLength(2);
    expect(body.data.reports[0]).toMatchObject({
      company_name: "Acme, Example Ltd",
      report_year: 2025,
      report_link: "https://example.test/report-a.pdf",
      metrics: { mean_hourly_gap: -12.5, median_hourly_gap: null, mean_bonus_gap: 0 },
      annotations: { late_filing: "1", incomplete: "1", notes: "Reviewed source data.\nSecond note line." }
    });
    expect(body.data.reports[1]).toMatchObject({
      company_name: "Acme, Example Ltd",
      report_year: 2025,
      report_link: "https://example.test/report-b.pdf",
      metrics: { mean_hourly_gap: 0, median_hourly_gap: "not reported", mean_bonus_gap: "0x10", median_bonus_gap: "1e2" },
      annotations: { report_removed: "1", data_missing: "1", quartile_error: "1", no_narrative: "1" }
    });
    expect(body.attribution).toContain("PayGap.ie");
  });

  it("filters before pagination and reports the total number of matches", async () => {
    const { ok, body } = await callTool(mod, tool, { industry: "professional", limit: 1, offset: 0 }, fakeFetch([route]));
    expect(ok).toBe(true);
    expect(body.data.total_reports).toBe(1);
    expect(body.data.reports).toHaveLength(1);
    expect(body.data.reports[0].company_name).toBe("Other Ltd");
    expect(body.data.reports[0].report_year).toBe(2024);

    const secondPage = await callTool(mod, tool, { company: "acme", year: 2025, limit: 1, offset: 1 }, fakeFetch([route]));
    expect(secondPage.body.data.total_reports).toBe(2);
    expect(secondPage.body.data.reports[0].report_link).toBe("https://example.test/report-b.pdf");
    expect(secondPage.body.data.next_offset).toBeNull();
  });

  it("matches a one-letter industry filter to the NACE letter field", async () => {
    const { ok, body } = await callTool(mod, tool, { industry: "N", limit: 10 }, fakeFetch([route]));
    expect(ok).toBe(true);
    expect(body.data.total_reports).toBe(1);
    expect(body.data.reports[0].company_name).toBe("Other Ltd");
  });

  it("rejects an unexpected header instead of returning or caching the payload", async () => {
    const bad = (await readFile(f("annotated-reports.csv"), "utf8")).replace("Company Name,", "Employer,");
    let requests = 0;
    const fetch = fakeFetch([
      { match: () => ++requests === 1, body: bad },
      { ...route, match: () => true }
    ]);
    const ctx = createContext({ fetch });
    const first = await callTool(mod, tool, {}, ctx);
    expect(first.ok).toBe(false);
    expect(first.body.error.code).toBe("UPSTREAM_DOWN");
    const second = await callTool(mod, tool, {}, ctx);
    expect(second.ok).toBe(true);
    expect(fetch.calls).toHaveLength(2);
  });

  it("rejects an HTML error page returned with HTTP 200", async () => {
    const fetch = fakeFetch([{ match: /paygap\.ie\/downloads\/annotated$/, body: "<!doctype html><title>Oops</title>" }]);
    const { ok, body } = await callTool(mod, tool, {}, fetch);
    expect(ok).toBe(false);
    expect(body.error.code).toBe("UPSTREAM_DOWN");
    expect(fetch.calls).toHaveLength(1);
  });

  it("rejects malformed CSV returned with HTTP 200", async () => {
    const fetch = fakeFetch([{ match: /paygap\.ie\/downloads\/annotated$/, body: '"Company Name",broken"header\n' }]);
    const { ok, body } = await callTool(mod, tool, {}, fetch);
    expect(ok).toBe(false);
    expect(body.error.code).toBe("UPSTREAM_DOWN");
    expect(fetch.calls).toHaveLength(1);
  });

  it("uses cached validated rows and marks stale cache fallback", async () => {
    let requests = 0;
    const fetch = fakeFetch([
      { ...route, match: () => ++requests === 1 },
      { match: () => true, status: 503, body: "unavailable" }
    ]);
    let now = new Date("2026-10-25T12:00:00Z");
    const ctx = createContext({ fetch, now: () => now });
    const first = await callTool(mod, tool, { limit: 1 }, ctx);
    expect(first.ok).toBe(true);
    expect(first.body.cached).toBe(false);
    const cached = await callTool(mod, tool, { limit: 1 }, ctx);
    expect(cached.ok).toBe(true);
    expect(cached.body.cached).toBe(true);
    expect(cached.body.stale).toBeUndefined();
    expect(fetch.calls).toHaveLength(1);
    now = new Date(now.getTime() + DAY + 1);
    const result = await callTool(mod, tool, { limit: 1 }, ctx);
    expect(result.ok).toBe(true);
    expect(result.body.cached).toBe(true);
    expect(result.body.stale).toBe(true);
    expect(fetch.calls).toHaveLength(3); // 503 is retried once before the stale cache is served.
  });
});
