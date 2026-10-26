import { describe, expect, it } from "vitest";
import { dimensionLevels, geoIntent, mergeResults, rankByLevel } from "./geoRank.js";

const table = (code: string, title: string, dims: string[]) => ({ MtrCode: code, MtrTitle: title, classification: dims.map((d, i) => ({ ClsCode: `C${i}`, ClsValue: d })) });

describe("CSO geography ranking", () => {
  it("maps CSO dimension names to geography levels", () => {
    expect(dimensionLevels("Local Electoral Area 2019")).toEqual(["lea"]);
    expect(dimensionLevels("CSO Local Electoral Areas 2022")).toEqual(["lea"]);
    expect(dimensionLevels("CSO Electoral Divisions 2022")).toEqual(["ed"]);
    expect(dimensionLevels("CSO Small Areas 2022")).toEqual(["small_area"]);
    expect(dimensionLevels("Administrative Counties")).toEqual(["local_authority"]);
    expect(dimensionLevels("Administrative Counties and Local Government Districts")).toEqual(["local_authority"]);
    expect(dimensionLevels("Local Authority Area")).toEqual(["local_authority"]);
    expect(dimensionLevels("County of Residence of Deceased")).toEqual(["county"]);
    expect(dimensionLevels("NUTS 3 Region")).toEqual(["nuts3"]);
    expect(dimensionLevels("County, Rural/Urban District, District Electoral Division and Town")).toEqual(["ed", "county", "town"]);
    expect(dimensionLevels("Sex")).toEqual([]);
  });

  it("detects the level a query asks for and strips it from the topic words", () => {
    expect(geoIntent("completions LEA")).toEqual({ level: "lea", core: "completions" });
    expect(geoIntent("population by local authority")).toEqual({ level: "local_authority", core: "population" });
    expect(geoIntent("population council")).toEqual({ level: "local_authority", core: "population" });
    expect(geoIntent("deprivation electoral divisions")).toEqual({ level: "ed", core: "deprivation" });
    expect(geoIntent("population county")).toEqual({ level: "county", core: "population" });
    expect(geoIntent("house prices")).toEqual({ level: undefined, core: "house prices" });
    expect(geoIntent("LEA")).toEqual({ level: "lea", core: "LEA" });
    expect(geoIntent("Ukraine", "lea")).toEqual({ level: "lea", core: "ukraine" });
    expect(geoIntent("leasing")).toEqual({ level: undefined, core: "leasing" });
  });

  it("ranks the requested level first, then related levels, then headline tables", () => {
    const results = [
      table("A", "Population Aged 15 Years and Over", ["Sex", "Administrative Counties", "Age Group"]),
      table("B", "Deaths Registered", ["County of Residence", "Sex"]),
      table("C", "Population", ["Sex", "Administrative Counties"]),
      table("D", "Population", ["NUTS 3 Region"])
    ];
    expect(rankByLevel(results, "local_authority", "population").map((t) => t.MtrCode)).toEqual(["C", "A", "B", "D"]);
    expect(rankByLevel(results, "county", "population").map((t) => t.MtrCode)).toEqual(["B", "C", "A", "D"]);
  });

  it("merges result lists without duplicates", () => {
    const a = [table("X", "x", []), table("Y", "y", [])];
    const b = [table("Y", "y", []), table("Z", "z", [])];
    expect(mergeResults([a, b]).map((t) => t.MtrCode)).toEqual(["X", "Y", "Z"]);
  });
});
