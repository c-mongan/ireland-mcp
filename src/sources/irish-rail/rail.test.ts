import { describe, expect, it } from "vitest";
import { fakeFetch, type Route } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { irishRailModule as mod } from "./index.js";

const f = (name: string) => fixturePath(import.meta.url, name);
const routes: Route[] = [
  { match: /realtime\.asmx\/getAllStationsXML$/, file: f("stations.xml") },
  { match: /getStationDataByCodeXML_WithNumMins\?StationCode=PERSE&NumMins=60$/, file: f("pearse.xml") }
];

describe("Irish Rail module", () => {
  it("finds stations by name or alias", async () => {
    const { ok, body } = await callTool(mod, "rail_find_station", { query: "pearse" }, fakeFetch(routes));
    expect(ok).toBe(true);
    expect(body.data.stations[0]).toEqual({ name: "Dublin Pearse", alias: "Pearse", code: "PERSE", lat: 53.3433, lon: -6.24829 });
    expect(body.attribution).toContain("Iarnród Éireann");
  });

  it("returns live departures for a station name, earliest first", async () => {
    const { ok, body } = await callTool(mod, "rail_get_departures", { station: "Dublin Pearse", minutes: 60 }, fakeFetch(routes));
    expect(ok).toBe(true);
    expect(body.data.station).toEqual({ name: "Dublin Pearse", code: "PERSE" });
    const first = body.data.departures[0];
    expect(first).toEqual({
      train_code: "E122",
      type: "DART",
      origin: "Malahide",
      destination: "Greystones",
      direction: "Southbound",
      due_in_min: 3,
      late_min: -3,
      scheduled_departure: "16:57",
      expected_departure: "16:54",
      status: "En Route",
      last_location: "Arrived Dublin Connolly"
    });
    expect(body.data.count).toBe(21);
    const due = body.data.departures.map((d: { due_in_min: number }) => d.due_in_min);
    expect(due).toEqual([...due].sort((a, b) => a - b));
  });

  it("rejects an unknown station with a hint", async () => {
    const { ok, body } = await callTool(mod, "rail_get_departures", { station: "Atlantis Central" }, fakeFetch(routes));
    expect(ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.hint).toContain("rail_find_station");
  });
});
