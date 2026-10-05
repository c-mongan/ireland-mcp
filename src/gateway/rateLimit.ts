/** Fixed-window per-key limiter. Good enough for one instance; the instance cap bounds the total. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limitPerWindow: number = 60,
    private readonly windowMs: number = 60_000,
    private readonly now: () => number = Date.now
  ) {}

  check(key: string): { allowed: boolean; retryAfterSeconds: number; remaining: number } {
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || now - window.start >= this.windowMs) {
      window = { start: now, count: 0 };
      this.windows.set(key, window);
      if (this.windows.size > 10_000) this.prune(now);
    }
    window.count += 1;
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

/** Takes the left-most X-Forwarded-For address (set by the Functions front end) or falls back. */
export function clientKey(headers: { get(name: string): string | null }, fallback = "unknown"): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first.replace(/:\d+$/, "");
  return headers.get("x-real-ip") ?? fallback;
}
