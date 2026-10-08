/**
 * Origin validation (MCP 2025-11-25 transport security). Browsers send Origin; a
 * request from a page not on this list is refused, which blocks DNS-rebinding and
 * drive-by use. Requests without Origin (server-to-server clients) are allowed.
 */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  "https://claude.ai",
  "https://chatgpt.com",
  "vscode-webview://*",
  "http://localhost",
  "http://localhost:*",
  "http://127.0.0.1",
  "http://127.0.0.1:*",
  "https://lemon-meadow-03b2b8903.3.azurestaticapps.net",
  "https://irishopendata.ie",
  "https://www.irishopendata.ie",
  "https://irishopendata.com",
  "https://www.irishopendata.com"
];

/**
 * Reads MCP_ALLOWED_ORIGINS: a comma list that replaces the defaults, or `+a,b` to
 * extend them. `*` allows every origin. `*` inside an entry matches one host label or port.
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  const value = raw?.trim();
  if (!value) return [...DEFAULT_ALLOWED_ORIGINS];
  const extend = value.startsWith("+");
  const entries = (extend ? value.slice(1) : value)
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return extend ? [...DEFAULT_ALLOWED_ORIGINS, ...entries] : entries;
}

const compiled = new Map<string, RegExp>();

function patternFor(entry: string): RegExp {
  let re = compiled.get(entry);
  if (!re) {
    const escaped = entry
      .toLowerCase()
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"))
      .join("[a-z0-9-]+");
    re = new RegExp(`^${escaped}$`);
    compiled.set(entry, re);
  }
  return re;
}

export function isOriginAllowed(origin: string, allowlist: readonly string[]): boolean {
  if (allowlist.includes("*")) return true;
  const normalised = origin.trim().toLowerCase();
  if (!normalised || normalised === "null") return false;
  return allowlist.some((entry) => patternFor(entry).test(normalised));
}
