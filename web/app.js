const MCP_URL = "https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp";
const FUTURE_MCP_URL = "https://mcp.irishopendata.ie/mcp";
const STATUS_URL = "https://raw.githubusercontent.com/c-mongan/ireland-mcp/status/status/status.json";

const SOURCE_FALLBACK = [
  { domain: "stats", sources: [
    { id: "cso", name: "Central Statistics Office (CSO) PxStat", summary: "Official statistics: census, population, prices, labour market, housing and thousands more PxStat tables.", operations: ["cso_search_tables", "cso_get_table_metadata", "cso_get_data", "cso_area_profile"] },
    { id: "data-gov-ie", name: "data.gov.ie", summary: "National open-data catalogue from Irish public bodies.", operations: ["datagov_search_datasets", "datagov_get_dataset", "datagov_query_datastore"] },
    { id: "smart-dublin", name: "Smart Dublin", summary: "Dublin city and county datasets: counters, parking, footfall, planning and environment.", operations: ["smartdublin_search_datasets", "smartdublin_get_dataset", "smartdublin_query_datastore"] }
  ] },
  { domain: "transport", sources: [
    { id: "nta", name: "National Transport Authority GTFS-Realtime", summary: "Live public transport cancellations and delays; server-side NTA key only.", operations: ["nta_get_realtime_summary", "nta_get_trip_updates"] },
    { id: "irish-rail", name: "Iarnród Éireann realtime API", summary: "Station lookup and live DART, Commuter and Intercity departures.", operations: ["rail_find_station", "rail_get_departures"] },
    { id: "luas", name: "Luas Forecasting API", summary: "Live Luas arrivals and stop list for the Red and Green lines.", operations: ["luas_get_forecast", "luas_list_stops"] }
  ] },
  { domain: "environment", sources: [
    { id: "met-eireann", name: "Met Éireann", summary: "Point forecasts, station observations and active weather warnings.", operations: ["met_get_forecast", "met_get_observations", "met_get_warnings"] },
    { id: "marine", name: "Marine Institute Weather Buoy Network", summary: "Live wind, wave and sea-temperature readings from offshore buoys.", operations: ["marine_get_buoys"] },
    { id: "opw-water", name: "OPW Hydrometric Network", summary: "Live water levels and temperatures from about 460 gauges.", operations: ["water_find_stations", "water_get_level"] }
  ] },
  { domain: "energy", sources: [
    { id: "eirgrid", name: "EirGrid Smart Grid Dashboard", summary: "Live electricity demand, wind generation and carbon intensity.", operations: ["grid_get_status"] }
  ] },
  { domain: "law/politics", sources: [
    { id: "oireachtas", name: "Houses of the Oireachtas Open Data API", summary: "Members, bills, debates, parliamentary questions and votes.", operations: ["oireachtas_search_members", "oireachtas_search_bills", "oireachtas_get_debates", "oireachtas_search_questions", "oireachtas_get_votes"] },
    { id: "legislation", name: "Irish Statute Book via ELI", summary: "Acts of the Oireachtas by year, contents and section text.", operations: ["legislation_list_acts", "legislation_get_act", "legislation_get_section"] }
  ] },
  { domain: "places/property", sources: [
    { id: "geohive", name: "Tailte Éireann GeoHive boundaries", summary: "County, constituency, electoral division, small-area and layer queries.", operations: ["geohive_boundaries_at_point", "geohive_list_layers", "geohive_query_layer"] },
    { id: "ppr", name: "Residential Property Price Register", summary: "Residential sale prices and median prices by area.", operations: ["ppr_search_sales", "ppr_price_stats"] },
    { id: "cross", name: "Ireland MCP combined sources", summary: "Cross-source source list, nearby and one-call place snapshot.", operations: ["list_sources", "ireland_snapshot", "nearby"] }
  ] }
];

const SOURCE_DETAILS = {
  cso: { licence: "CSO reuse / PSI", example: "What was Galway’s population in Census 2022?" },
  "data-gov-ie": { licence: "Varies, catalogue-first", example: "Find open datasets about active travel." },
  "smart-dublin": { licence: "CC BY 4.0 / publisher", example: "Which Dublin datasets mention cycle counters?" },
  nta: { licence: "NTA API terms", example: "Summarise current GTFS-R service disruption." },
  "irish-rail": { licence: "Irish Rail open API", example: "When are the next trains from Dublin Connolly?" },
  luas: { licence: "TII open endpoint", example: "When is the next tram at Heuston?" },
  "met-eireann": { licence: "CC BY 4.0", example: "Will it rain in Cork in the next 12 hours?" },
  marine: { licence: "Marine Institute open data", example: "Which buoys are reporting high waves?" },
  "opw-water": { licence: "OPW waterlevel.ie", example: "What is the latest level at Athlone?" },
  eirgrid: { licence: "EirGrid dashboard data", example: "What is the current wind share on the grid?" },
  oireachtas: { licence: "Oireachtas open data", example: "Find recent bills mentioning housing." },
  legislation: { licence: "Irish Statute Book", example: "Show section 1 of a 2024 Act." },
  geohive: { licence: "Tailte Éireann / OSi", example: "Which constituency contains 53.27,-9.05?" },
  ppr: { licence: "PSRA public register", example: "Median Galway home price last year?" },
  cross: { licence: "Mixed source provenance", example: "Give me a place snapshot for Trinity College." }
};

const EXAMPLES = [
  { question: "Find CSO population tables", source: "cso", operation: "cso_search_tables", args: { query: "population", limit: 5 } },
  { question: "Next Luas arrivals at Heuston", source: "luas", operation: "luas_get_forecast", args: { stop: "Heuston" } },
  { question: "Weather warnings now", source: "met-eireann", operation: "met_get_warnings", args: {} },
  { question: "Irish Rail departures from Connolly", source: "irish-rail", operation: "rail_get_departures", args: { station: "Dublin Connolly" } },
  { question: "Electricity grid status", source: "eirgrid", operation: "grid_get_status", args: {} },
  { question: "Property price stats for Galway", source: "ppr", operation: "ppr_price_stats", args: { county: "Galway" } }
];

const $ = (id) => document.getElementById(id);
const endpoint = document.querySelector('meta[name="mcp-endpoint"]')?.content?.trim() || MCP_URL;
$("endpoint-line").textContent = endpoint;

let rpcId = 1;
async function rpc(method, params = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params })
  });
  const text = await response.text();
  const jsonText = text.startsWith("event:")
    ? text.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim()
    : text;
  const body = JSON.parse(jsonText || "{}");
  if (body.error) throw new Error(body.error.message || `HTTP ${response.status}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return body.result;
}

function safeBtoa(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function jsonBlock(value) {
  return JSON.stringify(value, null, 2);
}

const httpServerConfig = { name: "ireland", type: "http", url: endpoint };
const mcpJson = { servers: { ireland: { type: "http", url: endpoint } } };
const copilotJson = { mcpServers: { ireland: { type: "http", url: endpoint } } };
const cursorConfig = { type: "http", url: endpoint };
const vscodeLink = `vscode://mcp/install?${encodeURIComponent(JSON.stringify(httpServerConfig))}`;
const vscodeInsidersLink = `vscode-insiders://mcp/install?${encodeURIComponent(JSON.stringify(httpServerConfig))}`;
const cursorLink = `cursor://anysphere.cursor-deeplink/mcp/install?name=ireland&config=${encodeURIComponent(safeBtoa(JSON.stringify(cursorConfig)))}`;

const INSTALLERS = [
  {
    id: "vscode", label: "VS Code", title: "VS Code & Insiders", body: "The current MCP install deeplink is a URL-encoded JSON object with name, type and url. Use either stable or Insiders.",
    actions: [{ text: "Install in VS Code", href: vscodeLink }, { text: "Install in Insiders", href: vscodeInsidersLink }], copy: jsonBlock(httpServerConfig), code: `${vscodeLink}\n\n${vscodeInsidersLink}`
  },
  {
    id: "cursor", label: "Cursor", title: "Cursor One-Click Install", body: "Cursor accepts a base64-encoded MCP server config on its anysphere.cursor-deeplink URL scheme.",
    actions: [{ text: "Install in Cursor", href: cursorLink }], copy: cursorLink, code: cursorLink
  },
  {
    id: "claude", label: "Claude", title: "Claude Web & Claude Code", body: "For claude.ai, add a custom connector with no authentication and paste the endpoint. For Claude Code, run the command below.",
    copy: `claude mcp add --transport http ireland ${endpoint}`,
    code: `claude mcp add --transport http ireland ${endpoint}\n\nclaude.ai → Settings → Connectors → Add custom connector\nName: Ireland MCP\nURL: ${endpoint}\nAuthentication: None`
  },
  {
    id: "chatgpt", label: "ChatGPT", title: "ChatGPT Developer Mode Connector", body: "Enable Developer Mode connectors, create a new MCP connector, choose no authentication and paste the endpoint. Availability depends on plan and region.",
    copy: endpoint, code: `Settings → Apps & Connectors → Advanced → Developer Mode\nCreate MCP connector\nName: Ireland MCP\nURL: ${endpoint}\nAuthentication: None\nRecommended tools: search, fetch, ireland_catalogue, ireland_call`
  },
  {
    id: "copilot", label: "Copilot CLI", title: "Copilot CLI", body: "Use the slash command when available, or save the JSON snippet to ~/.copilot/mcp-config.json.",
    copy: `/mcp add ireland ${endpoint}`,
    code: `/mcp add ireland ${endpoint}\n\n${jsonBlock(copilotJson)}`
  },
  {
    id: "gemini", label: "Gemini CLI", title: "Gemini CLI", body: "Add Ireland MCP to your Gemini CLI MCP servers using HTTP transport.",
    copy: jsonBlock(copilotJson), code: jsonBlock({ mcpServers: { ireland: { httpUrl: endpoint } } })
  },
  {
    id: "windsurf", label: "Windsurf", title: "Windsurf", body: "Open MCP settings, add a custom server named ireland, choose HTTP transport and paste the endpoint.",
    copy: jsonBlock(copilotJson), code: jsonBlock(copilotJson)
  },
  {
    id: "generic", label: "Generic JSON", title: "Generic MCP JSON", body: "Use this for agents that accept a project-level .mcp.json or MCP server map.",
    copy: jsonBlock(mcpJson), code: jsonBlock(mcpJson)
  }
];

function renderInstallers() {
  const tabs = document.querySelector(".install-tabs");
  const panel = $("install-panel");
  tabs.replaceChildren(...INSTALLERS.map((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.id = `tab-${item.id}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", "install-panel");
    button.setAttribute("aria-selected", String(index === 0));
    button.textContent = item.label;
    button.addEventListener("click", () => selectInstaller(item.id));
    return button;
  }));
  function selectInstaller(id) {
    const item = INSTALLERS.find((entry) => entry.id === id) || INSTALLERS[0];
    for (const button of tabs.querySelectorAll("button")) button.setAttribute("aria-selected", String(button.id === `tab-${item.id}`));
    panel.innerHTML = "";
    const title = document.createElement("h3");
    title.textContent = item.title;
    const body = document.createElement("p");
    body.textContent = item.body;
    const actions = document.createElement("div");
    actions.className = "install-actions";
    for (const action of item.actions || []) {
      const link = document.createElement("a");
      link.className = "btn primary";
      link.href = action.href;
      link.textContent = action.text;
      actions.append(link);
    }
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "btn secondary";
    copy.textContent = "Copy Config";
    copy.dataset.copy = item.copy;
    actions.append(copy);
    const pre = document.createElement("pre");
    pre.tabIndex = 0;
    const code = document.createElement("code");
    code.textContent = item.code;
    pre.append(code);
    panel.append(title, body, actions, pre);
  }
  selectInstaller(INSTALLERS[0].id);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-100vw";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  $("copy-status").textContent = "Copied.";
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-copy], [data-copy-endpoint]");
  if (!target) return;
  copyText(target.dataset.copy || endpoint);
});

function normaliseCatalogue(result) {
  const contentText = result?.content?.find?.((item) => item.type === "text")?.text;
  if (result?.structuredContent?.domains) return result.structuredContent.domains;
  if (contentText) {
    try { return JSON.parse(contentText).domains || SOURCE_FALLBACK; } catch { return SOURCE_FALLBACK; }
  }
  return SOURCE_FALLBACK;
}

function renderSources(domains) {
  const directory = $("source-directory");
  directory.replaceChildren(...domains.map((group) => {
    const section = document.createElement("section");
    section.className = "domain-group";
    section.setAttribute("aria-labelledby", `domain-${group.domain.replace(/[^a-z0-9]+/gi, "-")}`);
    const heading = document.createElement("h3");
    heading.id = `domain-${group.domain.replace(/[^a-z0-9]+/gi, "-")}`;
    heading.textContent = group.domain;
    const grid = document.createElement("div");
    grid.className = "source-grid";
    grid.append(...(group.sources || []).map((source) => {
      const details = SOURCE_DETAILS[source.id] || { licence: "Publisher licence", example: "Ask an evidence-backed question." };
      const article = document.createElement("article");
      article.className = "source-card";
      const h = document.createElement("h4");
      h.textContent = source.name;
      const summary = document.createElement("p");
      summary.textContent = source.summary || "Public Irish dataset exposed through Ireland MCP.";
      const meta = document.createElement("div");
      meta.className = "source-meta";
      const ops = document.createElement("span");
      ops.textContent = `${source.operations?.length || 0} ops`;
      const licence = document.createElement("span");
      licence.textContent = details.licence;
      meta.append(ops, licence);
      const example = document.createElement("p");
      example.className = "example";
      example.textContent = `“${details.example}”`;
      article.append(h, summary, meta, example);
      return article;
    }));
    section.append(heading, grid);
    return section;
  }));
}

function renderExamples() {
  const select = $("example-select");
  select.replaceChildren(...EXAMPLES.map((example, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = example.question;
    return option;
  }));
  function apply() {
    const example = EXAMPLES[Number(select.value)] || EXAMPLES[0];
    $("pg-source").value = example.source;
    $("pg-operation").value = example.operation;
    $("pg-args").value = jsonBlock(example.args);
  }
  select.addEventListener("change", apply);
  apply();
}

function payloadFromToolResult(result) {
  const payload = result?.structuredContent ?? result?.content?.map?.((item) => item.text || "").join("\n") ?? result;
  if (typeof payload !== "string") return jsonBlock(payload);
  try { return jsonBlock(JSON.parse(payload)); } catch { return payload; }
}

async function initLiveStats() {
  try {
    const [tools, catalogue] = await Promise.all([
      rpc("tools/list", {}),
      rpc("tools/call", { name: "ireland_catalogue", arguments: {} })
    ]);
    const domains = normaliseCatalogue(catalogue);
    const sourceCount = domains.reduce((sum, group) => sum + (group.sources?.length || 0), 0);
    $("stat-sources").textContent = new Intl.NumberFormat("en-IE").format(sourceCount);
    $("stat-ops").textContent = new Intl.NumberFormat("en-IE").format(tools.tools?.length || 7);
    $("live-label").textContent = "Live Server Online";
    renderSources(domains);
  } catch {
    $("live-label").textContent = "Using Static Fallback";
    document.querySelector(".live-dot")?.classList.add("down");
    renderSources(SOURCE_FALLBACK);
  }
}

async function initStatus() {
  const card = $("status-card");
  try {
    const response = await fetch(STATUS_URL, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const status = await response.json();
    const checked = status.checked_at ? new Intl.DateTimeFormat("en-IE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(status.checked_at)) : "unknown time";
    const ok = status.status === "ok";
    const sources = Array.isArray(status.sources) ? status.sources : [];
    card.innerHTML = "";
    const main = document.createElement("div");
    main.className = "status-main";
    const strong = document.createElement("strong");
    strong.className = ok ? "status-ok" : "status-bad";
    strong.textContent = ok ? "All monitored sources healthy" : `Status: ${status.status || "unknown"}`;
    const time = document.createElement("span");
    time.className = "muted";
    time.textContent = `Checked ${checked}`;
    main.append(strong, time);
    const list = document.createElement("div");
    list.className = "status-sources";
    list.append(...sources.slice(0, 18).map((source) => {
      const pill = document.createElement("span");
      pill.textContent = `${source.source}: ${source.status}${typeof source.latencyMs === "number" ? ` · ${source.latencyMs} ms` : ""}`;
      return pill;
    }));
    card.append(main, list);
  } catch (error) {
    card.textContent = `Status feed unavailable. Check GitHub status branch. ${error instanceof Error ? error.message : ""}`;
  }
}

$("playground-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("pg-status");
  const output = $("pg-output");
  let args;
  try { args = JSON.parse($("pg-args").value || "{}"); } catch { output.textContent = "Arguments must be valid JSON."; output.classList.add("error"); return; }
  status.textContent = "Running…";
  output.classList.remove("error");
  const started = performance.now();
  try {
    const result = await rpc("tools/call", { name: "ireland_call", arguments: { source: $("pg-source").value.trim(), operation: $("pg-operation").value.trim(), args, limit: 5, max_tokens: 1400 } });
    output.textContent = payloadFromToolResult(result);
    output.classList.toggle("error", Boolean(result?.isError));
    status.textContent = `${new Intl.NumberFormat("en-IE").format(Math.round(performance.now() - started))} ms`;
  } catch (error) {
    output.textContent = error instanceof Error ? error.message : String(error);
    output.classList.add("error");
    status.textContent = "";
  }
});

const WORDS = ["Dáil", "Seanad", "Éireann", "Oireachtas", "census", "CSO", "PxStat", "Met Éireann", "Luas", "DART", "GTFS", "county", "constituency", "townland", "statute", "housing", "planning", "climate", "population", "rainfall", "Gaeltacht", "property", "data.gov.ie", "GeoHive", "licence", "CC BY 4.0", "Corcaigh", "Gaillimh"];
const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
let motionPaused = false;
const video = $("hero-video");
function syncVideo() {
  if (!video) return;
  if (motionQuery.matches || motionPaused) video.pause();
  else video.play().catch(() => undefined);
}
motionQuery.addEventListener("change", syncVideo);
syncVideo();

function canAnimate() {
  const lowPower = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory ?? 8) <= 4;
  return !motionPaused && !motionQuery.matches && !navigator.connection?.saveData && !lowPower && innerWidth >= 768 && !matchMedia("(pointer: coarse)").matches;
}

function startTextRain() {
  const canvas = $("text-rain");
  const ctx = canvas?.getContext("2d");
  if (!ctx) return;
  const size = 13;
  let width = 0, height = 0, drops = [], frame = 0, running = false;
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
  const init = () => {
    width = canvas.width = innerWidth;
    height = canvas.height = innerHeight;
    const columns = Math.max(8, Math.min(24, Math.ceil(width / (size * 8))));
    drops = Array.from({ length: columns }, () => ({ y: Math.random() * -60, speed: 0.35 + Math.random() * 0.9, word: pick() }));
  };
  const draw = () => {
    ctx.fillStyle = "rgba(7, 17, 14, 0.12)";
    ctx.fillRect(0, 0, width, height);
    ctx.font = `${size}px ui-monospace, monospace`;
    drops.forEach((drop, index) => {
      ctx.fillStyle = drop.speed > 1.1 ? "#9ef7c6" : "rgba(52, 192, 138, 0.62)";
      ctx.fillText(drop.word, index * size * 6 + size, drop.y * size);
      if (drop.y * size > height && Math.random() > 0.975) Object.assign(drop, { y: 0, speed: 0.5 + Math.random() * 1.5, word: pick() });
      drop.y += drop.speed;
    });
  };
  const loop = () => {
    if (!running) return;
    if (!document.hidden && ++frame % 4 === 0) draw();
    requestAnimationFrame(loop);
  };
  const update = () => {
    const ok = canAnimate();
    canvas.hidden = !ok;
    if (ok) init();
    if (ok && !running) { running = true; requestAnimationFrame(loop); }
    if (!ok) running = false;
  };
  addEventListener("resize", update);
  motionQuery.addEventListener("change", update);
  update();
}

renderInstallers();
renderExamples();
initLiveStats();
initStatus();
startTextRain();
const motionToggle = $("motion-toggle");
motionToggle?.addEventListener("click", () => {
  motionPaused = !motionPaused;
  motionToggle.setAttribute("aria-pressed", String(motionPaused));
  motionToggle.textContent = motionPaused ? "Resume Motion" : "Pause Motion";
  syncVideo();
  motionQuery.dispatchEvent(new Event("change"));
});
