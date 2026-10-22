import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCollectCommands, buildPrompt, formatDay, formatLocal } from '../lib/core/prompt.js';
import { isoWeekLabel, listReports, readReport, reportFileName, resolveReportPath, sanitizeFileName, writeReport } from '../lib/core/reports.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FROM = Date.parse('2026-10-08T00:00:00+08:00');
const TO = Date.parse('2026-10-14T23:59:59.999+08:00');

test('collect commands carry the window, the ids and the git filters', () => {
  const commands = buildCollectCommands({
    pluginDir: '/plugin',
    from: FROM,
    to: TO,
    sessionIds: ['session-a', 'session-b'],
    git: {
      enabled: true,
      workspaces: ['/work'],
      repos: ['/work/one', '/work/two'],
      authors: ['刘广哲', 'a@b.com'],
      allBranches: true,
      includeMerges: true
    }
  });
  assert.equal(commands.length, 2);
  const sessions = commands[0].text;
  assert.match(sessions, /scripts\/collect\.mjs"? sessions/);
  assert.match(sessions, /--from 2026-10-08/);
  assert.match(sessions, /--to 2026-10-14/);
  assert.match(sessions, /--ids session-a,session-b/);
  assert.match(sessions, /--out \.dsh-weekly-report\/sessions\.md/);

  const git = commands[1].text;
  assert.match(git, /--repo "\/work\/one" --repo "\/work\/two"/);
  assert.match(git, /--author "刘广哲" --author "a@b\.com"/);
  assert.match(git, /--all-branches/);
  assert.match(git, /--merges/);
  assert.match(git, /--out \.dsh-weekly-report\/git\.md/);
});

test('collect commands split git evidence per workspace and stay off when disabled', () => {
  const off = buildCollectCommands({ pluginDir: '/plugin', from: FROM, to: TO, git: { enabled: false } });
  assert.equal(off.length, 1);
  const two = buildCollectCommands({
    pluginDir: '/plugin',
    from: FROM,
    to: TO,
    git: { enabled: true, workspaces: ['/w1', '/w2'], authors: [] }
  });
  assert.equal(two.length, 3);
  assert.match(two[1].text, /--workspace "\/w1"/);
  assert.match(two[1].text, /--out \.dsh-weekly-report\/git-1\.md/);
  assert.match(two[2].text, /--workspace "\/w2"/);
  assert.match(two[2].text, /--out \.dsh-weekly-report\/git-2\.md/);
});

test('prompt embeds the sample, the save command and no session bodies', () => {
  const prompt = buildPrompt({
    from: FROM,
    to: TO,
    reportType: 'weekly',
    sessionIds: ['session-a'],
    sessions: [{ sessionId: 'session-a', workspaceTitle: '示例工作区', windowMessages: 3 }],
    git: { enabled: true, workspaces: ['/work'], authors: ['刘广哲'] },
    sample: '# 上周周报\n\n## 本周完成\n- 做了 A',
    extra: '重点写 A',
    reportName: '2026-W41.md',
    pluginDir: '/plugin',
    origin: 'http://127.0.0.1:19387'
  });
  assert.match(prompt, /写一份\*\*周报\*\*/);
  assert.match(prompt, /2026-10-08 00:00 ~ 2026-10-14 23:59/);
  assert.match(prompt, /session-a/);
  assert.match(prompt, /示例工作区 · 窗口内 3 条用户消息/);
  assert.match(prompt, /# 上周周报/);
  assert.match(prompt, /重点写 A/);
  assert.match(prompt, /save-report\.mjs"? --name "2026-W41\.md"/);
  assert.match(prompt, /--url "http:\/\/127\.0\.0\.1:19387"/);
  assert.doesNotMatch(prompt, /窗口内的提问/);
});

test('prompt falls back to a default outline without a sample', () => {
  const prompt = buildPrompt({ from: FROM, to: TO, reportType: 'daily', pluginDir: '/plugin' });
  assert.match(prompt, /写一份\*\*日报\*\*/);
  assert.match(prompt, /没有提供样例/);
  assert.doesNotMatch(prompt, /--author/);
});

test('report naming follows the report type', () => {
  assert.equal(reportFileName({ type: 'weekly', from: FROM, to: TO }), '2026-W41.md');
  assert.equal(reportFileName({ type: 'daily', from: FROM, to: TO }), '2026-10-08.md');
  assert.equal(reportFileName({ type: 'monthly', from: FROM, to: TO }), '2026-10.md');
  assert.equal(reportFileName({ type: 'custom', from: FROM, to: TO }), '2026-10-08_2026-10-14.md');
  assert.equal(reportFileName({ type: 'weekly', from: FROM, to: TO, name: 'mine.md' }), 'mine.md');
  assert.equal(isoWeekLabel(Date.parse('2026-12-31T12:00:00')), '2026-W53');
  assert.equal(isoWeekLabel(Date.parse('2027-01-01T12:00:00')), '2026-W53');
  assert.equal(isoWeekLabel(Date.parse('2026-01-01T12:00:00')), '2026-W01');
});

test('report files stay inside the reports folder and never overwrite', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-weekly-report-reports-'));
  try {
    assert.equal(sanitizeFileName('../../etc/passwd'), 'passwd.md');
    assert.equal(sanitizeFileName('/absolute/path/周报.md'), '周报.md');
    assert.equal(sanitizeFileName('..'), 'report.md');
    assert.equal(sanitizeFileName('周报 2026-W41'), '周报 2026-W41.md');
    const first = writeReport(root, '2026-W41.md', '# one');
    const second = writeReport(root, '2026-W41.md', '# two');
    assert.equal(first.endsWith('2026-W41.md'), true);
    assert.equal(second.endsWith('2026-W41-2.md'), true);
    const listed = listReports(root);
    assert.equal(listed.length, 2);
    assert.equal(readReport(root, '2026-W41.md').markdown, '# one');
    assert.equal(readReport(root, 'missing.md'), null);
    const resolved = resolveReportPath(root, '../escape.md');
    assert.equal(resolved.startsWith(join(root, 'dsh-weekly-report', 'reports')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
