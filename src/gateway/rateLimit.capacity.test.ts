import { expect, it } from "vitest";
import { RateLimiter } from "./rateLimit.js";

it("bounds new client keys without resetting existing quotas", () => {
  let now = 0;
  const limiter = new RateLimiter(2, 1000, () => now, 2);
  expect(limiter.check("a").allowed).toBe(true);
  expect(limiter.check("b").allowed).toBe(true);
  expect(limiter.check("c").allowed).toBe(false);
  expect(limiter.check("a").allowed).toBe(true);
  expect(limiter.check("a").allowed).toBe(false);
  now = 1001;
  expect(limiter.check("c").allowed).toBe(true);
});
