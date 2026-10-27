import { describe, expect, it, vi } from "vitest";
import { healthHandler } from "./healthz.js";

const { SHA } = vi.hoisted(() => ({ SHA: "0123456789abcdef0123456789abcdef01234567" }));

vi.mock("../gateway/release.js", () => ({ PACKAGED_RELEASE: SHA }));
vi.mock("../registry.js", () => ({ sourceModules: [{ info: { id: "demo" } }] }));

describe("healthz release", () => {
  it("reports the packaged Git revision so the deploy smoke test can confirm what is running", async () => {
    const response = await healthHandler();
    expect(response.jsonBody).toMatchObject({ status: "ok", release: SHA });
  });
});
