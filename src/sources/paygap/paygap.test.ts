import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fakeFetch, type Route } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { createContext, DAY } from "../../gateway/context.js";
import { paygapModule as mod } from "./index.js";

const f = (name: string) => fixturePath(import.meta.url, name);
const route: Route = {
  match: /paygap\.ie\/downloads\/annotated$/,
  file: f("annotated-reports.csv"),
  headers: { "content-type": "text/csv; charset=utf-8" }
};
const tool = "paygap_search_reports";

describe("PayGap reports module", () => {
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
  });

  it("rejects malformed CSV returned with HTTP 200", async () => {
    const fetch = fakeFetch([{ match: /paygap\.ie\/downloads\/annotated$/, body: '"Company Name",broken"header\n' }]);
    const { ok, body } = await callTool(mod, tool, {}, fetch);
    expect(ok).toBe(false);
    expect(body.error.code).toBe("UPSTREAM_DOWN");
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
