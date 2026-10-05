/** Thrown when a client asks for a toolset id that is not a registered source. */
export class UnknownToolsetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownToolsetError";
  }
}

export const ALL_TOOLSETS = "all";

/**
 * Turns a comma list like "cso,irish-rail" (or "all") into source ids whose typed tools should be
 * listed alongside the meta tools. An empty or missing spec gives the lean default surface.
 */
export function resolveToolsets(spec: string | undefined, known: readonly string[]): string[] {
  const ids = (spec ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (ids.includes(ALL_TOOLSETS)) return [...known];
  const unknown = ids.filter((id) => !known.includes(id));
  if (unknown.length) {
    throw new UnknownToolsetError(
      `Unknown toolset "${unknown.join('", "')}". Valid toolsets: ${[ALL_TOOLSETS, ...known].join(", ")}.`
    );
  }
  return [...new Set(ids)];
}

/** Reads toolsets from `/mcp/x/{source}` and/or `?toolsets=a,b`. Returns undefined for the lean default. */
export function toolsetsFromUrl(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const parts: string[] = [];
  const match = /\/mcp\/x\/([^/]+)\/?$/.exec(parsed.pathname);
  if (match) parts.push(safeDecode(match[1]!));
  const query = parsed.searchParams.get("toolsets");
  if (query) parts.push(query);
  return parts.length ? parts.join(",") : undefined;
}

/** A malformed escape is kept as-is, so it is reported as an unknown toolset rather than a 500. */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Reads `--toolsets=a,b` / `--toolsets a,b` from CLI args, falling back to IRELAND_MCP_TOOLSETS. */
export function toolsetsFromArgs(argv: readonly string[], env: Record<string, string | undefined>): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg.startsWith("--toolsets=")) return arg.slice("--toolsets=".length);
    if (arg === "--toolsets" && argv[i + 1] !== undefined) return argv[i + 1];
  }
  return env.IRELAND_MCP_TOOLSETS || undefined;
}
