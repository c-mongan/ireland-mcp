import { HttpClient } from "../../gateway/http.js";
import { ToolError } from "../../gateway/errors.js";
import { buildSnapshot, exportLocation, MAX_EXPORT_BYTES, PERIODS } from "./export.js";

/** Maintenance only: never called by an MCP operation. Nothing is published until both exports validate. */
export async function refreshSnapshot(snapshotDate: string, http = new HttpClient(), now = new Date()) {
  const exports = [];
  for (const period of PERIODS) {
    const location = exportLocation(period, snapshotDate);
    // Check the actual published listing before requesting a deterministically named file.
    const listing = await http.json<{ files?: string[] }>(`https://kohesio.ec.europa.eu/api/data/projects-${period}/${snapshotDate}`, {
      label: "Kohesio export listing", timeoutMs: 30_000, maxBytes: 100_000, retries: 1
    });
    if (!Array.isArray(listing.files) || !listing.files.includes(location.path)) {
      throw new ToolError("NOT_FOUND", `The official Kohesio listing does not contain the Ireland ${period} CSV for ${snapshotDate}.`);
    }
    const csv = await http.text(location.url, { label: "Kohesio Ireland CSV", headers: { accept: "text/csv" }, timeoutMs: 30_000, maxBytes: MAX_EXPORT_BYTES, retries: 1 });
    exports.push({ period, snapshot_date: snapshotDate, csv });
  }
  return buildSnapshot(exports, now.toISOString());
}
