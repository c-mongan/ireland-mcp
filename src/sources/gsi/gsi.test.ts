import { describe, expect, it } from "vitest";
import { fakeFetch } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { gsiModule } from "./index.js";
import { createContext } from "../../gateway/context.js";

const point = { lat: 53.3498, lon: -6.2603 };
describe("GSI groundwater vulnerability", () => {
  it("returns the mapped category and source limits for a WGS84 point", async () => {
    const fetch = fakeFetch([{ match: /\/MapServer\/0\/query\?/, file: fixturePath(import.meta.url, "dublin-point.json") }]);
    const { ok, body } = await callTool(gsiModule, "groundwater_vulnerability_at", point, fetch);
    expect(ok).toBe(true);
    expect(body.data.status).toBe("matched");
    expect(body.data.areas[0]).toMatchObject({ category: "L", description: "Low" });
    expect(body.data.map_scale).toBe("1:40000");
    expect(body.data.dataset_revision).toBeNull();
    expect(body.licence).toBe("CC BY 4.0");
    expect(body.truncated).toBe(false);
    const url = new URL(fetch.calls[0]!.url);
    expect(url.hostname).toBe("gsi.geodata.gov.ie");
    expect(url.searchParams.get("geometry")).toBe("-6.2603,53.3498");
    expect(url.searchParams.get("inSR")).toBe("4326");
    expect(url.searchParams.get("spatialRel")).toBe("esriSpatialRelIntersects");
    expect(url.searchParams.get("outFields")).toBe("VUL40KID,VUL_CAT,VUL_DESC");
    expect(url.searchParams.get("returnGeometry")).toBe("false");
  });
  it("rejects invalid coordinates and limits before any upstream call", async () => {
    const fetch = fakeFetch([]);
    for (const args of [{ ...point, lat: 91 }, { ...point, lon: -181 }, { lat: 48.85, lon: 2.35 }, { ...point, limit: 11 }, { ...point, limit: 0 }, { ...point, limit: 1.5 }]) {
      const result = await callTool(gsiModule, "groundwater_vulnerability_at", args, fetch);
      expect(result.ok).toBe(false);
      expect(result.body.error.code).toBe("BAD_ARGS");
    }
    expect(fetch.calls).toHaveLength(0);
  });
  it("marks transfer-limited results incomplete and bounds returned records", async () => {
    const features = Array.from({ length: 3 }, (_, i) => ({ attributes: { VUL40KID: `area-${i}`, VUL_CAT: "H", VUL_DESC: "High" } }));
    const fetch = fakeFetch([{ match: /\/query\?/, body: JSON.stringify({ features, exceededTransferLimit: true }) }]);
    const { body } = await callTool(gsiModule, "groundwater_vulnerability_at", { ...point, limit: 2 }, fetch);
    expect(body.truncated).toBe(true);
    expect(body.data.status).toBe("matched");
    expect(body.data.areas).toHaveLength(2);
    expect(new URL(fetch.calls[0]!.url).searchParams.get("resultRecordCount")).toBe("2");
  });
  it("reports upstream errors and malformed data without caching them as coverage", async () => {
    for (const body of ['{"error":{"code":500,"message":"Unavailable"},"features":[]}', '{"features":[{"attributes":{"VUL_CAT":"L"}}]}', '{"features":null}', '{"features":[],"exceededTransferLimit":"false"}']) {
      const fetch = fakeFetch([{ match: /\/query\?/, body }]);
      const ctx = createContext({ fetch });
      const first = await callTool(gsiModule, "groundwater_vulnerability_at", point, ctx);
      const second = await callTool(gsiModule, "groundwater_vulnerability_at", point, ctx);
      expect(first.ok).toBe(false);
      expect(first.body.error.code).toBe("UPSTREAM_DOWN");
      expect(second.ok).toBe(false);
      expect(fetch.calls).toHaveLength(2);
    }
  });
  it("distinguishes no polygon coverage from incomplete empty results", async () => {
    const noCoverage = await callTool(gsiModule, "groundwater_vulnerability_at", point, fakeFetch([{ match: /\/query\?/, body: '{"features":[]}' }]));
    expect(noCoverage.ok).toBe(true);
    expect(noCoverage.body.data.status).toBe("outside_coverage");
    expect(noCoverage.body.data.areas).toEqual([]);
    expect(noCoverage.body.truncated).toBe(false);
    const incomplete = await callTool(gsiModule, "groundwater_vulnerability_at", point, fakeFetch([{ match: /\/query\?/, body: '{"features":[],"exceededTransferLimit":true}' }]));
    expect(incomplete.body.data.status).toBe("incomplete");
    expect(incomplete.body.truncated).toBe(true);
  });
  it("uses the cache for repeated reads and reports HTTP failure as unavailable", async () => {
    const fetch = fakeFetch([{ match: /\/query\?/, file: fixturePath(import.meta.url, "dublin-point.json") }]);
    const ctx = createContext({ fetch });
    const first = await callTool(gsiModule, "groundwater_vulnerability_at", point, ctx);
    const second = await callTool(gsiModule, "groundwater_vulnerability_at", point, ctx);
    expect(first.body.cached).toBe(false);
    expect(second.body.cached).toBe(true);
    expect(fetch.calls).toHaveLength(1);
    const failed = await callTool(gsiModule, "groundwater_vulnerability_at", point, fakeFetch([{ match: /\/query\?/, status: 503 }]));
    expect(failed.ok).toBe(false);
    expect(failed.body.error.code).toBe("UPSTREAM_DOWN");
    const invalidJson = await callTool(gsiModule, "groundwater_vulnerability_at", point, fakeFetch([{ match: /\/query\?/, body: "not JSON" }]));
    expect(invalidJson.ok).toBe(false);
    expect(invalidJson.body.error.code).toBe("UPSTREAM_DOWN");
  });
  it("preserves provider retrieval time on cache hits and stale fallback", async () => {
    let now = new Date("2026-10-13T10:00:00.000Z");
    const fetch = fakeFetch([
      { match: () => now.getUTCDate() === 15, status: 503 },
      { match: /\/query\?/, file: fixturePath(import.meta.url, "dublin-point.json") }
    ]);
    const ctx = createContext({ fetch, now: () => now });
    const first = await callTool(gsiModule, "groundwater_vulnerability_at", point, ctx);
    expect(first.body.retrieved_at).toBe("2026-10-13T10:00:00.000Z");
    now = new Date("2026-10-13T12:00:00.000Z");
    const cached = await callTool(gsiModule, "groundwater_vulnerability_at", point, ctx);
    expect(cached.body.cached).toBe(true);
    expect(cached.body.retrieved_at).toBe(first.body.retrieved_at);
    now = new Date("2026-10-15T10:00:00.000Z");
    const stale = await callTool(gsiModule, "groundwater_vulnerability_at", point, ctx);
    expect(stale.body.stale).toBe(true);
    expect(stale.body.retrieved_at).toBe(first.body.retrieved_at);
    expect(stale.body.data.areas).toEqual(first.body.data.areas);
    now = new Date("2026-10-16T10:00:00.000Z");
    const refreshed = await callTool(gsiModule, "groundwater_vulnerability_at", point, ctx);
    expect(refreshed.body.cached).toBe(false);
    expect(refreshed.body.retrieved_at).toBe("2026-10-16T10:00:00.000Z");
  });
});
