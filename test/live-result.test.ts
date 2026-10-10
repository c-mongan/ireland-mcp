import { appModules } from "../src/registry.js";
import { listOperations } from "../src/gateway/catalogue.js";
import { describe, expect, it } from "vitest";
// @ts-expect-error Operational script has no generated declaration file.
import { assessResult } from "../scripts/live-result.mjs";
// @ts-expect-error Operational script has no generated declaration file.
import { operationContracts } from "../scripts/live-contracts.mjs";
const result = (body: unknown, isError = false) => ({ content: [{ type: "text", text: JSON.stringify(body) }], isError });
const envelope = { operation: "met_get_warnings", data: { count: 0, warnings: [] }, source: "Met Éireann", url: "https://www.met.ie/", licence: "CC BY 4.0", attribution: "Met Éireann", retrieved_at: "2026-10-07T08:00:00Z", cached: false, truncated: false };

describe("live result acceptance", () => {
  it.each([{}, { data: {} }, { ...envelope, data: {} }, { ...envelope, source: "" }, { ...envelope, data: { count: 1 } }])("rejects malformed successful payloads", (body) => {
    expect(assessResult(result(body), "met-eireann/met_get_warnings").status).toBe("FAIL");
  });
  it("permits a valid empty warnings result", () => {
    expect(assessResult(result(envelope), "met-eireann/met_get_warnings").status).toBe("PASS");
  });
  it("marks stale responses as degraded instead of live success", () => {
    expect(assessResult(result({ ...envelope, stale: true }), "met-eireann/met_get_warnings").status).toBe("DEGRADED");
  });
  it("does not classify an unexpected source as a known setup gap", () => {
    expect(assessResult(result({ error: { code: "NOT_CONFIGURED" } }, true), "cso/cso_area_profile").status).toBe("FAIL");
  });
  it("labels the two known provider gates explicitly", () => {
    expect(assessResult(result({ error: { code: "NOT_CONFIGURED" } }, true), "nta/nta_get_trip_updates").status).toBe("NOT_CONFIGURED");
    expect(assessResult(result({ error: { code: "UPSTREAM_DOWN", message: "Kohesio returned HTTP 403." } }, true), "kohesio/kohesio_get_project").status).toBe("HOSTED_BLOCKED");
  });
});


it.each(listOperations(appModules().modules).map(({ source, tool }) => [source, tool.name]))(
  "rejects arbitrary success data for %s/%s", (source, operation) => {
    expect(assessResult(result({ ...envelope, operation, data: { garbage: true } }), `${source}/${operation}`).status).toBe("FAIL");
  }
);


it("requires a contract for every catalogue operation", () => {
  expect(Object.keys(operationContracts).sort()).toEqual(listOperations(appModules().modules).map(({ tool }) => tool.name).sort());
});

it("validates NTA fixture summary fields without requiring invented entities", () => {
  expect(operationContracts.nta_get_realtime_summary({ trips: 4, cancelled: 1, added: 1, routes: [] })).toBe(true);
});

it("rejects a station latest reading that is older than the observation series", () => {
  const oldest = { time: "2026-10-10T00:00", temperature_c: 10 };
  const newest = { time: "2026-10-10T12:00", temperature_c: 12 };
  const data = { station: "Dublin Airport", observations: [newest, oldest] };
  expect(operationContracts.met_get_observations({ ...data, latest: oldest })).toBe(false);
  expect(operationContracts.met_get_observations({ ...data, latest: newest })).toBe(true);
  expect(operationContracts.met_get_observations({ ...data, latest: { ...newest, temperature_c: 10 } })).toBe(false);
  const missingNewest = { ...newest, temperature_c: null };
  expect(operationContracts.met_get_observations({ ...data, observations: [missingNewest, oldest], latest: missingNewest })).toBe(true);
  expect(operationContracts.met_get_observations({ ...data, observations: [missingNewest, oldest], latest: oldest })).toBe(false);
  expect(operationContracts.met_get_observations({ station: "Dublin Airport", observations: [], latest: null })).toBe(true);
});

it("does not mark a partial combined-source response as healthy", () => {
  const body = { ...envelope, operation: "nearby", data: { lat: 53, lon: -6, boundaries: { error: { code: "UPSTREAM_DOWN" } }, forecast: [], sources: [] } };
  expect(assessResult(result(body), "cross/nearby").status).toBe("DEGRADED");
});

it("permits property statistics with no matching sales", () => {
  expect(assessResult(result({ ...envelope, operation: "ppr_price_stats", data: { count: 0, median_eur: null } }), "ppr/ppr_price_stats").status).toBe("PASS");
});
it("rejects inherited operation names", () => {
  expect(assessResult(result({ ...envelope, operation: "constructor", data: { garbage: true } }), "cross/constructor").status).toBe("FAIL");
});
