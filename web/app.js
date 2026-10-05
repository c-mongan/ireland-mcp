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

// Background motion, ported from the Search Ireland site. Skipped for reduced motion, data saver, touch and small or low-power devices.
const WORDS = [
  "Dáil", "Seanad", "Éireann", "Oireachtas", "Taoiseach", "census", "CSO", "PxStat", "Met Éireann", "forecast",
  "Luas", "DART", "GTFS", "county", "constituency", "townland", "Bunreacht", "statute", "Act", "section",
  "housing", "planning", "climate", "budget", "population", "rainfall", "Gaeltacht", "electoral", "division",
  "property", "price", "data.gov.ie", "GeoHive", "Smart Dublin", "licence", "CC BY 4.0", "Corcaigh", "Gaillimh"
];

const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
const video = $("hero-video");
const syncVideo = () => {
  if (!video) return;
  if (motionQuery.matches) video.pause();
  else video.play().catch(() => {});
};
syncVideo();
motionQuery.addEventListener("change", syncVideo);

function canAnimate() {
  const lowPower = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory ?? 8) <= 4;
  return !motionQuery.matches && !navigator.connection?.saveData && !lowPower
    && innerWidth >= 768 && !matchMedia("(pointer: coarse)").matches;
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
    ctx.fillStyle = "rgba(10, 15, 26, 0.1)";
    ctx.fillRect(0, 0, width, height);
    ctx.font = `${size}px ui-monospace, monospace`;
    drops.forEach((d, i) => {
      ctx.fillStyle = Math.random() > 0.9992 ? "#fff" : d.speed > 1.2 ? "#22d3ee" : d.speed > 0.8 ? "#06b6d4" : "rgba(45, 212, 191, 0.45)";
      ctx.fillText(d.word, i * size * 6 + size, d.y * size);
      if (d.y * size > height && Math.random() > 0.975) Object.assign(d, { y: 0, speed: 0.5 + Math.random() * 1.5, word: pick() });
      d.y += d.speed;
    });
  };
  const loop = () => {
    if (!running) return;
    if (!document.hidden && ++frame % 4 === 0) draw();
    requestAnimationFrame(loop);
  };
  // Re-check eligibility whenever the viewport or motion preference changes; stop drawing entirely when not eligible.
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
startTextRain();

// Live status pill: checks the hosted endpoint from the page's meta tag, not the user-editable Try It field.
(async () => {
  const pill = $("live-pill"), text = $("live-text");
  const endpoint = meta || (local ? `${location.origin}/mcp` : "");
  if (!pill || !endpoint) return;
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 8000);
    const res = await fetch(endpoint.replace(/\/mcp\/?$/, "/healthz"), { signal: controller.signal });
    const body = await res.json();
    if (!res.ok || body.status !== "ok") throw new Error(String(res.status));
    text.textContent = `Live now · ${body.sources?.length ?? 0} sources · no sign-up`;
  } catch {
    pill.classList.add("down");
    text.textContent = "Hosted endpoint unreachable right now — run locally with npx";
  }
})();
