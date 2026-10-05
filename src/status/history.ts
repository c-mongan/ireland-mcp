/**
 * Status feed for the landing page. Run by .github/workflows/status.yml every 30 minutes:
 *   node src/status/history.ts --url https://<host>/healthz?deep=1 --dir <status-branch>/status
 * Writes status.json (latest deep-health report) and history.json (compact samples, last 7 days).
 * Self-contained (no imports from the app) so Node can run it directly with type stripping.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const HISTORY_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SourceSample {
  source: string;
  status: string;
  latencyMs?: number;
}

export interface StatusSample {
  checked_at: string;
  status: string;
  sources: SourceSample[];
}

export interface History {
  updated_at: string;
  window_days: number;
  samples: StatusSample[];
}

interface RawSource {
  source?: unknown;
  status?: unknown;
  latencyMs?: unknown;
}

/** Reduces a /healthz?deep=1 report to the fields the status page needs. Unknown shapes become "unreachable". */
export function toSample(report: unknown, fetchedAt: Date): StatusSample {
  const r = (report ?? {}) as { status?: unknown; checked_at?: unknown; sources?: unknown };
  const sources: SourceSample[] = [];
  for (const s of Array.isArray(r.sources) ? (r.sources as RawSource[]) : []) {
    if (typeof s?.source !== "string" || typeof s.status !== "string") continue;
    sources.push({ source: s.source, status: s.status, ...(typeof s.latencyMs === "number" ? { latencyMs: s.latencyMs } : {}) });
  }
  return {
    checked_at: typeof r.checked_at === "string" && !Number.isNaN(Date.parse(r.checked_at)) ? r.checked_at : fetchedAt.toISOString(),
    status: typeof r.status === "string" ? r.status : "unreachable",
    sources
  };
}

/** Appends a sample, drops duplicates (a cached report repeats checked_at) and trims to the window. */
export function appendSample(history: StatusSample[], sample: StatusSample, now: Date, days = HISTORY_DAYS): StatusSample[] {
  const cutoff = now.getTime() - days * DAY_MS;
  const byTime = new Map<string, StatusSample>();
  for (const s of [...history, sample]) {
    const t = Date.parse(s.checked_at);
    if (Number.isFinite(t) && t >= cutoff) byTime.set(s.checked_at, s);
  }
  return [...byTime.values()].sort((a, b) => Date.parse(a.checked_at) - Date.parse(b.checked_at));
}

export function parseHistory(text: string | undefined): StatusSample[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as { samples?: unknown };
    return Array.isArray(parsed.samples) ? (parsed.samples as StatusSample[]).filter((s) => typeof s?.checked_at === "string") : [];
  } catch {
    return [];
  }
}

async function fetchReport(url: string): Promise<{ report: unknown; error?: string }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "user-agent": "ireland-mcp-status/1.0" } });
    if (!response.ok) return { report: { status: "unreachable" }, error: `HTTP ${response.status}` };
    return { report: await response.json() };
  } catch (error) {
    return { report: { status: "unreachable" }, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main(argv: string[]): Promise<void> {
  const arg = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const url = arg("url");
  const dir = arg("dir") ?? "status";
  if (!url) throw new Error("--url is required");
  const now = new Date();
  const { report, error } = await fetchReport(url);
  const sample = toSample(report, now);
  await mkdir(dir, { recursive: true });
  const latest = { ...(report as object), fetched_at: now.toISOString(), ...(error ? { error } : {}) };
  const previous = await readFile(join(dir, "history.json"), "utf8").catch(() => undefined);
  const samples = appendSample(parseHistory(previous), sample, now);
  const history: History = { updated_at: now.toISOString(), window_days: HISTORY_DAYS, samples };
  await writeFile(join(dir, "status.json"), `${JSON.stringify(latest, null, 2)}\n`);
  await writeFile(join(dir, "history.json"), `${JSON.stringify(history)}\n`);
  console.log(`status=${sample.status} samples=${samples.length}${error ? ` error=${error}` : ""}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
