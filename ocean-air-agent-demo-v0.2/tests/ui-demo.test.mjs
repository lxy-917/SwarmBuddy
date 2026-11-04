import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8');

// Dependency-free DOM test double for state transitions. Real layout is checked in-browser.
function setup() {
  const nodes = new Map();
  const downloads = [];
  const documentEvents = new Map();
  class Node {
    constructor(className = '') {
      this.textContent = '';
      this.value = '';
      this.hidden = false;
      this.disabled = false;
      this.attributes = {};
      this.events = new Map();
      this.style = { setProperty(key, value) { this[key] = value; } };
      const classes = new Set(className.split(' ').filter(Boolean));
      this.classList = {
        add: (...values) => values.forEach((value) => classes.add(value)),
        remove: (...values) => values.forEach((value) => classes.delete(value)),
        contains: (value) => classes.has(value),
        toggle: (value, force) => {
          const enabled = force ?? !classes.has(value);
          enabled ? classes.add(value) : classes.delete(value);
          return enabled;
        }
      };
    }
    set innerHTML(value) {
      this.markup = value;
      for (const match of value.matchAll(/id="([^"]+)"/g)) nodes.set('#' + match[1], new Node());
    }
    get innerHTML() { return this.markup || ''; }
    addEventListener(event, handler) { this.events.set(event, handler); }
    setAttribute(key, value) { this.attributes[key] = value; }
    replaceChildren(...children) { this.textContent = children.map((child) => child.textContent).join(''); }
    querySelector(selector) { return this.children[selector]; }
    focus() { this.focused = true; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    append() {}
    click() { downloads.push({ href: this.href, filename: this.download }); }
    remove() {}
    getTotalLength() { return 100; }
    getPointAtLength(length) { return { x: length, y: 50 }; }
  }
  for (const match of html.matchAll(/id="([^"]+)"/g)) nodes.set('#' + match[1], new Node());
  nodes.set('.result-panel', new Node('result-panel panel'));
  nodes.set('.map-legend', new Node());
  nodes.set('#mapLiveStatus span', new Node());
  nodes.get('#userMessage').textContent = '请对目标海域进行二维扫描，避开岛礁。';
  nodes.get('#completionTitle').textContent = '执行完成';
  nodes.get('#mapMode').value = 'route';
  nodes.get('#mapFrame').classList.add('map-frame');
  const steps = Array.from({ length: 3 }, () => {
    const step = new Node('trace-step done');
    step.children = { '.step-check': new Node() };
    return step;
  });
  const routes = Array.from({ length: 4 }, () => new Node('scan-path'));
  const nav = [...html.matchAll(/data-view="([^"]+)"/g)].map((match) => {
    const node = new Node();
    node.dataset = { view: match[1] };
    return node;
  });
  const blobs = [];
  const context = vm.createContext({
    document: {
      querySelector(selector) {
        assert.ok(nodes.has(selector), 'Missing DOM selector: ' + selector);
        return nodes.get(selector);
      },
      querySelectorAll(selector) {
        return { '.trace-step': steps, '.scan-path': routes, '[data-view]': nav }[selector] || [];
      },
      addEventListener(event, handler) { documentEvents.set(event, handler); },
      createTextNode: (textContent) => ({ textContent }),
      createElement: () => new Node(),
      body: new Node()
    },
    window: {
      matchMedia: () => ({ matches: true }),
      setTimeout(handler, ms) {
        const timer = setTimeout(handler, ms < 1000 ? 0 : 1000);
        if (ms >= 1000) timer.unref();
        return timer;
      },
      clearTimeout,
      requestAnimationFrame: (handler) => setTimeout(() => handler(performance.now()), 0)
    },
    console, performance, Blob, Date,
    URL: { createObjectURL: (blob) => { blobs.push(blob); return 'blob:local-demo'; }, revokeObjectURL() {} }
  });
  vm.runInContext(script, context);
  return { context, nodes, steps, routes, nav, documentEvents, downloads, blobs };
}

test('brand and all local page assets resolve', () => {
  assert.match(html, /海空跨域无人集群<\/span> <b>Agent<\/b>/);
  assert.doesNotMatch(html, /WorkBuddy/);
  for (const [, path] of html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)) {
    assert.ok(existsSync(fileURLToPath(new URL(path, new URL('../app/index.html', import.meta.url)))), path);
  }
});

test('replay completes all stages, restores controls and shows full paths', async () => {
  const { context, nodes, steps, routes } = setup();
  const execution = context.runMission('扫描东部海域');
  assert.equal(nodes.get('#sendButton').disabled, true);
  assert.equal(nodes.get('#reportButton').disabled, true);
  await execution;
  assert.equal(nodes.get('#coverageValue').textContent, '96%');
  assert.equal(nodes.get('#coveredArea').textContent, '482.6 km²');
  assert.ok(steps.every((step) => step.classList.contains('done')));
  assert.ok(routes.every((route) => route.style.strokeDashoffset === '0'));
  for (const id of ['sendButton', 'replayButton', 'reportButton', 'missionInput']) assert.equal(nodes.get('#' + id).disabled, false);
});

test('double start cannot overwrite an in-flight prompt', async () => {
  const { context, nodes } = setup();
  const first = context.runMission('第一个任务');
  await context.runMission('重复任务');
  assert.equal(nodes.get('#userMessage').textContent, '第一个任务');
  await first;
});

test('terrain mode hides legend and replay restores route mode', async () => {
  const { context, nodes } = setup();
  nodes.get('#mapMode').events.get('change')({ target: { value: 'terrain' } });
  assert.ok(nodes.get('#mapFrame').classList.contains('terrain-only'));
  assert.equal(nodes.get('.map-legend').hidden, true);
  await context.runMission();
  assert.equal(nodes.get('#mapMode').value, 'route');
  assert.equal(nodes.get('.map-legend').hidden, false);
  assert.equal(nodes.get('#mapFrame').classList.contains('terrain-only'), false);
});

test('empty input is rejected and user markup stays plain text', async () => {
  const { context, nodes } = setup();
  nodes.get('#missionInput').value = '   ';
  nodes.get('#missionForm').events.get('submit')({ preventDefault() {} });
  assert.equal(nodes.get('#missionInput').focused, true);
  assert.equal(nodes.get('#sendButton').disabled, false);
  const prompt = '<img src=x onerror=alert(1)>';
  await context.runMission(prompt);
  assert.equal(nodes.get('#userMessage').textContent, prompt);
  assert.equal(nodes.get('#userMessage').innerHTML, '');
});

test('Escape exits expanded map and all navigation views open', () => {
  const { nodes, documentEvents, nav } = setup();
  nodes.get('#expandButton').events.get('click')();
  assert.ok(nodes.get('.result-panel').classList.contains('expanded'));
  documentEvents.get('keydown')({ key: 'Escape' });
  assert.equal(nodes.get('.result-panel').classList.contains('expanded'), false);
  for (const button of nav.filter((item) => item.dataset.view !== 'mission')) {
    button.events.get('click')();
    assert.equal(nodes.get('#detailDialog').open, true);
    assert.ok(nodes.get('#dialogTitle').textContent);
    nodes.get('#closeDialog').events.get('click')();
  }
});

test('report export contains explicit Mock designation and original prompt', async () => {
  const { context, nodes, downloads, blobs } = setup();
  await context.runMission('自定义任务');
  nodes.get('#reportButton').events.get('click')();
  assert.equal(nodes.get('#reportPrompt').textContent, '任务需求：自定义任务');
  nodes.get('#downloadReport').events.get('click')();
  assert.equal(downloads[0].filename, 'ocean-scan-demo-report.json');
  const report = JSON.parse(await blobs[0].text());
  assert.equal(report.mode, 'mock-presentation');
  assert.equal(report.prompt, '自定义任务');
  assert.equal(report.metrics.coveragePercent, 96);
});
