import { describe, expect, it } from "vitest";
import { fakeFetch, softErrorOnce, type Route } from "../../../test/helpers/fakeFetch.js";
import { createContext } from "../../gateway/context.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { luasModule as mod } from "./index.js";

const f = (name: string) => fixturePath(import.meta.url, name);
const routes: Route[] = [
  { match: /get\.ashx\?action=stops&encrypt=false$/, file: f("stops.xml") },
  { match: /get\.ashx\?action=forecast&stop=STS&encrypt=false$/, file: f("forecast-sts.xml") },
  { match: /get\.ashx\?action=forecast&stop=TPT&encrypt=false$/, file: f("forecast-tpt.xml") }
];

describe("Luas module", () => {
  it("returns forecasts by stop name with service messages", async () => {
    const { ok, body } = await callTool(mod, "luas_get_forecast", { stop: "stephens green" }, fakeFetch(routes));
    expect(ok).toBe(true);
    expect(body.data.stop).toEqual({ name: "St. Stephen's Green", code: "STS", line: "Green" });
    expect(body.data.message).toBe("No trams stopping at Marlborough see news");
    expect(body.data.inbound[0]).toEqual({ destination: "Parnell", due_in_min: 0 });
    expect(body.data.inbound[1]).toEqual({ destination: "Broombridge", due_in_min: 3 });
    expect(body.data.outbound[0]).toEqual({ destination: "Brides Glen", due_in_min: 1 });
    expect(body.attribution).toContain("Transport Infrastructure Ireland");
  });

  it("drops trams with no due time instead of reporting them as due now", async () => {
    const { body } = await callTool(mod, "luas_get_forecast", { stop: "TPT" }, fakeFetch(routes));
    expect(body.data.inbound).toEqual([]);
    expect(body.data.outbound).toEqual([{ destination: "Saggart", due_in_min: 12 }]);
  });

  it("lists stops filtered by line", async () => {
    const { body } = await callTool(mod, "luas_list_stops", { line: "Red" }, fakeFetch(routes));
    expect(body.data.stops[0]).toMatchObject({ name: "The Point", code: "TPT", line: "Red" });
    expect(body.data.stops.every((s: { line: string }) => s.line === "Red")).toBe(true);
  });

  it("rejects an unknown stop with a hint", async () => {
    const { ok, body } = await callTool(mod, "luas_get_forecast", { stop: "Atlantis" }, fakeFetch(routes));
    expect(ok).toBe(false);
    expect(body.error.hint).toContain("luas_list_stops");
  });

  it.each([
    ["stop list", /action=stops&/],
    ["forecast", /action=forecast&stop=STS&/]
  ])("does not cache a malformed %s body", async (_, match) => {
    const fetch = softErrorOnce(routes, match);
    const ctx = createContext({ fetch });
    const first = await callTool(mod, "luas_get_forecast", { stop: "STS" }, ctx);
    expect(first.ok).toBe(false);
    expect(first.body.error.code).toBe("UPSTREAM_DOWN");
    const second = await callTool(mod, "luas_get_forecast", { stop: "STS" }, ctx);
    expect(second.ok).toBe(true);
    expect(fetch.calls.filter((c) => match.test(c.url))).toHaveLength(2);
  });
});
