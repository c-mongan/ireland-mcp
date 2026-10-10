import { describe, expect, it } from "vitest";
import { fakeFetch, type Route } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { createContext } from "../../gateway/context.js";
import { loadFeed, ntaModule as mod } from "./index.js";

const routes: Route[] = [{ match: /gtfsr\/v2\/TripUpdates/, file: fixturePath(import.meta.url, "tripupdates-synthetic.json") }];
const env = { NTA_API_KEY: "test-key-123" };

describe("NTA module", () => {
  it("reports NOT_CONFIGURED without a key and never calls upstream", async () => {
    const fetch = fakeFetch(routes);
    const { body } = await callTool(mod, "nta_get_realtime_summary", {}, fetch, {});
    expect(body.error.code).toBe("NOT_CONFIGURED");
    expect(fetch.calls).toHaveLength(0);
  });

  it("summarises cancellations and delays per route", async () => {
    const fetch = fakeFetch(routes);
    const { body } = await callTool(mod, "nta_get_realtime_summary", {}, fetch, env);
    expect(body.data).toMatchObject({ feed_timestamp: "2026-10-05T16:00:00.000Z", trips: 4, cancelled: 1, added: 1 });
    expect(body.data.routes[0]).toEqual({ route_id: "4497_86595", trips: 2, cancelled: 1, added: 0, avg_delay_s: 180, max_delay_s: 180 });
    expect(JSON.stringify(body)).not.toContain("test-key-123");
  });

  it.each([null, [], {}, { error: "service unavailable" }, { header: null, entity: [] },
    { header: { gtfs_realtime_version: "2.0", timestamp: "invalid" }, entity: [] },
    { header: { gtfs_realtime_version: "2.0" }, entity: [] },
    { header: { timestamp: "1791216000" }, entity: [] },
    { header: { gtfs_realtime_version: "9.0", timestamp: "1791216000" }, entity: [] },
    { header: { gtfs_realtime_version: "2.0", timestamp: -1 }, entity: [] },
    { header: { gtfs_realtime_version: "2.0", timestamp: 1e20 }, entity: [] },
    { header: { gtfs_realtime_version: "2.0", timestamp: "1791216000" }, entity: {} },
    { header: { gtfs_realtime_version: "2.0", timestamp: "1791216000" }, entity: [null] }
  ].map((payload) => ({ payload })))("rejects malformed HTTP-200 feed envelopes before caching: $payload", async ({ payload }) => {
    const fetch = fakeFetch([{ match: /TripUpdates/, body: JSON.stringify(payload) }]);
    const context = createContext({ fetch, env });
    for (let i = 0; i < 2; i += 1) {
      const { ok, body } = await callTool(mod, "nta_get_realtime_summary", {}, context);
      expect(ok).toBe(false);
      expect(body.error.code).toBe("UPSTREAM_DOWN");
      expect(body.error.message).toContain("malformed");
      expect(JSON.stringify(body)).not.toContain("test-key-123");
    }
    expect(fetch.calls).toHaveLength(2);
  });

  it.each([[], undefined].map((entity) => ({ entity })))("accepts a valid empty feed without inventing trip data: $entity", async ({ entity }) => {
    const fetch = fakeFetch([{ match: /TripUpdates/, body: JSON.stringify({
      header: { gtfs_realtime_version: "2.0", timestamp: "1791216000" }, entity
    }) }]);
    const { ok, body } = await callTool(mod, "nta_get_realtime_summary", {}, fetch, env);
    expect(ok).toBe(true);
    expect(body.data).toMatchObject({ feed_timestamp: "2026-10-05T16:00:00.000Z", trips: 0, cancelled: 0, added: 0, routes: [] });
  });

  it("accepts PascalCase feed envelopes", async () => {
    const fetch = fakeFetch([{ match: /TripUpdates/, body: JSON.stringify({
      Header: { GtfsRealtimeVersion: "2.0", Timestamp: "1791216000" }, Entity: []
    }) }]);
    const { ok, body } = await callTool(mod, "nta_get_realtime_summary", {}, fetch, env);
    expect(ok).toBe(true);
    expect(body.data.feed_timestamp).toBe("2026-10-05T16:00:00.000Z");
  });

  it("does not hide a malformed refresh behind a stale cached feed", async () => {
    const route: Route = { match: /TripUpdates/, file: fixturePath(import.meta.url, "tripupdates-synthetic.json") };
    const fetch = fakeFetch([route]);
    let time = 0;
    const context = createContext({ fetch, env, now: () => new Date(time) });
    expect((await callTool(mod, "nta_get_realtime_summary", {}, context)).ok).toBe(true);
    time += 60_001;
    delete route.file;
    route.body = JSON.stringify({ error: "service unavailable" });
    const { ok, body } = await callTool(mod, "nta_get_realtime_summary", {}, context);
    expect(ok).toBe(false);
    expect(body.error.code).toBe("UPSTREAM_DOWN");
    expect(body.stale).toBeUndefined();
    expect(fetch.calls).toHaveLength(2);
  });

  it("filters trip updates by stop and handles camelCase feeds", async () => {
    const { body } = await callTool(mod, "nta_get_trip_updates", { stop_id: "8350DB000123" }, fakeFetch(routes), env);
    expect(body.data.total).toBe(1);
    expect(body.data.trips[0]).toMatchObject({ trip_id: "4502_2001", route_id: "4502_90001", stops: [{ departure_delay_s: -30 }] });
  });

  it("single-flights concurrent loads and sends the key as a header", async () => {
    const fetch = fakeFetch(routes);
    const ctx = createContext({ fetch, env });
    await Promise.all([loadFeed(ctx), loadFeed(ctx), loadFeed(ctx)]);
    await loadFeed(ctx);
    expect(fetch.calls).toHaveLength(1);
  });

  it("keeps the key out of upstream errors", async () => {
    const fetch = fakeFetch([{ match: /TripUpdates/, status: 401, body: "denied" }]);
    const { body } = await callTool(mod, "nta_get_trip_updates", {}, fetch, env);
    expect(body.error.code).toBe("UPSTREAM_DOWN");
    expect(JSON.stringify(body)).not.toMatch(/test-key|api\.nationaltransport/);
  });
});
