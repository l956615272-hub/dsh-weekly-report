#!/usr/bin/env node
/**
 * Read-only evidence collector for the report prompt.
 *
 * The plugin does NOT paste session transcripts into a prompt. It hands the
 * agent the session ids, the window, and these commands; the agent runs them and
 * reads the evidence file it wrote inside its own workspace.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { resolveDshHomes, primaryDshHome } from '../lib/core/dsh-home.js';
import { buildCatalog } from '../lib/core/sessions.js';
import { collectWorkspace } from '../lib/core/git.js';

const DAY = 24 * 60 * 60 * 1000;

function usage() {
  console.log([
    '用法:',
    '  collect.mjs sessions --from <日期> --to <日期> [--ids id1,id2] [--subagents] [--out <文件>]',
    '  collect.mjs git --workspace <路径> [--repo <路径>]... --from <日期> --to <日期>',
    '                   [--author <姓名或邮箱>]... [--all-branches] [--merges] [--out <文件>]',
    '',
    '日期支持 2026-10-08 或 2026-10-08T10:00:00+08:00；--to 只给日期时取当天 23:59:59.999。'
  ].join('\n'));
}

function parseArgs(argv) {
  const flags = { repo: [], author: [], ids: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    if (key === 'repo' || key === 'author') flags[key].push(value);
    else if (key === 'ids') flags.ids.push(...value.split(',').map((item) => item.trim()).filter(Boolean));
    else flags[key] = value;
  }
  return flags;
}

function boundary(value, end) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(value + (end ? 'T23:59:59.999' : 'T00:00:00.000'));
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stamp(ms) {
  if (!ms) return '—';
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' +
    pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function emit(markdown, out) {
  if (!out) {
    process.stdout.write(markdown);
    return;
  }
  const target = resolve(out);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, markdown);
  process.stdout.write('已写入证据文件：' + target + '\n');
}

function sessionsMarkdown(flags) {
  const from = boundary(flags.from, false);
  const to = boundary(flags.to, true);
  if (from === null || to === null) throw new Error('sessions 需要 --from 与 --to');
  const homes = resolveDshHomes(flags.homes ? [flags.homes] : undefined);
  const home = primaryDshHome(homes);
  const catalog = buildCatalog({
    homes,
    home,
    from,
    to,
    includeSubagents: flags.subagents === 'true',
    withTurns: true
  });
  const wanted = flags.ids.length > 0 ? new Set(flags.ids) : null;
  const entries = catalog.entries.filter((entry) => !wanted || wanted.has(entry.sessionId));
  const lines = [];
  lines.push('# 会话证据（只读摘录）');
  lines.push('');
  lines.push('- 时间窗：' + stamp(from) + ' ~ ' + stamp(to));
  lines.push('- 生成时间：' + stamp(Date.now()));
  lines.push('- 说明：仅包含时间窗内发生的回合；subagent 会话' + (flags.subagents === 'true' ? '已包含' : '已排除') + '。');
  lines.push('');
  for (const entry of entries) {
    lines.push('## ' + (entry.title || entry.sessionId));
    lines.push('');
    lines.push('- 会话 ID：\`' + entry.sessionId + '\`');
    lines.push('- 工作区：' + entry.workspaceTitle + '（' + entry.cwd + '）');
    lines.push('- 最后活动：' + stamp(entry.lastActivity) + ' · 窗口内用户消息：' + entry.windowMessages);
    if (entry.mergedFrom && entry.mergedFrom.length) {
      lines.push('- 已合并副本：' + entry.mergedFrom.map((id) => '\`' + id + '\`').join('、'));
    }
    lines.push('');
    for (const turn of entry.turns) {
      const users = turn.users.filter((item) => item.real);
      const anchor = turn.userMs === null ? turn.startMs : turn.userMs;
      lines.push('### 回合 ' + (turn.turn === null ? '?' : turn.turn) + ' · ' + stamp(anchor));
      lines.push('');
      for (const item of users) {
        lines.push('**用户**：' + item.text.replace(/\n/g, '\n  '));
        lines.push('');
      }
      const assistantText = turn.assistants.map((item) => item.text).filter(Boolean).join('\n\n').trim();
      if (assistantText) {
        lines.push('**助手**：' + assistantText.replace(/\n/g, '\n  '));
        lines.push('');
      }
      if (turn.tools.length > 0) {
        const counts = new Map();
        for (const name of turn.tools) counts.set(name, (counts.get(name) || 0) + 1);
        lines.push('工具调用：' + [...counts.entries()].map(([name, count]) => name + '×' + count).join('、'));
        lines.push('');
      }
    }
    lines.push('');
  }
  if (entries.length === 0) lines.push('（该时间窗内没有符合条件的会话）');
  return lines.join('\n');
}

function gitMarkdown(flags) {
  const from = boundary(flags.from, false);
  const to = boundary(flags.to, true);
  if (from === null || to === null) throw new Error('git 需要 --from 与 --to');
  const repos = flags.repo.length > 0 ? flags.repo : (flags.workspace ? [flags.workspace] : []);
  if (repos.length === 0) throw new Error('git 需要 --workspace 或 --repo');
  const results = flags.repo.length > 0
    ? repos.map((repo) => collectWorkspace(repo, {
      from, to, repos: [repo], authors: flags.author,
      allBranches: flags['all-branches'] === 'true', includeMerges: flags.merges === 'true'
    })[0])
    : collectWorkspace(repos[0], {
      from, to, authors: flags.author,
      allBranches: flags['all-branches'] === 'true', includeMerges: flags.merges === 'true'
    });
  const lines = [];
  lines.push('# Git 提交证据');
  lines.push('');
  lines.push('- 时间窗：' + stamp(from) + ' ~ ' + stamp(to));
  lines.push('- 作者过滤：' + (flags.author.length ? flags.author.join('、') : '（未过滤）'));
  lines.push('- 分支：' + (flags['all-branches'] === 'true' ? '全部分支' : '当前分支'));
  lines.push('- merge 提交：' + (flags.merges === 'true' ? '已包含' : '已排除（默认）'));
  lines.push('');
  for (const result of results) {
    lines.push('## ' + result.name + '（' + result.repo + '）');
    lines.push('');
    if (result.error) {
      lines.push('- ⚠️ 无法读取提交记录：' + result.error);
      lines.push('');
      continue;
    }
    lines.push('- 分支：' + (result.branch || '(detached)') + ' · 提交数：' + result.commits.length);
    lines.push('');
    for (const commit of result.commits) {
      lines.push('- \`' + commit.short + '\` ' + commit.date + ' **' + commit.author + '** ' + commit.subject +
        (commit.merge ? ' （merge）' : '') + ' · +' + commit.insertions + '/-' + commit.deletions +
        ' · ' + commit.files.length + ' 个文件');
    }
    if (result.commits.length === 0) lines.push('-（该时间窗内没有匹配的提交）');
    lines.push('');
  }
  return lines.join('\n');
}

const [command, ...rest] = process.argv.slice(2);
const flags = parseArgs(rest);
try {
  if (command === 'sessions') emit(sessionsMarkdown(flags), flags.out);
  else if (command === 'git') emit(gitMarkdown(flags), flags.out);
  else {
    usage();
    process.exit(command ? 1 : 0);
  }
} catch (error) {
  console.error('collect.mjs 失败：' + ((error && error.message) || error));
  process.exit(1);
}
