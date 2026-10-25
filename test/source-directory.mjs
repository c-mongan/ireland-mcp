import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

// Exercise the production directory renderer without a browser or network dependency.
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.textContent = ""; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
}
const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
const counts = JSON.parse(readFileSync(new URL("../docs/counts.json", import.meta.url), "utf8"));
const data = app.slice(app.indexOf("const SOURCE_FALLBACK ="), app.indexOf("const EXAMPLES ="));
const renderer = app.slice(app.indexOf("function normaliseCatalogue("), app.indexOf("function renderExamples("));
function render(domains) {
  const nodes = { "source-directory": new Element("div"), "source-nav": new Element("nav") };
  runInNewContext(`${data}\n${renderer}\nrenderSources(domains ?? normaliseCatalogue(undefined));`, {
    domains, document: { createElement: (tag) => new Element(tag) }, $: (id) => nodes[id]
  });
  return nodes["source-directory"].children.flatMap((group) => group.children[1].children);
}
const contents = (node) => [node.textContent, ...node.children.map(contents)].join(" ");

test("the static directory keeps the default source profile when legal availability is unknown", () => {
  const cards = render();
  assert.equal(cards.length, counts.sources + 1, "default sources plus the cross-source combiner");
  for (const name of ["SIPO Register of Lobbying", "PayGap.ie employer reports", "Council budgets"]) {
    assert.ok(cards.some((card) => contents(card).includes(name)), `Missing civic source ${name}`);
  }
  for (const name of ["Fáilte Ireland", "NaPTAN", "Geological Survey Ireland", "Logainm"]) assert.ok(cards.some(card => contents(card).includes(name)), `${name} is discoverable in the static fallback`);
  assert.ok(cards.every((card) => !/optional pilot/i.test(contents(card))));
});

test("advertised legal cards identify the optional pilot and preserve coverage and permission limits", () => {
  const cards = render([{ domain: "law/politics", sources: [
    { id: "irish-legal", name: "Irish legal evidence corpus", summary: "Stored legal evidence", operations: ["irish_legal_search"] },
    { id: "citizens-info", name: "Citizens Information", summary: "Indexed guidance", operations: ["citizens_info_search"] }
  ] }]);
  assert.equal(cards.length, 2);
  const legal = contents(cards[0]);
  const guidance = contents(cards[1]);
  assert.match(legal, /optional pilot/i);
  assert.match(legal, /permission/i);
  assert.match(legal, /current law/i);
  assert.match(guidance, /optional pilot/i);
  assert.match(guidance, /third-party material excluded/i);
  assert.match(guidance, /guidance/i);
});
