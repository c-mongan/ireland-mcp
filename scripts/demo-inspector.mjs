#!/usr/bin/env node
// Records a real MCP Inspector session against the hosted server and checks every answer has a citation.
// Start the Inspector first, with a saved Streamable HTTP server named "ireland-live" pointing at the endpoint:
//   DANGEROUSLY_OMIT_AUTH=true MCP_AUTO_OPEN_ENABLED=false npx -y @modelcontextprotocol/inspector@2.9.0
// Then: node scripts/demo-inspector.mjs [--out <dir>] [--inspector http://127.0.0.1:6274] [--server ireland-live]
import { mkdir, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = arg("out", "docs/demo/raw");
const INSPECTOR = arg("inspector", "http://127.0.0.1:6274");
const SERVER = arg("server", "ireland-live");

const CALLS = [
  {
    name: "nearby-galway",
    tool: "nearby",
    args: { lat: 53.2743, lon: -9.049, hours: 6 },
    expect: [/"name": "Galway City Council"/, /"licence": "CC BY 4\.0"/],
  },
  {
    name: "cso-ennis",
    tool: "ireland_call",
    args: {
      source: "cso",
      operation: "cso_area_profile",
      args: { area: "Ennis" },
    },
    expect: [
      /"area": "Ennis, Co Clare"/,
      /"total": 27923/,
      /data\.cso\.ie\/table\/F1015/,
    ],
  },
  {
    name: "met-galway",
    tool: "ireland_call",
    args: {
      source: "met-eireann",
      operation: "met_get_forecast",
      args: { lat: 53.2707, lon: -9.0568, hours: 6 },
    },
    expect: [
      /"temperature_c"|"temperature"/,
      /Met Éireann/,
      /openaccess\.pf\.api\.met\.ie/,
    ],
  },
  {
    name: "ppr-galway-2024",
    tool: "ireland_call",
    args: {
      source: "ppr",
      operation: "ppr_price_stats",
      args: { county: "Galway", from: "2024-01-01", to: "2024-12-31" },
    },
    expect: [/"median_eur": \d+/, /propertypriceregister\.ie/],
  },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();
const results = [];

try {
  await page.goto(INSPECTOR);
  const toggle = page.getByRole("switch", {
    name: `Connect or disconnect "${SERVER}"`,
  });
  await toggle.waitFor({ timeout: 30_000 });
  if (!(await toggle.isChecked())) await toggle.click({ force: true });
  await page
    .getByRole("button", { name: "Disconnect from server" })
    .waitFor({ timeout: 30_000 });
  await page.getByText("Tools", { exact: true }).click();

  let selected = "";
  for (const call of CALLS) {
    const started = Date.now();
    // Clicking the selected tool again collapses its form.
    if (call.tool !== selected)
      await page
        .getByRole("button", { name: new RegExp(`\\b${call.tool}\\b`) })
        .first()
        .click();
    selected = call.tool;
    const json = page.getByRole("switch", { name: "Edit as JSON" });
    if (!(await json.isChecked())) await json.click({ force: true });
    await page.locator(".ace_content").first().click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.insertText(JSON.stringify(call.args, null, 1));
    await page.getByRole("button", { name: "Execute Tool" }).click();
    await page
      .waitForFunction(
        (patterns) =>
          patterns.every((p) =>
            new RegExp(p).test(globalThis.document.body.innerText),
          ),
        call.expect.map((r) => r.source),
        { timeout: 60_000 },
      )
      .catch(() => undefined);
    const text = await page.locator("body").innerText();
    const missing = call.expect.filter((r) => !r.test(text)).map(String);
    await page.screenshot({ path: join(OUT, `inspector-${call.name}.png`) });
    results.push({
      name: call.name,
      ok: missing.length === 0,
      ms: Date.now() - started,
      missing,
    });
    await page.waitForTimeout(1500);
    // The results panel replaces the tool form; close it to get the form back.
    await page
      .getByRole("heading", { name: "Results" })
      .locator("xpath=..")
      .getByRole("button")
      .first()
      .click();
  }
} finally {
  await context.close();
  await browser.close();
}

const videos = (await readdir(OUT)).filter(
  (f) => f.endsWith(".webm") && !f.startsWith("inspector"),
);
if (videos[0])
  await rename(join(OUT, videos[0]), join(OUT, "inspector-session.webm"));
for (const r of results)
  console.log(
    `${r.ok ? "PASS" : "FAIL"} ${r.name} ${r.ms}ms ${r.missing.join(" ")}`,
  );
process.exit(
  results.length === CALLS.length && results.every((r) => r.ok) ? 0 : 1,
);
