import { HttpClient } from "../../gateway/http.js";
import { buildCibDatasets, CIB_ORIGIN, pinnedUrls, type Downloads } from "./build.js";

/** Known, documented publisher inconsistencies. Any other failed check stops the refresh. */
export const KNOWN_FAILED_CHECKS = new Set([
  "2025 subcategory_table_total_matches:housing",
  "2025 subcategory_table_total_matches:money-and-tax",
  "2025 subcategory_table_total_matches:moving-country"
]);

/** Maintenance only: never called by an MCP operation. Downloads every pinned file before building anything. */
export async function refreshCib(http = new HttpClient(), now = new Date()) {
  const downloads: Downloads = new Map();
  for (const url of pinnedUrls()) {
    if (!url.startsWith(`${CIB_ORIGIN}/`)) throw new Error(`Refusing unpinned host: ${url}`);
    const bytes = await http.bytes(url, { label: "Citizens Information Board report", timeoutMs: 30_000, maxBytes: 5_000_000, retries: 1 });
    downloads.set(url, { bytes, retrievedAt: now.toISOString() });
  }
  const built = buildCibDatasets(downloads, now.toISOString());
  const unexpected = built.failed.filter((f) => !KNOWN_FAILED_CHECKS.has(f.key));
  if (unexpected.length) throw new Error(`CIB refresh stopped; unexpected failed checks:\n${unexpected.map((f) => `${f.key}: ${f.detail}`).join("\n")}`);
  return built;
}
