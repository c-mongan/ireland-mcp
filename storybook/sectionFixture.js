import pageHtml from "../web/index.html?raw";
import siteCss from "../web/styles.css?raw";
import demoCss from "./demo.css?raw";
import { buildResultView, renderResultView } from "../web/result-view.js";

function required(root, selector) {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Storybook cannot find production element: ${selector}`);
  return element;
}

function populateInstaller(section, endpoint) {
  const tabs = required(section, ".install-tabs");
  tabs.innerHTML = '<button id="tab-copilot" type="button" role="tab" aria-controls="install-panel" aria-selected="true">Copilot CLI</button>';
  const panel = required(section, "#install-panel");
  panel.setAttribute("aria-labelledby", "tab-copilot");
  panel.innerHTML = "<h3>Copilot CLI</h3><p>Run the command below, or save the JSON snippet to ~/.copilot/mcp-config.json.</p><div class='install-actions'><button type='button' class='btn secondary'>Copy Config</button></div><pre tabindex='0'><code></code></pre>";
  required(panel, "code").textContent = `copilot mcp add --transport http ireland ${endpoint}\n\n${JSON.stringify({ mcpServers: { ireland: { type: "http", url: endpoint, tools: ["*"] } } }, null, 2)}`;
}

function populateDirectory(section) {
  const directory = required(section, "#source-directory");
  const navigation = required(section, "#source-nav");
  const subject = document.createElement("a");
  subject.href = "#domain-stats";
  subject.textContent = "Statistics";
  navigation.replaceChildren(subject);
  const group = document.createElement("section");
  group.className = "domain-group";
  group.setAttribute("aria-labelledby", "domain-stats");
  group.innerHTML = '<h3 id="domain-stats">Statistics</h3><div class="source-grid"></div>';
  const grid = required(group, ".source-grid");
  const sources = [
    ["Central Statistics Office (CSO) PxStat", "Official statistics: census, population, prices, labour market, housing and thousands more PxStat tables.", "4 operations", "What was Galway's population in Census 2022?"],
    ["World Bank Indicators for Ireland", "Comparable macro, population, climate and development indicators for Ireland.", "2 operations", "Show Ireland's population trend from World Bank."],
    ["Eurostat Statistics API", "Ireland-vs-EU statistical comparisons across population, economy and society datasets.", "3 operations", "Compare Irish unemployment with the EU average."]
  ];
  for (const [name, summary, operations, example] of sources) {
    const card = document.createElement("article");
    card.className = "source-card";
    card.innerHTML = '<h4></h4><p></p><div class="source-meta"><span></span><span>CC BY 4.0</span></div><p class="example"></p>';
    required(card, "h4").textContent = name;
    required(card, "p").textContent = summary;
    required(card, ".source-meta span").textContent = operations;
    required(card, ".example").textContent = `"${example}"`;
    grid.append(card);
  }
  directory.replaceChildren(group);
}

function populatePlayground(section, state) {
  required(section, ".section-head p").textContent = "These fixed sample states demonstrate the interface. No live query runs in Storybook.";
  required(section, 'label[for="example-select"]').textContent = "Choose a sample example";
  required(section, 'button[type="submit"]').textContent = "Sample query (disabled)";
  required(section, "#response-title").textContent = "Sample response";
  const output = required(section, "#pg-output");
  const status = required(section, "#pg-status");
  const preview = required(section, "#pg-result");
  const cso = {
    source: "CSO PxStat", licence: "CC BY 4.0", retrieved_at: "2026-01-01T12:00:00Z",
    attribution: "Contains Central Statistics Office data. Fixed sample for visual review.",
    url: "https://data.cso.ie/search?q=population", cached: false, truncated: false
  };
  const table = { code: "F1001", title: "Sample population table", released: "2025-12-01", url: "https://data.cso.ie/table/F1001" };
  const states = {
    idle: {}, loading: {},
    success: { payload: { ...cso, data: [table] } },
    empty: { payload: { ...cso, data: [] } },
    "cached-stale": { payload: { ...cso, data: [table], cached: true, stale: true, truncated: true } },
    truncated: { payload: { ...cso, url: "javascript:alert('unsafe source')", data: Array.from({ length: 12 }, (_, index) => ({ ...table, code: `SAMPLE${index + 1}`, title: index ? `Sample table ${index + 1}` : `<img src=x onerror=alert(1)> ${"A long sample title tests bounded wrapping. ".repeat(12)}` })), truncated: true, returned: 12, total: 250 } },
    weather: { source: "met-eireann", operation: "met_get_warnings", args: {}, label: "Sample weather warnings", payload: { ...cso, source: "Met Éireann", url: "https://www.met.ie/warnings", attribution: "Met Éireann. Fixed sample warning for visual review.", data: { count: 1, warnings: [{ headline: "Sample heavy rain warning", level: "Yellow", onset: "2026-01-01T06:00:00Z", expiry: "2026-01-01T18:00:00Z" }] } } },
    transport: { source: "luas", operation: "luas_get_forecast", args: { stop: "HEU" }, label: "Sample Luas arrivals", payload: { ...cso, source: "Luas Forecasting API", url: "https://luas.ie/", attribution: "Luas. Fixed sample arrivals for visual review.", data: { stop: { name: "Heuston" }, message: "Sample forecast. Check the operator before travel.", inbound: [{ destination: "The Point", due_in_min: 4 }], outbound: [{ destination: "Tallaght", due_in_min: 7 }] } } },
    rent: { operation: "cso_get_data", args: { table_code: "RIQ02", filters: { STATISTIC: ["RIQ02"], "TLIST(Q1)": ["20254"], C02970V03592: ["02"], C02969V03591: ["04"], C03004V03625: ["141600"] }, limit: 5 }, label: "Sample historical registered-tenancy rent", payload: { ...cso, url: "https://data.cso.ie/table/RIQ02", data: { code: "RIQ02", title: "RTB Average Monthly Rent Report", rows: [{ STATISTIC: "RTB Average Monthly Rent Report", Quarter: "2025Q4", "Number of Bedrooms": "Two bed", "Property Type": "Apartment", Location: "Galway City", value: 1672.57, unit: "Euro" }], total_rows: 1 } } },
    error: { payload: { error: { code: "UPSTREAM_ERROR", message: "Sample error: The source is temporarily unavailable. Please try again." } } }
  };
  const fixture = states[state];
  if (!fixture) throw new Error(`Unknown playground fixture state: ${state}`);
  const source = fixture.source || "cso";
  const operation = fixture.operation || "cso_search_tables";
  const option = section.ownerDocument.createElement("option");
  option.textContent = fixture.label || "Sample CSO population search";
  required(section, "#example-select").replaceChildren(option);
  required(section, "#pg-source").setAttribute("value", source);
  required(section, "#pg-operation").setAttribute("value", operation);
  required(section, "#pg-args").textContent = JSON.stringify(fixture.args || { query: "population", limit: 5 }, null, 2);
  const exampleIndex = { weather: "2", transport: "1", rent: "6" }[state] || "0";
  for (const button of section.querySelectorAll(".sample-request")) button.setAttribute("aria-pressed", String(button.dataset.exampleIndex === exampleIndex));
  required(section, "#pg-request-label").textContent = state === "idle" ? "No sample request has run yet." : `Sample request: ${source} · ${operation}`;
  required(section, "#response-area").setAttribute("aria-busy", String(state === "loading"));
  preview.dataset.state = state === "loading" ? "loading" : state === "idle" ? "idle" : state === "error" ? "error" : "success";
  if (state === "idle" || state === "loading") {
    status.textContent = state === "idle" ? "" : "Running sample query…";
    preview.textContent = state === "idle" ? "Choose a sample and run it to inspect the returned data and its source." : "Waiting for the sample source response…";
    output.textContent = state === "idle" ? "Choose an example, then run it." : "Waiting for a sample response…";
  } else {
    status.textContent = state === "error" ? "Query failed. You can try again." : "120 ms (sample)";
    renderResultView(preview, buildResultView(fixture.payload, { source, operation, isError: state === "error" }));
    output.textContent = JSON.stringify(fixture.payload, null, 2);
  }
  required(section, "#pg-raw-details").open = state === "error";
  output.classList.toggle("error", state === "error");
}

function populateStatus(section, state) {
  required(section, ".section-head p").textContent = "Fixed sample health reports for visual review. These reports do not describe the live service.";
  const card = required(section, "#status-card");
  if (state === "loading" || state === "unreachable") {
    card.textContent = state === "loading" ? "Loading sample status…" : "Status feed unavailable. Check GitHub status branch. Sample network failure.";
    return;
  }
  const headings = {
    healthy: "All monitored sources healthy",
    degraded: "1 source unavailable",
    stale: "Status check is out of date"
  };
  if (!headings[state]) throw new Error(`Unknown status fixture state: ${state}`);
  card.innerHTML = '<div class="status-main"><strong></strong><span class="muted">Checked 1 Jan 2026, 12:00 (sample)</span></div><p></p><div class="status-sources"></div>';
  const heading = required(card, "strong");
  heading.className = state === "healthy" ? "status-ok" : "status-bad";
  heading.textContent = headings[state];
  required(card, "p").textContent = state === "degraded" ? "1 healthy · 1 unavailable · 1 needs setup" : "2 healthy · 0 unavailable · 0 needs setup";
  const sources = state === "degraded"
    ? ["cso: up · 120 ms", "kohesio: unavailable · Provider refused access (HTTP 403)", "nta: setup needed · NTA_API_KEY is not configured"]
    : ["cso: up · 120 ms", "oireachtas: up · 80 ms"];
  for (const source of sources) {
    const pill = document.createElement("span");
    pill.textContent = source;
    required(card, ".status-sources").append(pill);
  }
}

export function sectionDocument({ section: sectionId, theme, state = "idle" }) {
  const source = new DOMParser().parseFromString(pageHtml, "text/html");
  const section = required(source, `#${sectionId}`).cloneNode(true);
  for (const element of section.querySelectorAll("script, noscript, video")) element.remove();
  if (sectionId === "top") {
    required(section, "#live-label").textContent = "Sample Server Online";
    required(section, "#motion-toggle").textContent = "Video paused in Storybook";
  }
  if (sectionId === "install") populateInstaller(section, required(source, 'meta[name="mcp-endpoint"]').content);
  if (sectionId === "directory") populateDirectory(section);
  if (sectionId === "playground") populatePlayground(section, state);
  if (sectionId === "status") populateStatus(section, state);
  for (const element of section.querySelectorAll("button, input, textarea, select")) element.disabled = true;
  for (const link of section.querySelectorAll("a")) {
    if (link.closest("#pg-result") && link.hasAttribute("href")) link.dataset.sourceUrl = link.href;
    link.removeAttribute("href");
    link.setAttribute("aria-disabled", "true");
  }
  return `<!doctype html><html lang="en-IE" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'"><style>${siteCss}\n${demoCss}</style></head><body><p class="wrap" role="note">Storybook fixture: fixed sample data; live queries, installation links, copy actions and video are disabled.</p><main>${section.outerHTML}</main></body></html>`;
}
