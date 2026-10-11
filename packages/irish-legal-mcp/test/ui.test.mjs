import { test } from 'node:test';
import assert from 'node:assert/strict';

// Exercise the actual browser module without a socket or browser dependency.
class Element {
  constructor(properties = {}) { Object.assign(this, { disabled: false, hidden: false, value: '', children: [], attributes: {}, listeners: {} }, properties); }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  async emit(type) { for (const listener of this.listeners[type] ?? []) await listener({ preventDefault() {} }); }
  setAttribute(name, value) { this.attributes[name] = value; }
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); }
  focus() {}
  scrollIntoView(options) { this.scrollOptions = options; }
}

let moduleCount = 0;
async function withUI(run, { reducedMotion = false } = {}) {
  const nodes = Object.fromEntries(['chat-form', 'question', 'status', 'results', 'token', 'as-of', 'ask', 'answer', 'answer-kind', 'warnings', 'citations'].map(id => [id, new Element()]));
  Object.assign(nodes.question, { name: 'question', value: 'annual leave' });
  Object.assign(nodes['as-of'], { name: 'as_of', value: '2025-01-01' });
  const modes = [new Element({ name: 'mode', value: 'citizen', checked: true }), new Element({ name: 'mode', value: 'lawyer', checked: false })];
  const examples = [new Element({ dataset: { question: 'working time' } })];
  const controls = [...modes, nodes.question, nodes['as-of'], nodes.ask, nodes.token];
  nodes['chat-form'].reportValidity = () => true;
  nodes['chat-form'].querySelectorAll = () => controls;
  const answer = { answer: 'Evidence for annual leave', generation: 'extractive', warnings: [], citations: [], supporting_quotes: [] };
  const requests = [];
  let chatResponse = async () => ({ ok: true, json: async () => answer });
  const replacements = {
    document: { querySelector: selector => nodes[selector.slice(1)], querySelectorAll: selector => selector === '[data-question]' ? examples : modes.concat(nodes['as-of']), createElement: () => new Element() },
    FormData: class {
      constructor() { this.values = new Map(controls.filter(control => control.name && !control.disabled && (control.name !== 'mode' || control.checked)).map(control => [control.name, control.value])); }
      get(name) { return this.values.get(name) ?? null; }
    },
    fetch: async (url, options) => {
      if (url.pathname.endsWith('api/status')) return { ok: true, json: async () => ({ document_count: 4 }) };
      requests.push(JSON.parse(options.body));
      return chatResponse();
    },
    matchMedia: query => ({ matches: reducedMotion && query === '(prefers-reduced-motion: reduce)' })
  };
  const original = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  try {
    await import(new URL(`../ui/app.mjs?ui-test=${++moduleCount}`, import.meta.url));
    await run({ nodes, controls, examples, modes, requests, respond: callback => { chatResponse = callback; }, submit: () => nodes['chat-form'].emit('submit') });
  } finally {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test('pending chat freezes question controls and hides previous evidence until completion', async () => {
  await withUI(async ({ nodes, controls, examples, requests, respond, submit }) => {
    await submit();
    assert.equal(nodes.results.hidden, false);
    let complete;
    respond(() => new Promise(resolve => { complete = resolve; }));
    const pending = submit();
    try {
      assert.ok(controls.concat(examples).every(control => control.disabled));
      assert.equal(nodes.results.hidden, true);
      assert.equal(nodes.results.attributes['aria-busy'], 'true');
      assert.deepEqual(requests[1], { question: 'annual leave', mode: 'citizen', as_of: '2025-01-01' });
    } finally {
      complete({ ok: true, json: async () => ({ answer: 'Replacement evidence', generation: 'extractive', warnings: [], citations: [], supporting_quotes: [] }) });
      await pending;
    }
    assert.ok(controls.concat(examples).every(control => !control.disabled));
    assert.equal(nodes.results.hidden, false);
    assert.equal(nodes.answer.textContent, 'Replacement evidence');
    assert.equal(nodes.results.attributes['aria-busy'], 'false');
  });
});

test('failed chat keeps previous evidence hidden and restores question controls', async () => {
  await withUI(async ({ nodes, controls, examples, respond, submit }) => {
    await submit();
    respond(async () => ({ ok: false, json: async () => ({ error: 'Unable to retrieve evidence.' }) }));
    await submit();
    assert.equal(nodes.results.hidden, true);
    assert.equal(nodes.status.textContent, 'Unable to retrieve evidence.');
    assert.ok(controls.concat(examples).every(control => !control.disabled));
  });
});

test('editing a question or selecting an example hides evidence for the previous question', async () => {
  await withUI(async ({ nodes, examples, submit }) => {
    await submit();
    await nodes['chat-form'].emit('input');
    assert.equal(nodes.results.hidden, true);
    await submit();
    await examples[0].emit('click');
    assert.equal(nodes.question.value, 'working time');
    assert.equal(nodes.results.hidden, true);
  });
});

for (const reducedMotion of [true, false]) test(`results scroll ${reducedMotion ? 'without animation for reduced motion' : 'smoothly by default'}`, async () => {
  await withUI(async ({ nodes, submit }) => {
    await submit();
    assert.deepEqual(nodes.results.scrollOptions, { behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  }, { reducedMotion });
});
