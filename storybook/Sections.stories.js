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
  required(section, ".playground-card h3").textContent = "Sample response";
  const output = required(section, "#pg-output");
  const status = required(section, "#pg-status");
  const states = {
    idle: ["", "Choose an example, then run it."],
    loading: ["Running sample query...", "Waiting for a sample response..."],
    success: ["120 ms (sample)", JSON.stringify({ data: { items: [{ id: "sample-population", label: "Sample population table" }] }, source: "CSO PxStat", licence: "CC BY 4.0", retrieved_at: "2026-01-01T12:00:00Z" }, null, 2)],
    empty: ["120 ms (sample)", JSON.stringify({ data: { items: [] }, source: "CSO PxStat" }, null, 2)],
    error: ["Query failed. You can try again.", "Sample error: The source is temporarily unavailable. Please try again."]
  };
  if (!states[state]) throw new Error(`Unknown playground fixture state: ${state}`);
  [status.textContent, output.textContent] = states[state];
  output.classList.toggle("error", state === "error");
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
  for (const element of section.querySelectorAll("button, input, textarea, select")) element.disabled = true;
  for (const link of section.querySelectorAll("a")) {
    link.removeAttribute("href");
    link.setAttribute("aria-disabled", "true");
  }
  const frame = document.createElement("iframe");
  frame.title = "Ireland MCP section preview";
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.style.cssText = "display:block;width:100%;border:0;min-height:100px;";
  frame.srcdoc = `<!doctype html><html lang="en-IE" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'"><style>${siteCss}\n${demoCss}</style></head><body><p class="wrap" role="note">Storybook fixture: fixed sample data; live queries, installation links, copy actions and video are disabled.</p>${section.outerHTML}</body></html>`;
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
  parameters: { layout: "fullscreen" },
  argTypes: {
    theme: { control: "radio", options: ["dark", "light"] },
    section: { control: false },
    state: { control: false }
  }
};

export const HeroDark = { args: { section: "top", theme: "dark" } };
export const HeroLight = { args: { section: "top", theme: "light" } };
export const InstallerDark = { args: { section: "install", theme: "dark" } };
export const InstallerLight = { args: { section: "install", theme: "light" } };
export const DirectoryDark = { args: { section: "directory", theme: "dark" } };
export const DirectoryLight = { args: { section: "directory", theme: "light" } };
export const PlaygroundIdleDark = { args: { section: "playground", state: "idle", theme: "dark" } };
export const PlaygroundIdleLight = { args: { section: "playground", state: "idle", theme: "light" } };
export const PlaygroundLoadingDark = { args: { section: "playground", state: "loading", theme: "dark" } };
export const PlaygroundLoadingLight = { args: { section: "playground", state: "loading", theme: "light" } };
export const PlaygroundSuccessDark = { args: { section: "playground", state: "success", theme: "dark" } };
export const PlaygroundSuccessLight = { args: { section: "playground", state: "success", theme: "light" } };
export const PlaygroundEmptyDark = { args: { section: "playground", state: "empty", theme: "dark" } };
export const PlaygroundEmptyLight = { args: { section: "playground", state: "empty", theme: "light" } };
export const PlaygroundErrorDark = { args: { section: "playground", state: "error", theme: "dark" } };
export const PlaygroundErrorLight = { args: { section: "playground", state: "error", theme: "light" } };
