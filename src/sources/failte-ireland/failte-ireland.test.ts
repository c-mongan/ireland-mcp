import { createHash } from "node:crypto";
import { createContext, HOUR } from "../../gateway/context.js";
import { describe, expect, it } from "vitest";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { fakeFetch } from "../../../test/helpers/fakeFetch.js";
import { failteIreland } from "./index.js";

const accommodation = '"Sector","Property Reg Number","Account Name","Rating","Address Line 1","Address City/Town","Address County","Eircode/Postal code","Latitude","Longitude","Owner(s) as it appears on Register","Total Units","Proprietor Description"\r\n"Hotel","H1","Harbour Hotel","4 Star","Quay","Galway","Galway","H91 ABCD","53.27","-9.05","Owner","12",""\r\n"Hotel","H2","Other Hotel","3 Star","Street","Cork","Cork","T12 ABCD",,,"Owner","5",""\r\n';

const attractions = '\uFEFF"Name","Url","Telephone","Latitude","Longitude","Address","County","Photo","Tags"\r\n"Museum, ""Old"" Mill","https://example.ie","0035311","53.3","-6.2","First line\nSecond line","Dublin",,"Attraction,Museum"\r\n"Museum Two",,,,,"Street","Dublin",,"Museum"\r\n';

describe("Fáilte Ireland public CSV", () => {
  it("searches accommodation by name and county with public source evidence", async () => {
    const fetch = fakeFetch([{ match: /^https:\/\/failteireland.azure-api.net\/opendata-api\/v2\/accommodation\/csv$/, body: accommodation }]);
    const r = await callTool<{data: {records: unknown[]; total: number}; licence: string; url: string}>(failteIreland, "failte_search", { dataset: "accommodation", query: "harbour", county: "Galway" }, fetch);
    expect(r.ok).toBe(true);
    expect(r.body.data.records).toEqual([{name:"Harbour Hotel",county:"Galway",category:"Hotel",registration_number:"H1",rating:"4 Star",address:"Quay",town:"Galway",eircode:"H91 ABCD",latitude:53.27,longitude:-9.05,total_units:12}]);
    expect(r.body.data.total).toBe(1);
    expect(r.body.licence).toBe("CC BY 4.0");
    expect(r.body.url).toContain("/accommodation/csv");
    expect(fetch.calls[0]?.init?.headers).not.toHaveProperty("Ocp-Apim-Subscription-Key");
  });
  it("searches attraction tags, retains CSV quoting and missing coordinates, and marks limited results", async () => {
    const fetch = fakeFetch([{match: /\/attractions\/csv$/, body: attractions}]);
    const r = await callTool(failteIreland, "failte_search", {dataset:"attractions", county:"dublin",category:"museum",limit:1}, fetch);
    expect(r.ok).toBe(true);
    expect(r.body.data.records).toEqual([{name:'Museum, "Old" Mill',url:"https://example.ie",telephone:"0035311",latitude:53.3,longitude:-6.2,address:"First line\nSecond line",county:"Dublin",photo:null,category:"Attraction,Museum"}]);
    expect(r.body.data.total).toBe(2);
    expect(r.body.truncated).toBe(true);
    const all = await callTool(failteIreland, "failte_search", {dataset:"attractions"}, fetch);
    expect(all.body.data.records[1].latitude).toBeNull();
  });
  it.each([
    '<html>Service unavailable</html>',
    accommodation.replace('"Sector"','"Wrong"'),
    accommodation.replace('"Hotel","H1"','"Hotel"'),
    accommodation + '"unterminated',
    accommodation.replace('"53.27"','"NaN"'),
  ])("rejects malformed exports without presenting partial results", async (body) => {
    const r = await callTool(failteIreland,"failte_search",{dataset:"accommodation"},fakeFetch([{match:/\/accommodation\/csv$/,body}]));
    expect(r.ok).toBe(false);
    expect(r.body.error.code).toBe("UPSTREAM_DOWN");
  });
  it("keeps the original CSV byte checksum and retrieval time on cached results", async () => {
    let now = new Date("2026-10-13T12:00:00Z");
    const fetch = fakeFetch([{match:/\/attractions\/csv$/,body:attractions}]);
    const ctx = createContext({fetch,now:()=>now});
    const first = await callTool(failteIreland,"failte_search",{dataset:"attractions"},ctx);
    expect(first.body.data.export_sha256).toBe(createHash("sha256").update(attractions).digest("hex"));
    now = new Date("2026-10-13T12:30:00Z");
    const second = await callTool(failteIreland,"failte_search",{dataset:"attractions"},ctx);
    expect(second.body.cached).toBe(true);
    expect(second.body.retrieved_at).toBe("2026-10-13T12:00:00.000Z");
    expect(fetch.calls).toHaveLength(1);
  });
  it("returns the dated official fixture without inferring missing coordinates", async () => {
    const r = await callTool(failteIreland,"failte_search",{dataset:"accommodation",county:"Mayo"},fakeFetch([{match:/\/accommodation\/csv$/,file:fixturePath(import.meta.url,"accommodation.csv")} ]));
    expect(r.ok).toBe(true);
    expect(r.body.data.records[0]).toMatchObject({name:"The Glamping Village at Westport Estate",county:"Mayo",latitude:null,longitude:null,total_units:19});
  });
  it.each([
    'x'.repeat(5 * 1024 * 1024 + 1),
    accommodation.split('\r\n')[0] + '\r\n' + (accommodation.split('\r\n')[1] + '\r\n').repeat(10001),
    accommodation.replace('"53.27"','"91"'),
    accommodation.replace('"12"','"1.5"'),
  ])("enforces export and numerical bounds", async (body) => {
    const r = await callTool(failteIreland,"failte_search",{dataset:"accommodation"},fakeFetch([{match:/\/accommodation\/csv$/,body}]));
    expect(r.ok).toBe(false);
  });
  it("does not cache malformed exports and reports a stale valid snapshot on outage", async () => {
    let now = new Date("2026-10-13T12:00:00Z");
    let state = 0;
    const ctx = createContext({now:()=>now,fetch:async()=> state++ === 0 ? new Response("<html>bad</html>") : state === 2 ? new Response(accommodation) : new Response("Unavailable",{status:503})});
    expect((await callTool(failteIreland,"failte_search",{dataset:"accommodation"},ctx)).ok).toBe(false);
    const valid = await callTool(failteIreland,"failte_search",{dataset:"accommodation"},ctx);
    expect(valid.ok).toBe(true);
    expect(valid.body.cached).toBe(false);
    now = new Date(now.getTime() + HOUR + 1);
    const stale = await callTool(failteIreland,"failte_search",{dataset:"accommodation"},ctx);
    expect(stale.ok).toBe(true);
    expect(stale.body.stale).toBe(true);
    expect(stale.body.retrieved_at).toBe("2026-10-13T12:00:00.000Z");
  });
  it("rejects header-only exports while allowing empty filtered results", async () => {
    const empty = await callTool(failteIreland,"failte_search",{dataset:"accommodation"},fakeFetch([{match:/\/accommodation\/csv$/,body:accommodation.split('\r\n')[0] + '\r\n'}]));
    expect(empty.ok).toBe(false);
    expect(empty.body.error.code).toBe("UPSTREAM_DOWN");
    const noMatch = await callTool(failteIreland,"failte_search",{dataset:"accommodation",county:"Kerry"},fakeFetch([{match:/\/accommodation\/csv$/,body:accommodation}]));
    expect(noMatch.ok).toBe(true);
    expect(noMatch.body.data.records).toEqual([]);
  });
  it("reports invalid UTF-8 as a safe source error", async () => {
    const result = await callTool(failteIreland,"failte_search",{dataset:"accommodation"},fakeFetch([{match:/\/accommodation\/csv$/,body:new Uint8Array([0xff,0xfe,0xff])}]));
    expect(result.ok).toBe(false);
    expect(result.body.error).toMatchObject({code:"UPSTREAM_DOWN",message:"Fáilte Ireland returned an invalid CSV export."});
  });
});
