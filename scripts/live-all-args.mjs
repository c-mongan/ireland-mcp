// Argument handling for live-all-ops.mjs, kept separate so it can be unit tested without a build or network.
import { resolve } from "node:path";

/** The canonical hosted endpoint; docs/live-all-ops.md is the receipt for this target only. */
export const DEPLOYED_URL = "https://mcp.irishopendata.ie/mcp";

function urlValue(value) {
  if (!value || value.startsWith("--")) throw new Error("--url requires an http(s) MCP endpoint, e.g. --url https://mcp.irishopendata.ie/mcp");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`--url is not a valid URL: ${value}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`--url must be http(s): ${value}`);
  return value;
}

export function parseArgs(argv = process.argv) {
  const out = { url: null, json: false, delayMs: null, report: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") out.json = true;
    else if (arg === "--report") {
      out.report = argv[++i];
      if (!out.report || out.report.startsWith("--")) throw new Error("--report requires a path");
    }
    else if (arg === "--deployed") out.url = DEPLOYED_URL;
    else if (arg === "--url") out.url = urlValue(argv[++i]);
    else if (arg.startsWith("--url=")) out.url = urlValue(arg.slice("--url=".length));
    else if (arg === "--delay-ms") out.delayMs = Number(argv[++i] ?? "0");
    else if (arg.startsWith("--delay-ms=")) out.delayMs = Number(arg.slice("--delay-ms=".length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

const normalise = (value) => {
  const url = new URL(value);
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
};

export function isHostedTarget(url) {
  return Boolean(url) && normalise(url) === normalise(DEPLOYED_URL);
}

/** Where to write the Markdown report, or null to print only (local and non-canonical runs). */
export function reportPathFor(args, defaultPath) {
  if (args.report) return resolve(args.report);
  return isHostedTarget(args.url) ? defaultPath : null;
}
