#!/usr/bin/env node
/**
 * Manual end-to-end check for the whole evidence → report loop.
 *
 * It mounts the host half on a throwaway HTTP port with real DSH homes, builds
 * a prompt, replays the exact commands that prompt hands the agent, and saves
 * the report back through scripts/save-report.mjs.
 *
 *   node test/e2e-agent-flow.mjs [--from 2026-10-08] [--to 2026-10-16] [--limit 3]
 */
import http from 'node:http';
import { exec } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(exec);
const here = fileURLToPath(new URL('..', import.meta.url));
const { apply } = await import(new URL('../lib/index.js', import.meta.url));

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf('--' + name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const dshHome = flag('home', process.env.DSH_HOME || join(homedir(), '.dsh'));
const from = Date.parse(flag('from', '2026-10-08') + 'T00:00:00+08:00');
const to = Date.parse(flag('to', '2026-10-16') + 'T00:00:00+08:00');
const limit = Number(flag('limit', '3'));

const root = join(tmpdir(), 'dsh-weekly-report-e2e-' + process.pid);
const dataHome = join(root, 'home');
const workdir = join(root, 'work');
mkdirSync(workdir, { recursive: true });

const routes = [];
apply({
  logger: { info() {}, warn() {} },
  effect: (fn) => { fn(); return () => {}; },
  webServer: { register: (route) => { routes.push(route); return () => {}; } }
}, { homes: [dshHome], dataHome });

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = routes.find((item) => item.path === url.pathname);
  if (!route) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"ok":false}');
    return;
  }
  route.handler(req, res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;

let failures = 0;
const check = (label, condition, detail) => {
  console.log((condition ? 'ok   ' : 'FAIL ') + label + (detail ? ' — ' + detail : ''));
  if (!condition) failures += 1;
};

try {
  const catalog = await (await fetch(origin + '/dsh-weekly-report/sessions?from=' + from + '&to=' + to)).json();
  check('catalog', catalog.ok === true && catalog.data.total > 0, catalog.data.total + ' sessions in window');
  const ids = catalog.data.groups.flatMap((group) => group.entries).slice(0, limit).map((entry) => entry.sessionId);
  check('picked sessions', ids.length > 0, ids.length + ' ids');

  const prompt = await (await fetch(origin + '/dsh-weekly-report/prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      reportType: 'weekly',
      sessionIds: ids,
      git: { enabled: true, workspaces: [join(homedir(), 'Personal_Project')], authors: ['刘广哲'] },
      sample: '# 样例',
      origin
    })
  })).json();
  check('prompt built', prompt.ok === true && prompt.data.prompt.length > 500, prompt.data && prompt.data.reportName);
  check('prompt has no transcript', !prompt.data.prompt.includes('窗口内的提问'));

  for (const command of prompt.data.commands) {
    const started = Date.now();
    await run(command.text, { cwd: workdir });
    const file = join(workdir, command.file);
    check('ran ' + command.kind + ' command', existsSync(file),
      ((Date.now() - started) / 1000).toFixed(1) + 's, ' + (existsSync(file) ? Math.round(statSync(file).size / 1024) + ' KB' : 'missing'));
  }

  const reportFile = join(workdir, '.dsh-weekly-report', 'report.md');
  writeFileSync(reportFile, '# 本周周报\n\n- 端到端验证\n');
  const saved = await run('node "' + resolve(here, 'scripts/save-report.mjs') + '" --name "' + prompt.data.reportName +
    '" --file "' + reportFile + '" --url "' + origin + '"');
  const savedPath = join(dataHome, 'dsh-weekly-report', 'reports', prompt.data.reportName);
  check('save-report wrote the library', existsSync(savedPath), saved.stdout.trim());
  check('saved content', existsSync(savedPath) && readFileSync(savedPath, 'utf8').includes('端到端验证'));
} catch (error) {
  check('flow', false, (error && error.message) || String(error));
} finally {
  server.close();
  rmSync(root, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nE2E PASS' : '\nE2E FAILED (' + failures + ')');
process.exit(failures === 0 ? 0 : 1);
