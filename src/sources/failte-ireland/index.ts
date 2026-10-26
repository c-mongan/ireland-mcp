import { createHash } from "node:crypto";
import { z } from "zod";
import { DAY } from "../../gateway/context.js";
import { envelope, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule } from "../../gateway/module.js";
import { csvRows, MAX_EXPORT_BYTES } from "../kohesio/export.js";

export const failteIrelandInfo: SourceInfo = {
  id: "failte-ireland", name: "Fáilte Ireland", licence: "CC BY 4.0",
  attribution: "Contains Fáilte Ireland open data licensed under Creative Commons Attribution 4.0. Listings are not a complete inventory of tourism businesses.",
  homepage: "https://www.failteireland.ie/en/info/open-data"
};
const BASE = "https://failteireland.azure-api.net/opendata-api/v2";
const text = (v: string | undefined) => v?.trim() || null;
function number(v: string | undefined, min: number, max: number): number | null {
  if (!v?.trim()) return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v.trim())) return invalid();
  const n = Number(v);
  if (max === Number.MAX_SAFE_INTEGER && !Number.isSafeInteger(n)) return invalid();
  if (!Number.isFinite(n) || n < min || n > max) return invalid();
  return n;
}
const fold = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
const invalid = (): never => { throw new ToolError("UPSTREAM_DOWN", "Fáilte Ireland returned an invalid CSV export.", { retryable: false }); };

function records(csv: string, dataset: "accommodation" | "attractions") {
  let rows: string[][];
  try { rows = csvRows(csv); } catch { return invalid(); }
  const [header, ...body] = rows;
  const required = dataset === "accommodation" ? ["Sector","Property Reg Number","Account Name","Rating","Address Line 1","Address City/Town","Address County","Eircode/Postal code","Latitude","Longitude","Total Units"] : ["Name","Url","Telephone","Latitude","Longitude","Address","County","Photo","Tags"];
  if (!header || !body.length || new Set(header).size !== header.length || required.some((key) => !header.includes(key))) return invalid();
  return body.map((values) => {
    if (values.length !== header.length) return invalid();
    const r = Object.fromEntries(header.map((key, i) => [key, values[i]]));
    if (!text(r[dataset === "attractions" ? "Name" : "Account Name"])) return invalid();
    if (dataset === "attractions") return {name:text(r.Name),url:text(r.Url),telephone:text(r.Telephone),latitude:number(r.Latitude,-90,90),longitude:number(r.Longitude,-180,180),address:text(r.Address),county:text(r.County),photo:text(r.Photo),category:text(r.Tags)};
    return {name: text(r["Account Name"]), county: text(r["Address County"]), category: text(r.Sector), registration_number: text(r["Property Reg Number"]), rating: text(r.Rating), address: text(r["Address Line 1"]), town: text(r["Address City/Town"]), eircode: text(r["Eircode/Postal code"]), latitude: number(r.Latitude,-90,90), longitude: number(r.Longitude,-180,180), total_units: number(r["Total Units"],0,Number.MAX_SAFE_INTEGER)};
  });
}
export const failteIreland: SourceModule = {
  info: failteIrelandInfo, domain: "places/property",
  summary: "Search Fáilte Ireland accommodation and tourism activity/attraction CSV listings by name, county and category; no API key.",
  coverage: "Published Fáilte Ireland CSV listings. Accommodation register and listed tourism businesses, not all businesses. Retrieval time is not a source update date; availability and opening hours are not supplied. The publisher's API has a shared bandwidth quota: when it is used up, the tool serves an earlier export flagged stale or returns RATE_LIMITED.",
  tools: [defineTool({
    name: "failte_search", title: "Search Fáilte Ireland listings",
    description: "Search public accommodation or attractions/activity CSV listings. query matches names; county is exact ignoring case/accents; category matches sector or tags. Does not provide availability, opening hours, or a complete business inventory.",
    inputSchema: {dataset: z.enum(["accommodation", "attractions"]), query: z.string().trim().min(1).max(200).optional(), county: z.string().trim().min(1).max(100).optional(), category: z.string().trim().min(1).max(100).optional(), limit: z.number().int().min(1).max(100).default(20)},
    example: {dataset:"accommodation",county:"Galway",limit:10},
    async handler(args, ctx) {
      const url = `${BASE}/${args.dataset}/csv`;
      // The publisher's API has a shared daily bandwidth quota, so the full export is cached for a day.
      // When the quota is used up, an earlier copy is served flagged stale.
      const r = await ctx.cache.getOrLoad(`failte-ireland:csv:v1:${args.dataset}`, DAY, async () => {
        const bytes = await ctx.http.bytes(url, {maxBytes: MAX_EXPORT_BYTES, label:"Fáilte Ireland CSV",headers:{accept:"text/csv"},detectQuota:true});
        let csv: string;
        try { csv = new TextDecoder("utf-8", {fatal:true}).decode(bytes); } catch { return invalid(); }
        return {records: records(csv,args.dataset), sha256: createHash("sha256").update(bytes).digest("hex"), retrieved_at:ctx.now().toISOString()};
      });
      const matches = r.value.records.filter((row) => (!args.query || fold(row.name ?? "").includes(fold(args.query))) && (!args.county || fold(row.county ?? "") === fold(args.county)) && (!args.category || fold(row.category ?? "").includes(fold(args.category))));
      return envelope(failteIrelandInfo, {url,cached:r.cached,stale:r.stale,retrievedAt:new Date(r.value.retrieved_at),truncated: matches.length > args.limit,data:{dataset:args.dataset,records:matches.slice(0,args.limit),total:matches.length,export_rows:r.value.records.length,export_sha256:r.value.sha256,export_retrieved_at:r.value.retrieved_at,source_updated_at:null}});
    }
  })]
};
