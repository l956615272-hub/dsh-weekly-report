/**
 * Prompt builder for the report session.
 *
 * The plugin deliberately does NOT paste session transcripts into the prompt.
 * It hands the agent the selected session ids, the exact window, and the exact
 * read-only commands that turn those logs into an evidence file. The agent runs
 * them inside its own workspace and reads the result.
 */
import { join } from 'node:path';

const TYPE_LABEL = { daily: '日报', weekly: '周报', monthly: '月报', custom: '报告' };

function pad(value) {
  return String(value).padStart(2, '0');
}

/** Local "YYYY-MM-DD HH:mm" — matches what the user picked in the UI. */
export function formatLocal(ms) {
  const date = new Date(ms);
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

/** Local "YYYY-MM-DD" used for labels. */
export function formatDay(ms) {
  const date = new Date(ms);
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

/**
 * Local ISO-8601 with offset, milliseconds kept when present. The collector
 * commands use this so the agent's evidence covers exactly the window the user
 * picked — never a whole day stretching past it.
 */
export function formatIsoLocal(ms) {
  const date = new Date(ms);
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const absolute = Math.abs(offset);
  const millis = date.getMilliseconds();
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds()) +
    (millis ? '.' + String(millis).padStart(3, '0') : '') +
    sign + pad(Math.floor(absolute / 60)) + ':' + pad(absolute % 60);
}

function quote(value) {
  return '"' + String(value).replace(/"/g, '\\"') + '"';
}

function shellCommand(parts) {
  return parts.join(' ');
}

/**
 * Commands the agent must run. Exported so tests and the UI can show exactly
 * what will be executed.
 */
export function buildCollectCommands(input) {
  const {
    pluginDir,
    from,
    to,
    sessionIds = [],
    git = {},
    evidenceDir = '.dsh-weekly-report'
  } = input;
  const collectScript = join(pluginDir, 'scripts', 'collect.mjs');
  const commands = [];

  const sessionsArgs = [
    'node', quote(collectScript), 'sessions',
    '--from', formatIsoLocal(from),
    '--to', formatIsoLocal(to)
  ];
  if (sessionIds.length > 0) sessionsArgs.push('--ids', sessionIds.join(','));
  sessionsArgs.push('--out', join(evidenceDir, 'sessions.md'));
  commands.push({ kind: 'sessions', file: join(evidenceDir, 'sessions.md'), text: shellCommand(sessionsArgs) });

  if (git.enabled) {
    const workspaces = Array.isArray(git.workspaces) ? git.workspaces.filter(Boolean) : [];
    const repos = Array.isArray(git.repos) ? git.repos.filter(Boolean) : [];
    for (const workspacePath of workspaces.length > 0 ? workspaces : ['']) {
      const args = ['node', quote(collectScript), 'git'];
      if (repos.length > 0) for (const repo of repos) args.push('--repo', quote(repo));
      else args.push('--workspace', quote(workspacePath));
      args.push('--from', formatIsoLocal(from), '--to', formatIsoLocal(to));
      for (const author of (git.authors || []).filter(Boolean)) args.push('--author', quote(author));
      if (git.allBranches) args.push('--all-branches');
      if (git.includeMerges) args.push('--merges');
      const gitIndex = commands.filter((item) => item.kind === 'git').length;
      const name = workspaces.length > 1 ? 'git-' + (gitIndex + 1) + '.md' : 'git.md';
      args.push('--out', join(evidenceDir, name));
      commands.push({ kind: 'git', file: join(evidenceDir, name), text: shellCommand(args) });
    }
  }
  return commands;
}

/** Assemble the whole prompt handed to the new session. */
export function buildPrompt(input) {
  const {
    from,
    to,
    reportType = 'weekly',
    sessionIds = [],
    sessions = [],
    git = {},
    sample = '',
    extra = '',
    reportName,
    pluginDir,
    origin = '',
    evidenceDir = '.dsh-weekly-report'
  } = input;

  const label = TYPE_LABEL[reportType] || TYPE_LABEL.custom;
  const commands = buildCollectCommands({ pluginDir, from, to, sessionIds, git, evidenceDir });
  const lines = [];

  lines.push('请根据我的 DSH 会话记录和 git 提交记录，写一份**' + label + '**。');
  lines.push('');
  lines.push('## 一、时间范围');
  lines.push('');
  lines.push(formatLocal(from) + ' ~ ' + formatLocal(to) + '（本地时区）');
  lines.push('');
  lines.push('## 二、先收集证据（只读操作，不要修改任何其它文件）');
  lines.push('');
  lines.push('把证据写到当前工作区的 \`' + evidenceDir + '/\` 目录，然后读取它们：');
  lines.push('');
  commands.forEach((command, index) => {
    lines.push((index + 1) + '. ' + (command.kind === 'sessions' ? '会话证据' : 'git 证据') + '：');
    lines.push('');
    lines.push('\`\`\`sh');
    lines.push(command.text);
    lines.push('\`\`\`');
    lines.push('');
  });
  lines.push('证据文件可能比较大，用 \`read\` 的 offset/limit 分页读，或者用 \`grep\` 定位关键部分；不要一次把整个文件读进来。');
  lines.push('');
  lines.push('## 三、写作要求');
  lines.push('');
  lines.push('- 报告结构、章节划分、详略程度和语气，**严格参考第四部分的样例**；只参考格式，不要照抄内容。');
  lines.push('- 只写证据里真实出现的事情。没有把握的不要写，禁止编造进度、数字和结论。');
  lines.push('- 会话证据里的「回合」是我当时和助手的对话，按主题归纳，不要逐条流水账。');
  lines.push('- git 证据里的提交是我本人提交的代码变更，可以和会话内容互相印证。');
  lines.push('- 输出 Markdown；标题层级、章节命名对齐样例。');
  lines.push('');

  if (sessions.length > 0) {
    lines.push('## 四、本次纳入的会话');
    lines.push('');
    for (const session of sessions) {
      lines.push('- \`' + session.sessionId + '\` · ' + (session.workspaceTitle || '未分组') +
        ' · 窗口内 ' + (session.windowMessages || 0) + ' 条用户消息');
    }
    lines.push('');
  } else {
    lines.push('## 四、本次纳入的会话');
    lines.push('');
    lines.push('（见上面命令中的 --ids 参数）');
    lines.push('');
  }

  lines.push('## 五、参考样例（我以前写的报告）');
  lines.push('');
  lines.push(sample && sample.trim()
    ? '\`\`\`markdown\n' + sample.trim() + '\n\`\`\`'
    : '（这次没有提供样例。请按常规结构组织：本周完成 / 推进中 / 风险与阻塞 / 下周计划。）');
  lines.push('');

  if (extra && extra.trim()) {
    lines.push('## 六、额外要求');
    lines.push('');
    lines.push(extra.trim());
    lines.push('');
  }

  lines.push('## 七、保存报告（重要）');
  lines.push('');
  lines.push('把最终 Markdown 写到 \`' + evidenceDir + '/report.md\`，然后执行：');
  lines.push('');
  lines.push('\`\`\`sh');
  lines.push(shellCommand(['node', quote(join(pluginDir, 'scripts', 'save-report.mjs')), '--name', quote(reportName || 'report.md'), '--file', join(evidenceDir, 'report.md')]) +
    (origin ? ' --url ' + quote(origin) : ''));
  lines.push('\`\`\`');
  lines.push('');
  lines.push('它会通过插件把报告存进报告库并回显保存路径。如果这条命令失败（例如网络或权限问题），就直接把报告全文贴在回复里，并说明失败原因。');
  return lines.join('\n');
}
