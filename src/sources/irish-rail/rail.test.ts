import { describe, expect, it } from "vitest";
import { fakeFetch, type Route } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { irishRailModule as mod } from "./index.js";

const f = (name: string) => fixturePath(import.meta.url, name);
const routes: Route[] = [
  { match: /realtime\.asmx\/getAllStationsXML$/, file: f("stations.xml") },
  { match: /getStationDataByCodeXML_WithNumMins\?StationCode=PERSE&NumMins=60$/, file: f("pearse.xml") }
];

const unknownDue = `<?xml version="1.0" encoding="utf-8"?><ArrayOfObjStationData xmlns="http://api.irishrail.ie/realtime/"><objStationData><Traincode>P999 </Traincode><Origin>Portlaoise</Origin><Destination>Heuston</Destination><Duein></Duein><Late>0</Late><Traintype>Train</Traintype></objStationData></ArrayOfObjStationData>`;
const adamstown: Route[] = [
  routes[0]!,
  { match: /StationCode=ADAMS&/, file: f("pearse.xml") },
  { match: /StationCode=ADAMF&/, body: unknownDue },
  { match: /StationCode=ADMTN&/, file: f("pearse.xml") }
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
    expect(body.data.station).toEqual({ name: "Dublin Pearse", code: "PERSE", codes: ["PERSE"] });
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

  it("merges every code that shares a station name, dedupes trains and keeps unknown due times last", async () => {
    const fetch = fakeFetch(adamstown);
    const { ok, body } = await callTool(mod, "rail_get_departures", { station: "Adamstown" }, fetch);
    expect(ok).toBe(true);
    expect(body.data.station).toEqual({ name: "Adamstown", code: "ADAMS", codes: ["ADAMS", "ADAMF", "ADMTN"] });
    expect(fetch.calls.filter((c) => c.url.includes("StationCode=")).length).toBe(3);
    expect(body.data.count).toBe(22);
    expect(body.data.departures.at(-1)).toMatchObject({ train_code: "P999", due_in_min: null });
  });

  it("rejects an unknown station with a hint", async () => {
    const { ok, body } = await callTool(mod, "rail_get_departures", { station: "Atlantis Central" }, fakeFetch(routes));
    expect(ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.hint).toContain("rail_find_station");
  });
});
