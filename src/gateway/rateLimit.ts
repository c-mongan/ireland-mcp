/** Fixed-window per-key limiter. Good enough for one instance; the instance cap bounds the total. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limitPerWindow: number = 60,
    private readonly windowMs: number = 60_000,
    private readonly now: () => number = Date.now
  ) {}

  /** Charges `cost` requests (e.g. the size of a JSON-RPC batch) against the key's window. */
  check(key: string, cost = 1): { allowed: boolean; retryAfterSeconds: number; remaining: number } {
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || now - window.start >= this.windowMs) {
      window = { start: now, count: 0 };
      this.windows.set(key, window);
      if (this.windows.size > 10_000) this.prune(now);
    }
    window.count += Math.max(1, cost);
    const retryAfterSeconds = Math.max(1, Math.ceil((window.start + this.windowMs - now) / 1000));
    return {
      allowed: window.count <= this.limitPerWindow,
      retryAfterSeconds,
      remaining: Math.max(0, this.limitPerWindow - window.count)
    };
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.start >= this.windowMs) this.windows.delete(key);
    }
  }
}

/**
 * Keys on the right-most X-Forwarded-For entry: Azure's front end appends the address it
 * saw, while anything to its left was supplied by the client and can be spoofed.
 */
export function clientKey(headers: { get(name: string): string | null }, fallback = "unknown"): string {
  const hops = (headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  const last = hops.at(-1);
  if (last) return stripPort(last);
  return headers.get("x-real-ip") ?? fallback;
}

function stripPort(address: string): string {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(address);
  if (bracketed) return bracketed[1]!;
  const ipv4 = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(address);
  return ipv4 ? ipv4[1]! : address;
}

/** Parses RATE_LIMIT_PER_MINUTE, falling back to 60 for missing or invalid values. */
export function limitFromEnv(value: string | undefined, fallback = 60): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
