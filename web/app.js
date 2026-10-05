// Ireland MCP try-it console. Stateless JSON-RPC over POST; all upstream text is rendered with textContent.
const EXAMPLES = {
  list_sources: {},
  search: { query: "housing" },
  ireland_snapshot: {},
  nearby: { lat: 53.3438, lon: -6.2546 },
  cso_search_tables: { query: "population" },
  oireachtas_search_bills: { query: "housing", limit: 5 },
  geohive_boundaries_at_point: { lat: 53.2707, lon: -9.0568 },
  met_get_forecast: { lat: 53.35, lon: -6.26, hours: 12 },
  met_get_warnings: {},
  legislation_list_acts: { year: 2024, limit: 10 },
  ppr_price_stats: { county: "Galway" }
};

const $ = (id) => document.getElementById(id);
const meta = document.querySelector('meta[name="mcp-endpoint"]')?.content?.trim();
const local = ["localhost", "127.0.0.1"].includes(location.hostname);
const initial = localStorage.getItem("ireland-mcp-endpoint") || meta || (local ? `${location.origin}/mcp` : "");
$("endpoint").value = initial;
if (meta) for (const el of document.querySelectorAll(".endpoint")) el.textContent = meta;

for (const tab of document.querySelectorAll('[role="tab"]')) {
  tab.addEventListener("click", () => {
    for (const t of document.querySelectorAll('[role="tab"]')) t.setAttribute("aria-selected", String(t === tab));
    for (const p of document.querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== tab.dataset.tab;
  });
}

let nextId = 1;
let tools = [];

async function rpc(method, params) {
  const endpoint = $("endpoint").value.trim();
  if (!/^https?:\/\//.test(endpoint)) throw new Error("Enter the MCP endpoint URL first.");
  localStorage.setItem("ireland-mcp-endpoint", endpoint);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params })
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`); }
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

function show(text, isError = false) {
  $("output").textContent = text;
  $("output").classList.toggle("error", isError);
}

function pretty(payload) {
  if (typeof payload !== "string") return JSON.stringify(payload, null, 2);
  try { return JSON.stringify(JSON.parse(payload), null, 2); } catch { return payload; }
}

function selectTool(name) {
  const tool = tools.find((t) => t.name === name);
  $("tool-desc").textContent = tool?.description ?? "";
  $("args").value = JSON.stringify(EXAMPLES[name] ?? {}, null, 2);
}

$("load").addEventListener("click", async () => {
  $("status").textContent = "Loading…";
  try {
    tools = (await rpc("tools/list", {})).tools;
    const select = $("tool");
    select.replaceChildren(...tools.map((t) => Object.assign(document.createElement("option"), { value: t.name, textContent: t.name })));
    select.value = tools.some((t) => t.name === "list_sources") ? "list_sources" : tools[0]?.name;
    selectTool(select.value);
    $("status").textContent = `${tools.length} tools`;
  } catch (error) {
    $("status").textContent = "";
    show(String(error.message ?? error), true);
  }
});
$("tool").addEventListener("change", (e) => selectTool(e.target.value));

$("try-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  let args;
  try { args = JSON.parse($("args").value || "{}"); } catch { return show("Arguments must be valid JSON.", true); }
  if (!tools.length) return show("Load tools first.", true);
  $("status").textContent = "Running…";
  const started = performance.now();
  try {
    const result = await rpc("tools/call", { name: $("tool").value, arguments: args });
    const payload = result.structuredContent ?? result.content?.map((c) => c.text ?? "").join("\n");
    show(pretty(payload), Boolean(result.isError));
    $("status").textContent = `${Math.round(performance.now() - started)} ms`;
  } catch (error) {
    $("status").textContent = "";
    show(String(error.message ?? error), true);
  }
});
