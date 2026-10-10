import { useEffect } from "storybook/preview-api";
import pageHtml from "../web/index.html?raw";
import siteCss from "../web/styles.css?raw";
import demoCss from "./demo.css?raw";

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
  required(section, "#example-select").innerHTML = '<option>Sample CSO population search</option>';
  required(section, "#pg-source").setAttribute("value", "cso");
  required(section, "#pg-operation").setAttribute("value", "cso_search_tables");
  required(section, "#pg-args").textContent = JSON.stringify({ query: "population", limit: 5 }, null, 2);
  required(section, 'button[type="submit"]').textContent = "Sample query (disabled)";
  required(section, "#response-title").textContent = "Sample response";
  const output = required(section, "#pg-output");
  const status = required(section, "#pg-status");
  const states = {
    idle: ["", "Choose an example, then run it."],
    loading: ["Running sample query...", "Waiting for a sample response..."],
    success: ["120 ms (sample)", JSON.stringify({ data: { items: [{ id: "sample-population", label: "Sample population table" }] }, source: "CSO PxStat", licence: "CC BY 4.0", retrieved_at: "2026-01-01T12:00:00Z" }, null, 2)],
    empty: ["120 ms (sample)", JSON.stringify({ data: { items: [] }, source: "CSO PxStat" }, null, 2)],
    truncated: ["120 ms (sample)", JSON.stringify({ data: { items: Array.from({ length: 12 }, (_, index) => ({ id: `sample-${index + 1}`, label: `Sample table ${index + 1}`, description: "A long sample description tests response wrapping without live provider data." })) }, source: "CSO PxStat", truncated: true, total: 250, retrieved_at: "2026-01-01T12:00:00Z" }, null, 2)],
    error: ["Query failed. You can try again.", "Sample error: The source is temporarily unavailable. Please try again."]
  };
  if (!states[state]) throw new Error(`Unknown playground fixture state: ${state}`);
  [status.textContent, output.textContent] = states[state];
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

function render({ section: sectionId, theme, state }) {
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
    link.removeAttribute("href");
    link.setAttribute("aria-disabled", "true");
  }
  const frame = document.createElement("iframe");
  frame.title = "Ireland MCP section preview";
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.style.cssText = "display:block;width:100%;border:0;min-height:100px;";
  frame.srcdoc = `<!doctype html><html lang="en-IE" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'"><style>${siteCss}\n${demoCss}</style></head><body><p class="wrap" role="note">Storybook fixture: fixed sample data; live queries, installation links, copy actions and video are disabled.</p><main>${section.outerHTML}</main></body></html>`;
  let observer;
  const resize = () => {
    if (frame.contentDocument?.body) {
      frame.style.height = `${Math.ceil(frame.contentDocument.body.getBoundingClientRect().height) + 32}px`;
    }
  };
  const loaded = () => {
    resize();
    observer?.disconnect();
    observer = new ResizeObserver(resize);
    observer.observe(frame.contentDocument.body);
  };
  frame.addEventListener("load", loaded);
  useEffect(() => () => {
    frame.removeEventListener("load", loaded);
    observer?.disconnect();
  }, [frame]);
  return frame;
}

export default {
  title: "Ireland MCP/Sections",
  render,
  parameters: { layout: "fullscreen", chromatic: { viewports: [1280] } },
  argTypes: {
    theme: { control: "radio", options: ["dark", "light"] },
    section: { control: false },
    state: { control: false }
  }
};

export const HeroDark = { args: { section: "top", theme: "dark" }, parameters: { chromatic: { viewports: [360, 1280] } } };
export const HeroLight = { args: { section: "top", theme: "light" }, parameters: { chromatic: { viewports: [360, 1280] } } };
export const InstallerDark = { args: { section: "install", theme: "dark" } };
export const InstallerLight = { args: { section: "install", theme: "light" } };
export const DirectoryDark = { args: { section: "directory", theme: "dark" } };
export const DirectoryLight = { args: { section: "directory", theme: "light" } };
export const PlaygroundIdleDark = { args: { section: "playground", state: "idle", theme: "dark" } };
export const PlaygroundIdleLight = { args: { section: "playground", state: "idle", theme: "light" } };
export const PlaygroundLoadingDark = { args: { section: "playground", state: "loading", theme: "dark" } };
export const PlaygroundLoadingLight = { args: { section: "playground", state: "loading", theme: "light" } };
export const PlaygroundSuccessDark = { args: { section: "playground", state: "success", theme: "dark" }, parameters: { chromatic: { viewports: [360, 1280] } } };
export const PlaygroundSuccessLight = { args: { section: "playground", state: "success", theme: "light" }, parameters: { chromatic: { viewports: [360, 1280] } } };
export const PlaygroundEmptyDark = { args: { section: "playground", state: "empty", theme: "dark" } };
export const PlaygroundEmptyLight = { args: { section: "playground", state: "empty", theme: "light" } };
export const PlaygroundErrorDark = { args: { section: "playground", state: "error", theme: "dark" } };
export const PlaygroundErrorLight = { args: { section: "playground", state: "error", theme: "light" } };

export const PlaygroundTruncatedDark = { args: { section: "playground", state: "truncated", theme: "dark" } };
export const PlaygroundTruncatedLight = { args: { section: "playground", state: "truncated", theme: "light" } };
export const StatusHealthyDark = { args: { section: "status", state: "healthy", theme: "dark" } };
export const StatusHealthyLight = { args: { section: "status", state: "healthy", theme: "light" } };
export const StatusDegradedDark = { args: { section: "status", state: "degraded", theme: "dark" } };
export const StatusDegradedLight = { args: { section: "status", state: "degraded", theme: "light" } };
export const StatusStaleDark = { args: { section: "status", state: "stale", theme: "dark" } };
export const StatusStaleLight = { args: { section: "status", state: "stale", theme: "light" } };
export const StatusLoadingDark = { args: { section: "status", state: "loading", theme: "dark" } };
export const StatusLoadingLight = { args: { section: "status", state: "loading", theme: "light" } };
export const StatusUnreachableDark = { args: { section: "status", state: "unreachable", theme: "dark" } };
export const StatusUnreachableLight = { args: { section: "status", state: "unreachable", theme: "light" } };
