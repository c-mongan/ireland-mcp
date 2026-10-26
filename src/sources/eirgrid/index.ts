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
    const areas = ["demandactual", "windactual", "co2intensity"] as const;
    // Just after midnight Irish time the new day's charts fill in one series at a time; any series
    // without a reading yet falls back to yesterday's last value.
    const today = dublinDate(ctx.now());
    const yesterday = dublinDate(new Date(ctx.now().getTime() - 24 * 60 * 60 * 1000));
    const current = await Promise.all(areas.map((area) => load(area, today)));
    const missing = areas.map((_area, index) => !latest(current[index]!.value.Rows));
    // Wind share pairs demand with wind, so a missing one of the two also needs the other from yesterday.
    const pairMissing = missing[0] || missing[1];
    const needed = areas.map((_area, index) => missing[index] || (index < 2 && pairMissing));
    // Fetch only the series still needed, and let each fallback fail on its own so today's readings survive.
    const previous = await Promise.all(areas.map((area, index) => (needed[index] ? load(area, yesterday).catch(() => undefined) : undefined)));
    const pick = (index: number) => {
      const fromToday = latest(current[index]!.value.Rows);
      return fromToday ? { row: fromToday, date: today } : { row: latest(previous[index]?.value.Rows), date: yesterday };
    };
    const [demand, wind, co2] = [pick(0), pick(1), pick(2)];
    const d = demand.row;
    const w = wind.row;
    const c = co2.row;
    // Wind share needs demand and wind from the same interval, so it is computed within one day.
    type Chart = (typeof current)[number] | undefined;
    const shareFrom = (demandChart: Chart, windChart: Chart) => {
      if (!demandChart || !windChart) return undefined;
      const windAt = new Map((windChart.value.Rows ?? []).filter((r) => typeof r.Value === "number").map((r) => [r.EffectiveTime, r.Value as number]));
      const row = [...(demandChart.value.Rows ?? [])].reverse().find((r) => typeof r.Value === "number" && r.Value > 0 && windAt.has(r.EffectiveTime));
      return row ? { row, wind: windAt.get(row.EffectiveTime)! } : undefined;
    };
    const share = shareFrom(current[0], current[1]) ?? shareFrom(previous[0], previous[1]);
    const usedYesterday = [demand, wind, co2].some((series) => series.row && series.date === yesterday);
    const used = [...current, ...previous.filter((chart) => chart !== undefined)];
    if (!d && !w && !c) throw new ToolError("UPSTREAM_DOWN", "EirGrid returned no readings for today or yesterday.", { hint: "Try again in a few minutes." });
    return envelope(eirgridInfo, {
      data: {
        region,
        demand_mw: d?.Value ?? null,
        demand_time: d?.EffectiveTime ?? null,
        wind_mw: w?.Value ?? null,
        wind_time: w?.EffectiveTime ?? null,
        wind_share_pct: share ? Math.round((share.wind / (share.row.Value as number)) * 1000) / 10 : null,
        wind_share_time: share?.row.EffectiveTime ?? null,
        co2_g_per_kwh: c?.Value ?? null,
        co2_time: c?.EffectiveTime ?? null,
        ...(usedYesterday ? { note: `Some ${today} charts have no readings yet (just after midnight); those values are the latest from ${yesterday}.` } : {})
      },
      url: chartUrl(region, "demandactual", demand.date),
      cached: used.every((r) => r.cached),
      stale: used.some((r) => r.stale)
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
