import { createHmac, randomBytes } from "node:crypto";
import { clientKey } from "./rateLimit.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A random salt that lives in memory only and is replaced at each UTC midnight. */
export class DailySalt {
  private day = -1;
  private salt: Buffer = Buffer.alloc(0);

  constructor(
    private readonly now: () => number = Date.now,
    private readonly random: () => Buffer = () => randomBytes(32)
  ) {}

  current(): Buffer {
    const day = Math.floor(this.now() / DAY_MS);
    if (day !== this.day) {
      this.day = day;
      this.salt = this.random();
    }
    return this.salt;
  }
}

const sharedSalt = new DailySalt();

/** Rate-limit key: HMAC-SHA256 of the client address under the daily salt. The address itself is never kept. */
export function hashedClientKey(headers: Headers, salt: DailySalt = sharedSalt): string {
  return createHmac("sha256", salt.current()).update(clientKey(headers)).digest("base64url").slice(0, 22);
}

const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MAX_NAMES = 32;

/** Argument names only, sorted; values are never read. Odd keys are dropped so data cannot hide in key names. */
export function argumentNames(args: unknown): string[] {
  if (!args || typeof args !== "object" || Array.isArray(args)) return [];
  return Object.keys(args)
    .filter((key) => SAFE_NAME.test(key))
    .sort()
    .slice(0, MAX_NAMES);
}

const MAX_CLIENT_FIELD = 64;

function bounded(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/[^\x20-\x7e]/g, "").slice(0, MAX_CLIENT_FIELD);
  return clean || undefined;
}

/** Client name and version from initialize params, if the client sent them. */
export function clientInfoFrom(params: unknown): { name?: string; version?: string } {
  if (!params || typeof params !== "object") return {};
  const info = (params as { clientInfo?: unknown }).clientInfo;
  if (!info || typeof info !== "object") return {};
  const name = bounded((info as { name?: unknown }).name);
  const version = bounded((info as { version?: unknown }).version);
  return { ...(name ? { name } : {}), ...(version ? { version } : {}) };
}
