import test from 'node:test';
import assert from 'node:assert/strict';

/** Minimal hook runtime: effects with unstable deps re-fire exactly like React. */
function createHooks() {
  const hooks = [];
  const MAX_ROUNDS = 10;
  let cursor = 0;
  let rounds = 0;
  let dirty = false;
  let tree = null;
  let pending = [];

  const sameDeps = (a, b) => {
    if (!a || !b || a.length !== b.length) return false;
    return a.every((value, index) => Object.is(value, b[index]));
  };

  const api = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
      const cell = hooks[index];
      return [cell.value, (next) => {
        cell.value = typeof next === 'function' ? next(cell.value) : next;
        dirty = true;
      }];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = hooks[index];
      if (!previous || !sameDeps(previous.deps, deps)) {
        hooks[index] = { deps };
        pending.push(effect);
      }
    },
    useCallback(fn, deps) {
      const index = cursor++;
      const previous = hooks[index];
      if (!previous || !sameDeps(previous.deps, deps)) hooks[index] = { value: fn, deps };
      return hooks[index].value;
    },
    useMemo(fn, deps) {
      const index = cursor++;
      const previous = hooks[index];
      if (!previous || !sameDeps(previous.deps, deps)) hooks[index] = { value: fn(), deps };
      return hooks[index].value;
    }
  };

  let props = {};
  const setProps = (next) => { props = next; };

  const render = (component) => {
    const realNow = Date.now;
    let clock = realNow();
    Date.now = () => clock;
    try {
      dirty = true;
      while (dirty && rounds < MAX_ROUNDS) {
        dirty = false;
        rounds += 1;
        clock += 1000;
        cursor = 0;
        const effects = [];
        pending = effects;
        tree = component(props);
        for (const effect of effects) effect();
      }
    } finally {
      Date.now = realNow;
    }
    return { tree, rounds };
  };

  return { api, render, setProps };
}

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function walk(node, visit) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (typeof node !== 'object') return;
  visit(node);
  walk(node.children, visit);
}

const nodesOf = (tree) => {
  const out = [];
  walk(tree, (node) => out.push(node));
  return out;
};

const textOf = (node) => {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object') return textOf(node.children);
  return '';
};

const clickable = (tree, label) => nodesOf(tree).find((node) => (
  node.props && typeof node.props.onClick === 'function' && node.children && node.children[0] === label
)) || null;

const hasText = (tree, needle) => nodesOf(tree).some((node) => textOf(node.children).includes(needle));

let bundleEntry = null;
let bundlePromise = null;

function loadBundle() {
  if (!bundlePromise) {
    globalThis.window = { __ModuleLoader__: { load: (value) => { bundleEntry = value; } } };
    bundlePromise = import('../lib/client.js').then(() => bundleEntry);
  }
  return bundlePromise;
}

async function mountPanel(options = {}) {
  const calls = [];
  const services = {
    uiWorkspace: {
      opened: [],
      openSession(sessionId) { services.uiWorkspace.opened.push(sessionId); }
    }
  };

  globalThis.fetch = async (url, requestOptions) => {
    const target = String(url);
    calls.push({ url: target, options: requestOptions });
    let payload = { ok: true, data: {} };
    if (target.includes('/sessions')) {
      payload = {
        ok: true,
        data: {
          from: 1,
          to: 2,
          generatedAt: 3,
          scanned: 1,
          total: 1,
          groups: [{
            workspaceId: 'ws-1',
            title: '示例工作区',
            entries: [{
              sessionId: 'session-a',
              title: '会话标题',
              cwd: '/tmp/ws',
              lastActivity: 1,
              windowMessages: 2,
              mergedFrom: []
            }]
          }]
        }
      };
    } else if (target.includes('/workspaces')) {
      payload = { ok: true, data: { workspaces: [{ id: 'ws-1', path: '/tmp/ws', title: '示例工作区' }], identity: null } };
    } else if (target.includes('/prompt')) {
      payload = { ok: true, data: { prompt: '提示词正文', reportName: '2026-W41.md', commands: [] } };
    } else if (target.includes('/dispatch')) {
      payload = options.dispatchError
        ? { ok: false, error: options.dispatchError }
        : { ok: true, data: { sessionId: 'session-new' } };
    } else if (target.includes('/reports')) {
      payload = { ok: true, data: { reports: [] } };
    } else if (target.includes('/samples')) {
      payload = { ok: true, data: { samples: [] } };
    }
    return { status: 200, json: async () => payload };
  };

  const entry = await loadBundle();
  const hooks = createHooks();
  const plugin = entry.factory(() => hooks.api);
  let component = null;
  const registered = [];
  plugin.apply({
    get: () => null,
    inject: (deps, callback) => {
      const host = { get: (name) => services[name] || null };
      for (const dep of deps) callback(host);
      return () => {};
    },
    slots: {
      register: (spec, value) => { component = value; registered.push(spec); return spec; },
      inject: (slot, register) => { register(); }
    }
  });
  assert.equal(registered.length, 1);
  return { hooks, component, calls, services };
}

const sessionCalls = (calls) => calls.filter((call) => call.url.includes('/dsh-weekly-report/sessions'));

/** Select the one session, generate the preview, return the preview tree. */
async function openPreviewWithSelection(context) {
  const { hooks, component } = context;
  hooks.render(component);
  await settle();
  let tree = hooks.render(component).tree;
  const sessionRow = nodesOf(tree).find((node) => (
    Array.isArray(node.children) &&
    node.children.some((child) => child && child.props && child.props.type === 'checkbox') &&
    textOf(node.children).includes('会话标题') &&
    textOf(node.children).includes('窗口内 2 条用户消息')
  ));
  assert.ok(sessionRow, 'the session row with its checkbox must render');
  sessionRow.children.find((child) => child && child.props && child.props.type === 'checkbox').props.onChange();
  tree = hooks.render(component).tree;

  const previewButton = clickable(tree, '生成提示词预览');
  assert.ok(previewButton, '生成提示词预览 must exist');
  previewButton.props.onClick();
  await settle();
  return hooks.render(component).tree;
}

test('the panel loads the catalog once, not once per render', async () => {
  const { hooks, component, calls } = await mountPanel();
  try {
    const { rounds } = hooks.render(component);
    assert.equal(
      sessionCalls(calls).length,
      1,
      'expected exactly one catalog fetch, saw ' + sessionCalls(calls).length + ' after ' + rounds + ' render rounds'
    );
    assert.ok(rounds <= 3, 'panel should settle in a couple of rounds, saw ' + rounds);
  } finally {
    delete globalThis.window;
    delete globalThis.fetch;
  }
});

test('picking another window re-fetches exactly once', async () => {
  const { hooks, component, calls } = await mountPanel();
  try {
    hooks.render(component);
    await settle();
    const before = sessionCalls(calls).length;
    const chip = clickable(hooks.render(component).tree, '上周');
    assert.ok(chip, '上周 chip must exist');
    chip.props.onClick();
    await settle();
    hooks.render(component);
    assert.equal(sessionCalls(calls).length - before, 1, 'switching preset should fetch once');
  } finally {
    delete globalThis.window;
    delete globalThis.fetch;
  }
});

test('sending asks the host to create the session and prompt it', async () => {
  const context = await mountPanel();
  const { hooks, component, calls, services } = context;
  try {
    let tree = await openPreviewWithSelection(context);
    assert.ok(hasText(tree, '提示词预览'), 'the preview view must open in place');

    const sendButton = clickable(tree, '新建会话并发送');
    assert.ok(sendButton, '新建会话并发送 must exist');
    sendButton.props.onClick();
    await settle();
    tree = hooks.render(component).tree;

    const dispatch = calls.find((call) => call.url.includes('/dispatch'));
    assert.ok(dispatch, 'the dispatch route must be called');
    const body = JSON.parse(dispatch.options.body);
    assert.equal(body.workspaceId, 'ws-1');
    assert.equal(body.prompt, '提示词正文');
    assert.deepEqual(services.uiWorkspace.opened, ['session-new'], 'navigation should follow the new session');
    assert.ok(hasText(tree, '已新建会话并发送提示词'), 'success must be reported in the panel');
  } finally {
    delete globalThis.window;
    delete globalThis.fetch;
  }
});

test('a successful send closes the settings panel', async () => {
  const context = await mountPanel();
  const { hooks } = context;
  const closed = [];
  hooks.setProps({ close: () => closed.push('closed') });
  try {
    const tree = await openPreviewWithSelection(context);
    clickable(tree, '新建会话并发送').props.onClick();
    await settle();
    assert.deepEqual(closed, ['closed'], 'the panel must be dismissed after a successful send');
  } finally {
    delete globalThis.window;
    delete globalThis.fetch;
  }
});

test('a failed dispatch keeps the panel open', async () => {
  const context = await mountPanel({ dispatchError: 'session-controller-unavailable' });
  const { hooks } = context;
  const closed = [];
  hooks.setProps({ close: () => closed.push('closed') });
  try {
    const tree = await openPreviewWithSelection(context);
    clickable(tree, '新建会话并发送').props.onClick();
    await settle();
    assert.deepEqual(closed, [], 'a failure must not dismiss the panel');
  } finally {
    delete globalThis.window;
    delete globalThis.fetch;
  }
});

test('a failed dispatch shows the reason instead of doing nothing', async () => {
  const context = await mountPanel({ dispatchError: 'session-controller-unavailable' });
  const { hooks, component } = context;
  try {
    const tree = await openPreviewWithSelection(context);
    const sendButton = clickable(tree, '新建会话并发送');
    assert.ok(sendButton, '新建会话并发送 must exist');
    sendButton.props.onClick();
    await settle();
    const after = hooks.render(component).tree;
    assert.ok(hasText(after, '发送失败'), 'the failure must be visible');
    assert.ok(hasText(after, 'session-controller-unavailable'), 'the reason must be shown');
  } finally {
    delete globalThis.window;
    delete globalThis.fetch;
  }
});
