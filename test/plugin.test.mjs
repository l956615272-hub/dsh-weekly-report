import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';

import { apply as hostApply, inject as hostInject, BASE } from '../lib/index.js';

function writeSession(filePath, lines) {
  const frames = lines.map((line) => zlib.zstdCompressSync(Buffer.from(line + '\n', 'utf8')));
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, Buffer.concat(frames));
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-weekly-report-plugin-'));
  const home = join(root, 'home');
  const workspacePath = join(root, 'workspace');
  mkdirSync(join(home, 'sessions', '--tmp--', 'session-one'), { recursive: true });
  mkdirSync(join(home, 'storages'), { recursive: true });
  mkdirSync(workspacePath, { recursive: true });
  writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify({
    tables: { workspaces: { 'ws-1': { path: workspacePath, title: '冒烟工作区', sessionIds: [] } } }
  }));
  writeSession(join(home, 'sessions', '--tmp--', 'session-one', 'session.v4.jsonl.zstd'), [
    JSON.stringify({
      type: 'session', version: 4, id: 'session-one', createdAt: Date.parse('2026-10-09T09:00:00+08:00'),
      cwd: workspacePath, delegationDepth: 0, agentPreset: 'ptc'
    }),
    JSON.stringify({ type: 'turn/start', seq: 0, time: Date.parse('2026-10-09T09:00:00+08:00'), data: { turn: 1 } }),
    JSON.stringify({
      type: 'user/message', seq: 1, time: Date.parse('2026-10-09T09:00:00+08:00'),
      data: { id: 'u1', content: [{ type: 'text', text: '写周报' }], source: { kind: 'user' }, role: 'user' }
    }),
    JSON.stringify({
      type: 'assistant/message', seq: 2, time: Date.parse('2026-10-09T09:05:00+08:00'),
      data: { turn: 1, step: 1, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '好的' }] } }
    })
  ]);
  return { root, home, workspacePath };
}

/** Minimal (req, res) pair; POST bodies arrive as a real readable stream. */
function request(handler, url, options = {}) {
  const method = options.method || 'GET';
  return new Promise((resolve, reject) => {
    const base = { url, method, headers: {} };
    const req = options.body === undefined
      ? base
      : Object.assign(Readable.from([Buffer.from(JSON.stringify(options.body), 'utf8')]), base);
    const res = {
      status: 0,
      writeHead(status) { this.status = status; },
      end(payload) {
        let parsed = null;
        try {
          parsed = JSON.parse(payload);
        } catch { /* leave null */ }
        resolve({ status: this.status, body: parsed });
      }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function mount(home) {
  const routes = [];
  const ctx = {
    logger: { info() {}, warn() {} },
    effect: (fn) => { const disposer = fn(); return () => { if (typeof disposer === 'function') disposer(); }; },
    webServer: { register: (route) => { routes.push(route); return () => {}; } },
    sessionController: {
      calls: [],
      async create(request) {
        ctx.sessionController.calls.push({ method: 'create', request });
        return { sessionId: 'session-new' };
      },
      async prompt(request, signal) {
        ctx.sessionController.calls.push({ method: 'prompt', request, signal });
        return { accepted: true };
      }
    }
  };
  assert.deepEqual(hostInject, ['webServer', 'sessionController']);
  hostApply(ctx, { homes: [home] });
  const registered = [...routes];
  const find = (path) => registered.find((route) => route.path === path);
  return { routes: registered, route: find, sessionController: ctx.sessionController };
}

const FROM = Date.parse('2026-10-08T00:00:00+08:00');
const TO = Date.parse('2026-10-14T23:59:59+08:00');

test('host half registers every route and serves the catalog', async () => {
  const f = fixture();
  try {
    const { routes, route } = mount(f.home);
    const expected = ['/health', '/workspaces', '/repos', '/sessions', '/prompt', '/reports', '/samples', '/dispatch'].map((p) => BASE + p).sort();
    assert.deepEqual(routes.map((item) => item.path).sort(), expected);

    const response = await request(route(BASE + '/sessions').handler, BASE + '/sessions?from=' + FROM + '&to=' + TO);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.total, 1);
    assert.equal(response.body.data.groups[0].title, '冒烟工作区');
    assert.equal(response.body.data.groups[0].entries[0].windowMessages, 1);

    const bad = await request(route(BASE + '/sessions').handler, BASE + '/sessions?from=' + TO + '&to=' + FROM);
    assert.equal(bad.status, 400);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('host half builds the prompt from the selection', async () => {
  const f = fixture();
  try {
    const { route } = mount(f.home);
    const response = await request(route(BASE + '/prompt').handler, BASE + '/prompt', {
      method: 'POST',
      body: {
        from: FROM,
        to: TO,
        reportType: 'weekly',
        sessionIds: ['session-one'],
        git: { enabled: true, workspaces: [f.workspacePath], authors: ['测试者'] },
        sample: '# 我以前的周报',
        extra: '只写重点',
        origin: 'http://127.0.0.1:19399'
      }
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.reportName, '2026-W41.md');
    assert.equal(response.body.data.commands.length, 2);
    assert.match(response.body.data.prompt, /我以前的周报/);
    assert.match(response.body.data.prompt, /--ids session-one/);
    assert.match(response.body.data.prompt, /--author "测试者"/);
    assert.match(response.body.data.prompt, /save-report\.mjs/);

    const empty = await request(route(BASE + '/prompt').handler, BASE + '/prompt', {
      method: 'POST',
      body: { from: FROM, to: TO, sessionIds: ['session-missing'] }
    });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error, 'no-sessions-in-window');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('report route writes into the report library and lists it back', async () => {
  const f = fixture();
  try {
    const { route } = mount(f.home);
    const saved = await request(route(BASE + '/reports').handler, BASE + '/reports', {
      method: 'POST',
      body: { name: '2026-W41.md', markdown: '# 本周周报\n- 完成 A' }
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.data.path, join(f.home, 'dsh-weekly-report', 'reports', '2026-W41.md'));

    const listed = await request(route(BASE + '/reports').handler, BASE + '/reports');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.reports.length, 1);

    const one = await request(route(BASE + '/reports').handler, BASE + '/reports?name=2026-W41.md');
    assert.match(one.body.data.markdown, /完成 A/);

    const empty = await request(route(BASE + '/reports').handler, BASE + '/reports', { method: 'POST', body: { name: 'x.md', markdown: '   ' } });
    assert.equal(empty.status, 400);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('sample route keeps a reusable report sample library', async () => {
  const f = fixture();
  try {
    const { route } = mount(f.home);
    const saved = await request(route(BASE + '/samples').handler, BASE + '/samples', {
      method: 'POST',
      body: { name: '我的周报', markdown: '# 样例结构' }
    });
    assert.equal(saved.status, 200);
    assert.match(saved.body.data.path, /dsh-weekly-report\/samples\/我的周报\.md$/);

    const listed = await request(route(BASE + '/samples').handler, BASE + '/samples');
    assert.equal(listed.body.data.samples.length, 1);

    const one = await request(route(BASE + '/samples').handler, BASE + '/samples?name=' + encodeURIComponent('我的周报.md'));
    assert.match(one.body.data.markdown, /样例结构/);

    const empty = await request(route(BASE + '/samples').handler, BASE + '/samples', { method: 'POST', body: { markdown: '  ' } });
    assert.equal(empty.status, 400);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('dispatch route creates the session and sends the prompt through the host', async () => {
  const f = fixture();
  try {
    const { route, sessionController } = mount(f.home);
    const response = await request(route(BASE + '/dispatch').handler, BASE + '/dispatch', {
      method: 'POST',
      body: { workspaceId: 'ws-1', prompt: '周报提示词', clientTimeZone: 'Asia/Shanghai' }
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.sessionId, 'session-new');
    assert.deepEqual(sessionController.calls.map((call) => call.method), ['create', 'prompt']);
    assert.deepEqual(sessionController.calls[0].request, { workspaceId: 'ws-1' });
    assert.equal(sessionController.calls[1].request.sessionId, 'session-new');
    assert.equal(sessionController.calls[1].request.mode, 'queue');
    assert.equal(sessionController.calls[1].request.content[0].text, '周报提示词');
    assert.equal(sessionController.calls[1].request.clientTimeZone, 'Asia/Shanghai');
    // Regression: prompt() calls signal.throwIfAborted() before admitting anything.
    assert.equal(typeof sessionController.calls[1].signal?.throwIfAborted, 'function', 'prompt must receive an AbortSignal');
    assert.equal(sessionController.calls[1].signal.aborted, false);

    const empty = await request(route(BASE + '/dispatch').handler, BASE + '/dispatch', { method: 'POST', body: { prompt: '   ' } });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error, 'empty-prompt');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('browser half registers a settings section', async () => {
  let entry = null;
  globalThis.window = { __ModuleLoader__: { load: (value) => { entry = value; } } };
  await import('../lib/client.js');
  assert.ok(entry, 'client bundle must register itself');
  assert.equal(entry.id, 'dsh-weekly-report');

  const fakeReact = {
    createElement: (...args) => ({ args }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useCallback: (fn) => fn,
    useEffect: () => {},
    useMemo: (fn) => fn()
  };
  const plugin = entry.factory((name) => {
    assert.equal(name, 'react');
    return fakeReact;
  });
  assert.equal(plugin.name, 'dsh-weekly-report');
  assert.deepEqual(plugin.inject, ['slots']);

  const registrations = [];
  plugin.apply({
    get: () => null,
    inject: (deps, callback) => {
      const host = { get: () => null };
      for (const dep of deps) callback(host);
      return () => {};
    },
    slots: {
      register: (spec, component) => { registrations.push({ spec, component }); return spec; },
      inject: (slot, register) => { register(); }
    }
  });
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].spec.id, 'weekly-report');
  assert.equal(typeof registrations[0].spec.label({}), 'string');

  // Render once with stubbed hooks: this exercises the whole panel body, so a
  // broken style helper or a missing binding fails here instead of in the GUI.
  const tree = registrations[0].component({});
  assert.ok(tree, 'panel must render a tree');
  const rendered = JSON.stringify(tree);
  assert.match(rendered, /周报生成/);
  assert.match(rendered, /选择会话/);
  delete globalThis.window;
});
