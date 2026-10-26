import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { callTool } from "../../test/helpers/callTool.js";
import { fakeFetch } from "../../test/helpers/fakeFetch.js";
import type { SourceModule } from "../gateway/module.js";
import { crosswalkMeta, dublinDistrictEds, edById, findEntities, listChildren, loadCrosswalk, profileEntity } from "./crosswalk.js";
import { councilAliases, DUBLIN_DISTRICTS, dublinDistrict, foldName, placeKey, routingKey, splitQualifier } from "./names.js";
import { codesForEd, crosswalkInfo, resolvePlaceTool } from "./resolvePlace.js";

const FILE = new URL("../../web/data/crosswalk/places-2022.json", import.meta.url);
const mod: SourceModule = { info: crosswalkInfo, summary: "test", tools: [resolvePlaceTool] };
const offline = () => fakeFetch([]);
const resolve = (args: Record<string, unknown>, fetch = offline()) => callTool(mod, "ireland_resolve_place", args, fetch);
const features = (attributes: Record<string, unknown>[]) => JSON.stringify({ features: attributes.map((a) => ({ attributes: a })) });

describe("place names", () => {
  it("folds diacritics, county prefixes, seat counts and LEA suffixes", () => {
    expect(foldName("Dún Laoghaire")).toBe("dun laoghaire");
    expect(placeKey("Co. Donegal")).toBe("donegal");
    expect(placeKey("County Mayo")).toBe("mayo");
    expect(placeKey("Galway West (5)")).toBe("galway west");
    expect(placeKey("ATHENRY-ORANMORE LEA-7")).toBe("athenry oranmore");
    expect(placeKey("Raheny-St. Assam")).toBe(placeKey("Raheny-Saint Assam"));
    expect(splitQualifier("Athenry-Oranmore, Galway County")).toEqual({ name: "Athenry-Oranmore", qualifier: "Galway County" });
    expect(councilAliases("Limerick City and County Council")).toEqual(expect.arrayContaining(["Limerick City and County", "Limerick"]));
    expect(councilAliases("Galway County Council")).not.toContain("Galway");
  });

  it("recognises Dublin postal districts and Eircode routing keys", () => {
    expect(dublinDistrict("Dublin 8")).toBe("D08");
    expect(dublinDistrict("D8")).toBe("D08");
    expect(dublinDistrict("dublin 6w")).toBe("D6W");
    expect(dublinDistrict("Dublin 19")).toBeNull();
    expect(routingKey("H91")).toBe("H91");
    expect(routingKey("H91 X2Y3")).toBe("H91");
    expect(routingKey("B12")).toBeNull();
  });
});

describe("packaged crosswalk", () => {
  const raw = JSON.parse(readFileSync(FILE, "utf8"));

  it("covers every level with the official counts and Census 2022 population", () => {
    expect(raw.counties).toHaveLength(26);
    expect(raw.provinces).toHaveLength(4);
    expect(raw.local_authorities).toHaveLength(31);
    expect(raw.leas).toHaveLength(166);
    expect(raw.constituencies).toHaveLength(43);
    expect(raw.nuts3).toHaveLength(8);
    expect(raw.eds).toHaveLength(raw.quality.ed_count);
    expect(raw.eds.reduce((s: number, e: number[]) => s + (e[6] as number), 0)).toBe(5_149_139);
    expect(raw.leas.reduce((s: number, l: { seats: number }) => s + l.seats, 0)).toBe(949);
    expect(raw.constituencies.reduce((s: number, c: { seats: number }) => s + c.seats, 0)).toBe(174);
    expect(raw.sources.every((s: { licence: string; attributes_sha256: string }) => s.licence === "CC BY 4.0" && /^[0-9a-f]{64}$/.test(s.attributes_sha256))).toBe(true);
    expect(raw.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("keeps every ED's shares summing to one and stays small", () => {
    for (const e of raw.eds) {
      for (const col of [4, 8]) expect(Math.abs(e[col].reduce((s: number, pair: number[]) => s + (pair[1] ?? 0), 0) - 1)).toBeLessThan(0.01);
    }
    expect(statSync(FILE).size).toBeLessThan(500_000);
  });

  it("reports the file checksum and vintages", () => {
    const meta = crosswalkMeta();
    expect(meta.file_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.vintages.dail_constituency).toMatch(/2023/);
    expect(loadCrosswalk().parts.length).toBeGreaterThanOrEqual(raw.eds.length);
  });

  it("matches every Dublin postal district stem to at least one Dublin ED", () => {
    for (const district of Object.keys(DUBLIN_DISTRICTS)) expect(dublinDistrictEds(district).length, district).toBeGreaterThan(0);
    expect(dublinDistrictEds("D08").map((e) => e.name)).toEqual(expect.arrayContaining(["Ushers A", "Merchants Quay A"]));
  });
});

describe("crosswalk lookups", () => {
  it("resolves names at every level, best level first", () => {
    expect(findEntities("Co. Galway")[0]).toMatchObject({ level: "county", name: "Galway" });
    expect(findEntities("Galway City")[0]).toMatchObject({ level: "local_authority", name: "Galway City Council" });
    expect(findEntities("Dun Laoghaire-Rathdown")[0]).toMatchObject({ level: "local_authority", name: "Dún Laoghaire-Rathdown County Council" });
    expect(findEntities("Galway West (5)")[0]).toMatchObject({ level: "constituency", seats: 5 });
    expect(findEntities("Athenry-Oranmore, Galway County")[0]).toMatchObject({ level: "lea", name: "Athenry-Oranmore" });
    expect(findEntities("IE042")[0]).toMatchObject({ level: "nuts3", name: "West" });
    expect(findEntities("Munster")[0]).toMatchObject({ level: "province" });
    expect(findEntities("Gaillimh")[0]).toMatchObject({ level: "county", name: "Galway" });
    expect(findEntities("268015")[0]).toMatchObject({ level: "ed", name: "Ballymun A" });
  });

  it("keeps same-named LEAs apart and narrows them with a qualifier", () => {
    const athlone = findEntities("Athlone", "lea");
    expect(athlone).toHaveLength(2);
    expect(findEntities("Athlone, Roscommon", "lea")).toHaveLength(1);
    expect(profileEntity(findEntities("Athlone, Roscommon", "lea")[0]!).codes.county![0]!.name).toBe("Roscommon");
  });

  it("profiles a council with its county, province, NUTS3 and overlapping constituencies", () => {
    const p = profileEntity(findEntities("Galway City Council")[0]!);
    expect(p.codes.county).toEqual([{ name: "Galway", share: 1 }]);
    expect(p.codes.province).toEqual([{ name: "Connacht", share: 1 }]);
    expect(p.codes.nuts3).toEqual([{ name: "West", code: "IE042", share: 1 }]);
    expect(p.codes.constituency!.map((c) => c.name)).toEqual(["Galway West"]);
    expect(p.codes.lea!.map((c) => c.name).sort()).toEqual(["Galway City Central", "Galway City East", "Galway City West"]);
    expect(p.population_2022).toBeGreaterThan(80_000);
  });

  it("lists the EDs of a council with their LEA and constituency", () => {
    const eds = listChildren(findEntities("Galway City Council")[0]!, "ed");
    expect(eds.length).toBe(22);
    expect(eds[0]).toMatchObject({ local_authority: "Galway City Council", constituency: "Galway West", share_inside: 1 });
    const munster = listChildren(findEntities("Munster")[0]!, "local_authority").map((r) => r.name);
    expect(munster).toEqual(expect.arrayContaining(["Cork City Council", "Kerry County Council", "Tipperary County Council"]));
    expect(munster).toHaveLength(7);
  });

  it("shows population shares where an ED straddles constituencies", () => {
    const park = profileEntity(edById("268118")!);
    expect(park.codes.constituency!.length).toBe(2);
    expect(park.codes.constituency!.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 2);
  });

  it("builds compact codes for the nearby and snapshot tools", () => {
    expect(codesForEd("268106")).toMatchObject({ ed: { id: "268106", name: "North City" }, lea: "North Inner City", dail_constituency: "Dublin Central", county: "Dublin", nuts3: "IE061 Dublin" });
    expect(codesForEd("nope")).toBeUndefined();
    // GeoHive's pre-2022 id for Douglas now names only the Cork County remainder; a Cork City point must not get it.
    expect(codesForEd("047132", "Cork County Council")).toBeTruthy();
    expect(codesForEd("047132", "Cork City Council")).toBeUndefined();
  });
});

describe("ireland_resolve_place", () => {
  it("resolves a council and lists its EDs offline", async () => {
    const fetch = offline();
    const { ok, body } = await resolve({ place: "Galway City Council", list: "ed", limit: 5 }, fetch);
    expect(ok).toBe(true);
    expect(fetch.calls).toHaveLength(0);
    expect(body.data.place).toMatchObject({ level: "local_authority", name: "Galway City Council" });
    expect(body.data.children).toMatchObject({ level: "ed", total: 22, count: 5, next_offset: 5 });
    expect(body.truncated).toBe(true);
    expect(body.licence).toBe("CC BY 4.0");
    expect(body.attribution).toMatch(/CSO.*Tailte Éireann/);
    expect(body.data.not_covered).toMatch(/Garda/);
  });

  it("lists other matches for ambiguous names", async () => {
    const { body } = await resolve({ place: "Athlone" });
    expect(body.data.place.level).toBe("lea");
    expect(body.data.other_matches.length).toBeGreaterThan(0);
  });

  it("maps a Dublin postal district to EDs, flagged approximate", async () => {
    const { body } = await resolve({ place: "Dublin 8" });
    expect(body.data.match).toMatchObject({ via: "dublin_postal_district", district: "D08", approximate: true });
    expect(body.data.codes.local_authority[0].name).toBe("Dublin City Council");
  });

  it("explains that Eircode routing keys are not mapped", async () => {
    const { ok, body } = await resolve({ place: "H91" });
    expect(ok).toBe(false);
    expect(body.error.message).toMatch(/routing key/);
  });

  it("resolves a point through the Census small-area layer", async () => {
    const fetch = fakeFetch([
      { match: (url) => url.includes("SMALL_AREA_2022") && url.includes("geometry=-6.2603"), body: features([{ SA_PUB2022: "268106016", SA_GEOGID_2022: "A268106016", ED_ENGLISH: "NORTH CITY", ED_ID_STR: "268106" }]) },
      { match: (url) => url.includes("CensusHub2022_T1_1_SA"), body: features([{ SA_GEOGID_2022: "A268106016", T1_1AGETT: 300 }]) }
    ]);
    const { ok, body } = await resolve({ lat: 53.3498, lon: -6.2603 }, fetch);
    expect(ok).toBe(true);
    expect(body.data.small_area).toMatchObject({ code: "268106016", population_2022: 300 });
    expect(body.data.place).toMatchObject({ level: "ed", code: "268106" });
    expect(body.data.codes.constituency[0].name).toBe("Dublin Central");
  });

  it("falls back to the gazetteer for towns and neighbourhoods, filtered by county", async () => {
    const fetch = fakeFetch([
      {
        match: (url) => url.includes("Centres_of_Population") && url.includes("BALLYBANE"),
        body: JSON.stringify({ features: [{ attributes: { English_Na: "Ballybane", Irish_Name: "Baile Bán", County: "GALWAY", Classifica: "CoP" }, geometry: { x: -9.0, y: 53.28 } }] })
      },
      { match: (url) => url.includes("SMALL_AREA_2022") && url.includes("geometry=-9"), body: features([{ SA_PUB2022: "068001001", SA_GEOGID_2022: "A068001001", ED_ID_STR: "068001" }]) },
      { match: (url) => url.includes("CensusHub2022_T1_1_SA"), body: features([{ SA_GEOGID_2022: "A068001001", T1_1AGETT: 250 }]) }
    ]);
    const { ok, body } = await resolve({ place: "Ballybane, Galway" }, fetch);
    expect(ok).toBe(true);
    expect(body.data.match).toMatchObject({ via: "gazetteer_point", approximate: true });
    expect(body.data.codes.lea[0].name).toBe("Galway City East");
  });

  it("resolves split and merged small-area codes without rewriting them", async () => {
    const fetch = fakeFetch([
      { match: (url) => url.includes("SMALL_AREA_2022") && decodeURIComponent(url).includes("'267065001/02'"), body: features([{ SA_PUB2022: "267065001/02", SA_GEOGID_2022: "A267065001/02", ED_ID_STR: "268106" }]) }
    ]);
    const { ok, body } = await resolve({ place: "267065001/02" }, fetch);
    expect(ok).toBe(true);
    expect(body.data.match.via).toBe("small_area_code");
    expect(body.data.small_area.code).toBe("267065001/02");
  });

  it("accepts a council as the qualifier for a gazetteer town", async () => {
    const fetch = fakeFetch([
      {
        match: (url) => url.includes("Centres_of_Population") && url.includes("MALAHIDE"),
        body: JSON.stringify({ features: [{ attributes: { English_Na: "Malahide", Irish_Name: "Mullach Íde", County: "DUBLIN", Classifica: "CoP" }, geometry: { x: -6.15, y: 53.45 } }] })
      },
      { match: (url) => url.includes("SMALL_AREA_2022"), body: features([{ SA_PUB2022: "267105001", SA_GEOGID_2022: "A267105001", ED_ID_STR: "267105" }]) },
      { match: (url) => url.includes("CensusHub2022_T1_1_SA"), body: features([{ SA_GEOGID_2022: "A267105001", T1_1AGETT: 200 }]) }
    ]);
    const ok = await resolve({ place: "Malahide, Fingal" }, fetch);
    expect(ok.body.data.match.gazetteer).toMatchObject({ name: "Malahide", county: "Dublin" });
    expect(ok.body.data.codes.local_authority[0].name).toBe("Fingal County Council");
    const wrong = await resolve({ place: "Malahide, Kerry" }, fetch);
    expect(wrong.body.error.message).toMatch(/in the gazetteer, but not in Kerry/);
  });

  it("rejects bad combinations", async () => {
    expect((await resolve({ lat: 53.3 })).body.error.code).toBe("BAD_ARGS");
    expect((await resolve({})).body.error.code).toBe("BAD_ARGS");
    expect((await resolve({ place: "Galway City Council", list: "local_authority" })).body.error.code).toBe("BAD_ARGS");
    expect((await resolve({ place: "Nowhere Special", level: "lea" })).body.error.code).toBe("NOT_FOUND");
  });
});
