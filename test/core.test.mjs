import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import zlib from 'node:zlib';

import { decodeFrames, frameSizeAt, splitFrames } from '../lib/core/zstd.js';
import { classifySession, buildCatalog, lastEventTime, readHeader, readSessionWindow } from '../lib/core/sessions.js';
import { buildWorkspaceIndex, readWorkspaces } from '../lib/core/workspaces.js';
import { collectCommits, discoverRepos } from '../lib/core/git.js';

const DAY = 24 * 60 * 60 * 1000;

function at(day, hour = 9, minute = 0) {
  const pad = (value) => String(value).padStart(2, '0');
  return Date.parse('2026-10-' + pad(day) + 'T' + pad(hour) + ':' + pad(minute) + ':00+08:00');
}

function writeSession(filePath, lines, frameSize = 3) {
  const frames = [];
  for (let i = 0; i < lines.length; i += frameSize) {
    const chunk = lines.slice(i, i + frameSize).join('\n') + '\n';
    frames.push(zlib.zstdCompressSync(Buffer.from(chunk, 'utf8')));
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, Buffer.concat(frames));
}

function sessionHeader(id, cwd, extra = {}) {
  return JSON.stringify({ type: 'session', version: 4, id, createdAt: at(1), cwd, delegationDepth: 0, agentPreset: 'ptc', ...extra });
}

function userMessage(id, ms, text) {
  return JSON.stringify({ type: 'user/message', seq: 1, time: ms, data: { id, content: [{ type: 'text', text }], source: { kind: 'user' }, role: 'user' } });
}

function assistantMessage(id, ms, text, tools = []) {
  const content = [{ type: 'text', text }, ...tools.map((name, index) => ({ type: 'tool-call', id: 'c' + index, name, arguments: '{}' }))];
  return JSON.stringify({ type: 'assistant/message', seq: 2, time: ms, data: { turn: 1, step: 1, message: { id, role: 'assistant', content } } });
}

function turnStart(ms, turn) {
  return JSON.stringify({ type: 'turn/start', seq: 0, time: ms, data: { turn } });
}

function tempHome() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-weekly-report-'));
  const home = join(root, 'home');
  const workspacePath = join(root, 'demo-workspace');
  mkdirSync(join(home, 'sessions'), { recursive: true });
  mkdirSync(join(home, 'storages'), { recursive: true });
  mkdirSync(workspacePath, { recursive: true });
  writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['ws-1'], archivedSessionIds: [] },
    tables: {
      workspaces: {
        'ws-1': { path: workspacePath, title: 'Demo 工作区', sessionIds: [], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }
      }
    }
  }));
  return { root, home, workspacePath };
}

function seedSessions(home, workspacePath) {
  const root = join(home, 'sessions', '--tmp-demo--');
  // aaa: last conversation 10-09 (in window), one older turn on 10-01
  writeSession(join(root, 'session-aaa', 'session.v4.jsonl.zstd'), [
    sessionHeader('session-aaa', workspacePath),
    turnStart(at(1), 1),
    userMessage('u1', at(1), '十月一号的旧对话'),
    assistantMessage('a1', at(1, 10), '旧回答'),
    turnStart(at(9), 2),
    userMessage('u2', at(9), '窗口内的提问'),
    assistantMessage('a2', at(9, 10), '窗口内的回答', ['run_code', 'run_code', 'bash'])
  ], 3);
  // bbb: last conversation 10-20 -> outside the window even though it has old turns
  writeSession(join(root, 'session-bbb', 'session.v4.jsonl.zstd'), [
    sessionHeader('session-bbb', workspacePath),
    turnStart(at(2), 1),
    userMessage('u10', at(2), '更早的对话'),
    assistantMessage('a10', at(2, 10), '更早的回答'),
    turnStart(at(20), 2),
    userMessage('u11', at(20), '窗口之后的对话'),
    assistantMessage('a11', at(20, 10), '窗口之后的回答')
  ], 2);
  // subagent: excluded by default
  writeSession(join(root, 'session-sub', 'session.v4.jsonl.zstd'), [
    sessionHeader('session-sub', workspacePath, { origin: 'subagent', delegationDepth: 1, parentSession: 'session-aaa' }),
    turnStart(at(10), 1),
    userMessage('u20', at(10), '子代理提问'),
    assistantMessage('a20', at(10, 10), '子代理回答')
  ], 2);
  // fork: seeded copy of u2 plus its own in-window turn; must merge into aaa
  writeSession(join(root, 'session-fork', 'session.v4.jsonl.zstd'), [
    sessionHeader('session-fork', workspacePath, { parentSession: 'session-aaa', isSeeded: true }),
    turnStart(at(9), 2),
    userMessage('u2', at(9), '窗口内的提问'),
    assistantMessage('a2', at(9, 10), '窗口内的回答', ['run_code', 'run_code', 'bash']),
    turnStart(at(12), 3),
    userMessage('u4', at(12), '分叉之后的新提问'),
    assistantMessage('a4', at(12, 10), '分叉之后的新回答')
  ], 3);
}

async function withTempHome(run) {
  const fixture = tempHome();
  try {
    seedSessions(fixture.home, fixture.workspacePath);
    await run(fixture);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

test('zstd: walks every frame of a concatenated log', () => {
  const text = 'a\nb\nc\nd\ne';
  const frames = [zlib.zstdCompressSync(Buffer.from('a\nb\n')), zlib.zstdCompressSync(Buffer.from('c\nd\n')), zlib.zstdCompressSync(Buffer.from('e'))];
  const buf = Buffer.concat(frames);
  assert.equal(splitFrames(buf).length, 3);
  assert.equal(frameSizeAt(buf, 0), frames[0].length);
  assert.equal(decodeFrames(buf), text);
});

test('catalog: filters by last conversation, slices turns, merges forks, drops subagents', async () => {
  await withTempHome(({ home, workspacePath }) => {
    const catalog = buildCatalog({
      homes: [home],
      home,
      from: at(8),
      to: at(15, 23, 59),
      withTurns: true
    });
    const ids = catalog.entries.map((entry) => entry.sessionId).sort();
    assert.deepEqual(ids, ['session-aaa'], 'bbb (last activity 10-20) must be excluded even though it has older turns');

    const entry = catalog.entries[0];
    assert.equal(entry.workspaceTitle, 'Demo 工作区');
    assert.equal(entry.cwd, workspacePath);
    assert.equal(entry.mergedFrom.length, 1);
    assert.equal(entry.mergedFrom[0], 'session-fork');
    assert.equal(entry.turns.length, 2, 'u2 (deduplicated) + u4');
    assert.equal(entry.windowMessages, 2);
    const texts = entry.turns.flatMap((turn) => turn.users.filter((user) => user.real).map((user) => user.text)).sort();
    assert.deepEqual(texts, ['分叉之后的新提问', '窗口内的提问']);
    assert.equal(entry.turns.some((turn) => turn.users.some((user) => user.text === '十月一号的旧对话')), false);
  });
});

test('catalog: --subagents includes subagent sessions', async () => {
  await withTempHome(({ home }) => {
    const catalog = buildCatalog({ homes: [home], home, from: at(8), to: at(15, 23, 59), includeSubagents: true, withTurns: false });
    const ids = catalog.entries.map((entry) => entry.sessionId);
    assert.ok(ids.includes('session-sub'));
    assert.ok(ids.includes('session-aaa'));
  });
});

test('sessions: fast header/tail reads agree with the full decode', async () => {
  await withTempHome(({ home }) => {
    const file = join(home, 'sessions', '--tmp-demo--', 'session-aaa', 'session.v4.jsonl.zstd');
    const header = readHeader(file);
    assert.equal(header.id, 'session-aaa');
    assert.equal(header.version, 4);
    assert.equal(lastEventTime(file), at(9, 10));
    const scanned = readSessionWindow(file, { from: at(8), to: at(15, 23, 59) });
    assert.equal(scanned.lastActivity, at(9, 10));
    assert.equal(scanned.window.turns.length, 1);
    assert.equal(scanned.window.firstMs, at(9));
    assert.equal(scanned.window.lastMs, at(9, 10));
  });
});

test('classify: root, fork and subagent', () => {
  assert.equal(classifySession({ id: 'x' }).kind, 'root');
  assert.equal(classifySession({ id: 'x', parentSession: 'y' }).kind, 'fork');
  assert.equal(classifySession({ id: 'x', origin: 'subagent', delegationDepth: 1 }).kind, 'subagent');
  assert.equal(classifySession({ id: 'x', delegationDepth: 2 }).kind, 'subagent');
});

test('workspaces: registry is read and sessions map back by cwd', async () => {
  await withTempHome(({ home, workspacePath }) => {
    const list = readWorkspaces(home);
    assert.equal(list.length, 1);
    const index = buildWorkspaceIndex(home);
    assert.equal(index.lookup(workspacePath, null).title, 'Demo 工作区');
    assert.equal(index.lookup(workspacePath + '/packages/app', null).title, 'Demo 工作区');
    assert.equal(index.lookup('/somewhere/else', null), null);
  });
});

test('git: discovers repositories and filters by author and date', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-weekly-report-git-'));
  try {
    const workspace = join(root, 'ws');
    const repoA = join(workspace, 'repo-a');
    const repoB = join(workspace, 'repo-b');
    mkdirSync(repoA, { recursive: true });
    mkdirSync(repoB, { recursive: true });
    for (const repo of [repoA, repoB]) {
      execFileSync('git', ['init', '-q', repo]);
      writeFileSync(join(repo, 'a.txt'), 'x\n');
      execFileSync('git', ['-C', repo, 'add', '.']);
    }
    const commit = (repo, name, email, iso, message) => {
      writeFileSync(join(repo, 'a.txt'), message + '\n');
      execFileSync('git', ['-C', repo, 'add', '.']);
      execFileSync('git', ['-C', repo, '-c', 'user.name=' + name, '-c', 'user.email=' + email, 'commit', '-q', '-m', message], {
        env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso }
      });
    };
    commit(repoA, 'Alice', 'alice@example.com', '2026-10-09T10:00:00+08:00', 'feat: 窗口内 A');
    commit(repoA, 'Bob', 'bob@example.com', '2026-10-10T10:00:00+08:00', 'feat: 窗口内 B');
    commit(repoA, 'Alice', 'alice@example.com', '2026-09-01T10:00:00+08:00', 'chore: 窗口外 A');
    commit(repoB, 'Alice', 'alice@example.com', '2026-10-11T10:00:00+08:00', 'fix: 另一个仓库');

    const repos = discoverRepos(workspace);
    assert.equal(repos.length, 2);

    // Regression: the newest commit (09-01) is older than the window, which used
    // to make git's --since prune the whole traversal and return nothing.
    const all = collectCommits(repoA, { from: at(8), to: at(15, 23, 59) });
    assert.equal(all.commits.length, 2);
    assert.equal(typeof all.branch, 'string');

    const alice = collectCommits(repoA, { from: at(8), to: at(15, 23, 59), authors: ['alice@example.com'] });
    assert.equal(alice.commits.length, 1);
    assert.equal(alice.commits[0].subject, 'feat: 窗口内 A');
    assert.equal(alice.commits[0].files.length, 1);
    assert.equal(alice.commits[0].insertions, 1);

    const byName = collectCommits(repoA, { from: at(8), to: at(15, 23, 59), authors: ['Bob'] });
    assert.equal(byName.commits.length, 1);
    assert.equal(byName.commits[0].subject, 'feat: 窗口内 B');

    const outOfRange = collectCommits(repoA, { from: at(20), to: at(25) });
    assert.equal(outOfRange.commits.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
