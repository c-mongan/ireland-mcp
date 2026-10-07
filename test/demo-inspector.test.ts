import { mkdtemp, readFile, readdir, rename, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const script = await readFile(new URL("../scripts/demo-inspector.mjs", import.meta.url), "utf8");
const nearby = JSON.stringify({
  data: { boundaries: { local_authority: { name: "Galway City Council" } },
    sources: [{ url: "https://www.geohive.ie/", licence: "CC BY 4.0" }] }
}, null, 2);
const otherAnswers = [
  '"area": "Ennis, Co Clare", "total": 27923, https://data.cso.ie/table/F1015',
  '"temperature_c": 12, Met Éireann, https://openaccess.pf.api.met.ie/',
  '"median_eur": 300000, https://propertypriceregister.ie/',
  '"annual_water_quality_assessment": "Excellent", https://data.epa.ie/bw/api/v1/locations?page=1&per_page=3'
];

// Run the actual script with only the browser boundary replaced; keep file I/O real.
async function runDemo(answer: string, interrupt = false) {
  const out = await mkdtemp(join(tmpdir(), "inspector-regression-"));
  try {
    await writeFile(join(out, "aaa-earlier-session.webm"), "earlier session");
    let current = -1;
    let closed = false;
    const lines: string[] = [];
    let exitCode: number | undefined;
    const locator = {
      waitFor: async () => {}, isChecked: async () => true,
      click: async () => {}, first: () => locator, locator: () => locator,
      getByRole: () => locator, innerText: async () => [answer, ...otherAnswers][current]
    };
    const video = {
      saveAs: async (path: string) => {
        if (!closed) throw new Error("Recording must be finalized first");
        await writeFile(path, "current session");
      }
    };
    const page = {
      goto: async () => { if (interrupt) throw new Error("Inspector unavailable"); },
      getByRole: (_role: string, options?: { name?: string }) => options?.name === "Execute Tool"
        ? { ...locator, click: async () => { current++; } } : locator,
      getByText: () => locator, locator: () => locator,
      keyboard: { press: async () => {}, insertText: async () => {} },
      waitForFunction: async () => {}, screenshot: async () => {},
      waitForTimeout: async () => {}, video: () => video
    };
    const context = {
      newPage: async () => page,
      close: async () => { closed = true; await writeFile(join(out, "zzz-current-session.webm"), "current session"); }
    };
    const browser = { newContext: async () => context, close: async () => {} };
    let error: unknown;
    try {
      await runInNewContext(`(async () => {${script.replace(/^#!.*\n/, "").replace(/^import .*;\n/gm, "")} })()`, {
        mkdir, readdir, rename, join, chromium: { launch: async () => browser },
        process: { argv: ["node", "demo-inspector.mjs", "--out", out], exit: (code: number) => { exitCode = code; } },
        console: { log: (line: string) => lines.push(line) }
      });
    } catch (caught) { error = caught; }
    const recording = await readFile(join(out, "inspector-session.webm"), "utf8").catch(() => undefined);
    const earlier = await readFile(join(out, "aaa-earlier-session.webm"), "utf8").catch(() => undefined);
    return { exitCode, lines, recording, earlier, error };
  } finally { await rm(out, { recursive: true, force: true }); }
}

describe("Inspector evidence script", () => {
  it("rejects nearby data with a name and licence but no source URL", async () => {
    const result = await runDemo(nearby.replace('"url": "https://www.geohive.ie/",', ""));
    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(1);
    expect(result.lines[0]).toMatch(/^FAIL nearby-galway/);
  });

  it("accepts cited nearby data and saves this session instead of an earlier WebM", async () => {
    const result = await runDemo(nearby);
    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);
    expect(result.lines).toHaveLength(5);
    expect(result.recording).toBe("current session");
    expect(result.earlier).toBe("earlier session");
  });

  it("saves the current recording even when Inspector connection fails", async () => {
    const result = await runDemo(nearby, true);
    expect(result.error).toMatchObject({ message: "Inspector unavailable" });
    expect(result.recording).toBe("current session");
    expect(result.earlier).toBe("earlier session");
  });
});
