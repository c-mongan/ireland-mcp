import { app, type InvocationContext, type Timer } from "@azure/functions";
import { readFile } from "node:fs/promises";
import { syncSources, type Manifest } from "../../packages/irish-legal-mcp/src/ingest.mjs";
import { legalRepositoryFromEnv } from "../sources/irish-legal/backend.js";

export async function legalTimerHandler(_timer: Timer, invocation: InvocationContext): Promise<void> {
  if (process.env.LEGAL_SYNC_ENABLED !== "true") return;
  const manifest = JSON.parse(await readFile(process.env.LEGAL_MANIFEST_PATH ?? new URL("../../packages/irish-legal-mcp/seeds.json", import.meta.url), "utf8")) as Manifest;
  const result = await syncSources(legalRepositoryFromEnv(), manifest, { permissions: { "revised-acts": process.env.LEGAL_REVISED_ACTS_PERMISSION === "true" } });
  invocation.log(`Legal refresh: ${result.succeeded} pages succeeded, ${result.failed} failed; ${result.documents} documents processed.`);
  if (result.failed) throw new Error(`Legal refresh failed for ${result.failed} source pages; prior snapshots were retained.`);
}
app.timer("legalSourceSync", { schedule: "0 40 3 * * *", runOnStartup: false, handler: legalTimerHandler });
