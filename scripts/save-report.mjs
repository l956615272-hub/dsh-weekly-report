#!/usr/bin/env node
/**
 * Save one report into the plugin's report library over the host HTTP route.
 * The host writes it, so no session-workspace sandbox applies.
 */
import { readFileSync } from 'node:fs';

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    flags[key] = value;
  }
  return flags;
}

const flags = parseArgs(process.argv.slice(2));
const url = flags.url || process.env.DSH_WEEKLY_REPORT_URL;
if (!url) {
  console.error('save-report.mjs 失败：缺少 --url（例如 http://127.0.0.1:19387）');
  process.exit(1);
}

try {
  const markdown = flags.file ? readFileSync(flags.file, 'utf8') : (flags.markdown || '');
  if (!markdown.trim()) throw new Error('报告内容为空：请检查 --file 路径');
  const response = await fetch(new URL('/dsh-weekly-report/reports', url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: flags.name || 'report.md', markdown })
  });
  const payload = await response.json();
  if (!payload || payload.ok !== true) throw new Error((payload && payload.error) || ('HTTP ' + response.status));
  console.log('报告已保存：' + payload.data.path);
} catch (error) {
  console.error('save-report.mjs 失败：' + ((error && error.message) || error));
  process.exit(1);
}
