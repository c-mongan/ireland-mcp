import { describe, expect, it } from "vitest";
import { fakeFetch, parseToolText, type Route } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { connectClient } from "../../../test/helpers/mcpClient.js";
import { createContext } from "../../gateway/context.js";
import { createAppServer } from "../../registry.js";
import { bikesModule as mod } from "./index.js";

const f = (name: string) => fixturePath(import.meta.url, name);
const routes: Route[] = [
  { match: /api\.citybik\.es\/v2\/networks(\?|$)/, file: f("networks.json") },
  { match: /api\.citybik\.es\/v2\/networks\/dublinbikes/, file: f("dublin-stations.json") }
];

describe("bikes module", () => {
  it("lists Irish bike-share networks from CityBikes", async () => {
    const { ok, body } = await callTool<any>(mod, "bikes_networks", {}, fakeFetch(routes)); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(ok).toBe(true);
    expect(body.data.networks.map((n: { id: string }) => n.id)).toEqual(["cork", "dublinbikes", "galway", "limerick", "waterford"]);
    expect(body.attribution).toContain("CityBikes");
  });

  it("returns nearby stations with bike availability, empty docks and distance", async () => {
    const { ok, body } = await callTool<any>( // eslint-disable-line @typescript-eslint/no-explicit-any
      mod,
      "bikes_stations_near",
      { lat: 53.3498, lon: -6.2603, radius: 1000, network: "dublinbikes" },
      fakeFetch(routes)
    );
    expect(ok).toBe(true);
    expect(body.data.stations[0]).toMatchObject({
      network_id: "dublinbikes",
      name: "PRINCES STREET / O'CONNELL STREET",
      free_bikes: 21,
      empty_slots: 2
    });
    expect(body.data.stations[0].distance_m).toBeLessThan(100);
  });

  it("chooses Irish networks near the point when no network is provided", async () => {
    const fetch = fakeFetch(routes);
    const { ok, body } = await callTool<any>(mod, "bikes_stations_near", { lat: 53.3498, lon: -6.2603, radius: 1000 }, fetch); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(ok).toBe(true);
    expect(body.data.networks_considered).toEqual(["dublinbikes"]);
  });

  it("is callable through ireland_call at the server surface", async () => {
    const client = await connectClient(createAppServer(createContext({ fetch: fakeFetch(routes) })));
    const result = await client.callTool({
      name: "ireland_call",
      arguments: { source: "bikes", operation: "bikes_stations_near", args: { lat: 53.3498, lon: -6.2603, radius: 1000, network: "dublinbikes" } }
    });
    expect(result.isError).toBeFalsy();
    const body = parseToolText<any>(result as { content: Array<{ type: string; text?: string }> }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body.operation).toBe("bikes_stations_near");
    expect(body.data.stations[0].network_id).toBe("dublinbikes");
    await client.close();
  });
});
