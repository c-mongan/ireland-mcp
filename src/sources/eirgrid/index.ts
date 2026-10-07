import { z } from "zod";
import { MINUTE } from "../../gateway/context.js";
import { envelope, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule } from "../../gateway/module.js";

export const eirgridInfo: SourceInfo = {
  id: "eirgrid",
  name: "EirGrid Smart Grid Dashboard",
  licence: "Public information; attribution required (EirGrid disclaimer)",
  attribution:
    "Source: EirGrid Smart Grid Dashboard (smartgriddashboard.com). Real-time data is provisional, provided as-is for information only.",
  homepage: "https://www.smartgriddashboard.com/"
};

export const EIRGRID_BASE = "https://www.smartgriddashboard.com/api/chart/";

interface Row {
  EffectiveTime: string;
  FieldName: string;
  Region: string;
  Value: number | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Today's date in Irish local time, formatted as the dashboard expects (DD-Mon-YYYY). */
export function dublinDate(now = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", year: "numeric", month: "numeric", day: "2-digit" })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return `${parts.day}-${MONTHS[Number(parts.month) - 1]}-${parts.year}`;
}

const chartUrl = (region: string, area: string, date: string) =>
  `${EIRGRID_BASE}?region=${region}&chartType=${area === "co2intensity" ? "co2" : "default"}&dateRange=day` +
  `&dateFrom=${date}+00:00&dateTo=${date}+23:59&areas=${area}`;

const latest = (rows: Row[] | undefined) => [...(rows ?? [])].reverse().find((r) => typeof r.Value === "number");

const statusTool = defineTool({
  name: "grid_get_status",
  title: "Live electricity grid status",
  description:
    "Latest electricity demand (MW), wind generation (MW), wind share of demand (%, from the latest interval both series report) and carbon intensity (gCO2/kWh) from EirGrid, for Ireland + Northern Ireland, ROI or NI. 15-minute resolution.",
  inputSchema: {
    region: z.enum(["ALL", "ROI", "NI"]).default("ALL").describe("ALL = whole island, ROI = Republic of Ireland, NI = Northern Ireland.")
  },
  handler: async ({ region }, ctx) => {
    const load = (area: string, date: string) =>
      ctx.cachedJson<{ Rows?: Row[] }>(chartUrl(region, area, date), 5 * MINUTE, { label: `EirGrid ${area}` });
    const loadDay = (date: string) => Promise.all([load("demandactual", date), load("windactual", date), load("co2intensity", date)]);
    const hasReadings = (day: Awaited<ReturnType<typeof loadDay>>) => day.some((r) => latest(r.value.Rows));
    // Just after midnight Irish time the new day's charts are empty; fall back to yesterday's last readings.
    const today = dublinDate(ctx.now());
    let date = today;
    let day = await loadDay(today);
    if (!hasReadings(day)) {
      date = dublinDate(new Date(ctx.now().getTime() - 24 * 60 * 60 * 1000));
      day = await loadDay(date);
    }
    const [demand, wind, co2] = day;
    const d = latest(demand.value.Rows);
    const w = latest(wind.value.Rows);
    const c = latest(co2.value.Rows);
    const windAt = new Map((wind.value.Rows ?? []).filter((r) => typeof r.Value === "number").map((r) => [r.EffectiveTime, r.Value as number]));
    const common = [...(demand.value.Rows ?? [])].reverse().find((r) => typeof r.Value === "number" && r.Value > 0 && windAt.has(r.EffectiveTime));
    if (!d && !w && !c) throw new ToolError("UPSTREAM_DOWN", "EirGrid returned no readings for today or yesterday.", { hint: "Try again in a few minutes." });
    return envelope(eirgridInfo, {
      data: {
        region,
        demand_mw: d?.Value ?? null,
        demand_time: d?.EffectiveTime ?? null,
        wind_mw: w?.Value ?? null,
        wind_time: w?.EffectiveTime ?? null,
        wind_share_pct: common ? Math.round(((windAt.get(common.EffectiveTime) ?? 0) / (common.Value as number)) * 1000) / 10 : null,
        wind_share_time: common?.EffectiveTime ?? null,
        co2_g_per_kwh: c?.Value ?? null,
        co2_time: c?.EffectiveTime ?? null,
        ...(date !== today ? { note: `No readings for ${today} yet (just after midnight); showing the latest readings from ${date}.` } : {})
      },
      url: chartUrl(region, "demandactual", date),
      cached: demand.cached && wind.cached && co2.cached,
      stale: demand.stale || wind.stale || co2.stale
    });
  }
});

export const eirgridModule: SourceModule = {
  info: eirgridInfo,
  summary: "Energy: live electricity demand, wind generation and carbon intensity for the Irish grid (EirGrid).",
  domain: "energy",
  coverage: "All-island (Ireland and Northern Ireland) electricity system, 15-minute resolution, today and recent days.",
  tools: [statusTool]
};
