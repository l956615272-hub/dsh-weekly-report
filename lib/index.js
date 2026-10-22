/**
 * Host half of dsh-weekly-report.
 *
 * Read-only access to DSH session logs, git evidence commands, prompt building,
 * and the report library. Nothing here mutates session data; the only writes
 * the plugin performs go to <DSH_HOME>/dsh-weekly-report/.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { resolveDshHomes, primaryDshHome } from './core/dsh-home.js';
import { buildCatalog, groupByWorkspace } from './core/sessions.js';
import { readWorkspaces } from './core/workspaces.js';
import { currentBranch, discoverRepos } from './core/git.js';
import { buildCollectCommands, buildPrompt } from './core/prompt.js';
import {
  listReports, listSamples, readReport, readSample, reportFileName, reportsDir, samplesDir, writeReport, writeSample
} from './core/reports.js';

export const BASE = '/dsh-weekly-report';
export const inject = ['webServer', 'sessionController'];

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_DAYS = 7;
const CACHE_TTL_MS = 30_000;
const BODY_LIMIT = 8 * 1024 * 1024;
const PLUGIN_DIR = fileURLToPath(new URL('..', import.meta.url));

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('payload-too-large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

/** Accept epoch milliseconds or anything Date.parse understands. */
function parseTime(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (/^-?\d+$/.test(text)) {
    const numeric = Number(text);
    return Number.isFinite(numeric) ? numeric : null;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function flag(value, fallback = false) {
  if (value === null || value === undefined || value === '') return fallback;
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

/** The user's own git identity, used to pre-fill the author filter. */
function gitIdentity() {
  const read = (key) => {
    try {
      return execFileSync('git', ['config', '--global', '--get', key], { encoding: 'utf8' }).trim() || null;
    } catch {
      return null;
    }
  };
  return { name: read('user.name'), email: read('user.email') };
}

export function apply(ctx, config) {
  const options = config || {};
  const homes = resolveDshHomes(options.homes);
  // Where reports and caches live: an explicit config wins over the ambient env.
  const home = options.dataHome
    ? resolve(options.dataHome)
    : (Array.isArray(options.homes) && options.homes.length > 0 ? resolve(options.homes[0]) : primaryDshHome(homes));
  const logger = ctx.logger || console;
  const info = (message) => {
    try {
      if (logger && typeof logger.info === 'function') logger.info(message);
      else if (logger && typeof logger.warn === 'function') logger.warn(message);
    } catch { /* logging must never break the plugin */ }
  };
  info('[dsh-weekly-report] DSH home(s): ' + (homes.join(', ') || '(none)') + ' · plugin dir: ' + PLUGIN_DIR);

  let cache = null;

  const rangeOf = (params) => {
    const to = parseTime(params.get('to'));
    const from = parseTime(params.get('from'));
    const end = to === null ? Date.now() : to;
    const start = from === null ? end - DEFAULT_RANGE_DAYS * DAY : from;
    if (!(start < end)) {
      const error = new Error('invalid-range');
      error.status = 400;
      throw error;
    }
    return { from: start, to: end };
  };

  const catalogFor = (params, { withTurns = false } = {}) => {
    const { from, to } = rangeOf(params);
    const includeSubagents = flag(params.get('subagents'), false);
    const key = [from, to, includeSubagents, withTurns].join('|');
    const now = Date.now();
    if (cache && cache.key === key && now - cache.at < CACHE_TTL_MS) return cache.value;
    const catalog = buildCatalog({ homes, home, from, to, includeSubagents, withTurns });
    const value = {
      ok: true,
      data: {
        from,
        to,
        generatedAt: catalog.generatedAt,
        scanned: catalog.scanned,
        total: catalog.total,
        groups: groupByWorkspace(catalog.entries)
      },
      entries: catalog.entries
    };
    cache = { key, at: now, value };
    return value;
  };

  const register = (path, handler, label) => {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }), label);
  };

  const guard = (handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      sendJson(res, (error && error.status) || 500, {
        ok: false,
        error: (error && error.message) || 'internal'
      });
    }
  };

  register(BASE + '/health', guard((req, res) => {
    sendJson(res, 200, {
      ok: true,
      data: {
        plugin: 'dsh-weekly-report',
        homes,
        home,
        pluginDir: PLUGIN_DIR,
        workspaces: readWorkspaces(home).length,
        identity: gitIdentity()
      }
    });
  }), 'dsh-weekly-report: route health');

  register(BASE + '/workspaces', guard((req, res) => {
    sendJson(res, 200, { ok: true, data: { workspaces: readWorkspaces(home), identity: gitIdentity() } });
  }), 'dsh-weekly-report: route workspaces');

  register(BASE + '/repos', guard((req, res) => {
    const url = new URL(req.url || BASE + '/repos', 'http://localhost');
    const workspace = url.searchParams.get('workspace');
    if (!workspace) {
      sendJson(res, 400, { ok: false, error: 'workspace-required' });
      return;
    }
    const repos = discoverRepos(workspace).map((path) => ({
      path,
      name: path.split('/').filter(Boolean).pop() || path,
      branch: currentBranch(path)
    }));
    sendJson(res, 200, { ok: true, data: { workspace, repos } });
  }), 'dsh-weekly-report: route repos');

  register(BASE + '/sessions', guard((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }
    const url = new URL(req.url || BASE + '/sessions', 'http://localhost');
    const { ok, data } = catalogFor(url.searchParams);
    sendJson(res, 200, { ok, data });
  }), 'dsh-weekly-report: route sessions');

  register(BASE + '/prompt', guard(async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }
    const body = await readJsonBody(req);
    const params = new URLSearchParams();
    params.set('from', String(body.from));
    params.set('to', String(body.to));
    if (body.includeSubagents) params.set('subagents', '1');
    const catalog = catalogFor(params);
    const wanted = new Set(Array.isArray(body.sessionIds) ? body.sessionIds : []);
    const sessions = catalog.entries
      .filter((entry) => wanted.size === 0 || wanted.has(entry.sessionId))
      .map((entry) => ({
        sessionId: entry.sessionId,
        title: entry.title,
        workspaceTitle: entry.workspaceTitle,
        windowMessages: entry.windowMessages
      }));
    if (wanted.size > 0 && sessions.length === 0) {
      sendJson(res, 400, { ok: false, error: 'no-sessions-in-window' });
      return;
    }
    const git = body.git && typeof body.git === 'object' ? body.git : {};
    const reportType = typeof body.reportType === 'string' ? body.reportType : 'weekly';
    const reportName = reportFileName({ type: reportType, from: body.from, to: body.to, name: body.name });
    const prompt = buildPrompt({
      from: body.from,
      to: body.to,
      reportType,
      sessionIds: sessions.map((session) => session.sessionId),
      sessions,
      git,
      sample: typeof body.sample === 'string' ? body.sample : '',
      extra: typeof body.extra === 'string' ? body.extra : '',
      reportName,
      pluginDir: PLUGIN_DIR,
      origin: typeof body.origin === 'string' ? body.origin : ''
    });
    sendJson(res, 200, {
      ok: true,
      data: {
        prompt,
        reportName,
        commands: buildCollectCommands({
          pluginDir: PLUGIN_DIR,
          from: body.from,
          to: body.to,
          sessionIds: sessions.map((session) => session.sessionId),
          git
        })
      }
    });
  }), 'dsh-weekly-report: route prompt');

  register(BASE + '/dispatch', guard(async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }
    const body = await readJsonBody(req);
    const prompt = typeof body.prompt === 'string' ? body.prompt : '';
    if (!prompt.trim()) {
      sendJson(res, 400, { ok: false, error: 'empty-prompt' });
      return;
    }
    const controller = ctx.sessionController;
    if (!controller || typeof controller.create !== 'function' || typeof controller.prompt !== 'function') {
      sendJson(res, 503, { ok: false, error: 'session-controller-unavailable' });
      return;
    }
    // Creating the Session host-side keeps the browser half free of client
    // service injection: failures come back as ordinary HTTP errors.
    const created = await controller.create(body.workspaceId ? { workspaceId: body.workspaceId } : { cwd: body.cwd });
    const sessionId = created && created.sessionId;
    if (!sessionId) throw new Error('session-create-returned-no-id');
    // sessionController.prompt(request, signal) starts with signal.throwIfAborted(),
    // so the caller must hand it a live signal; tie it to this HTTP request.
    const abort = new AbortController();
    if (typeof res.on === 'function') res.on('close', () => abort.abort());
    await controller.prompt({
      requestId: 'weekly-report-' + Date.now() + '-' + Math.random().toString(16).slice(2),
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: prompt }],
      ...(typeof body.clientTimeZone === 'string' ? { clientTimeZone: body.clientTimeZone } : {})
    }, abort.signal);
    info('[dsh-weekly-report] dispatched report session ' + sessionId);
    sendJson(res, 200, { ok: true, data: { sessionId, workspaceId: body.workspaceId || null } });
  }), 'dsh-weekly-report: route dispatch');

  register(BASE + '/samples', guard(async (req, res) => {
    const url = new URL(req.url || BASE + '/samples', 'http://localhost');
    if (req.method === 'GET') {
      const name = url.searchParams.get('name');
      if (name) {
        const sample = readSample(home, name);
        if (!sample) {
          sendJson(res, 404, { ok: false, error: 'sample-not-found' });
          return;
        }
        sendJson(res, 200, { ok: true, data: sample });
        return;
      }
      sendJson(res, 200, { ok: true, data: { dir: samplesDir(home), samples: listSamples(home) } });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }
    const body = await readJsonBody(req);
    const markdown = typeof body.markdown === 'string' ? body.markdown : '';
    if (!markdown.trim()) {
      sendJson(res, 400, { ok: false, error: 'empty-sample' });
      return;
    }
    const target = writeSample(home, body.name || 'sample.md', markdown);
    sendJson(res, 200, { ok: true, data: { path: target, name: target.split('/').filter(Boolean).pop() } });
  }), 'dsh-weekly-report: route samples');

  register(BASE + '/reports', guard(async (req, res) => {
    const url = new URL(req.url || BASE + '/reports', 'http://localhost');
    if (req.method === 'GET') {
      const name = url.searchParams.get('name');
      if (name) {
        const report = readReport(home, name);
        if (!report) {
          sendJson(res, 404, { ok: false, error: 'report-not-found' });
          return;
        }
        sendJson(res, 200, { ok: true, data: report });
        return;
      }
      sendJson(res, 200, { ok: true, data: { dir: reportsDir(home), reports: listReports(home) } });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }
    const body = await readJsonBody(req);
    const markdown = typeof body.markdown === 'string' ? body.markdown : '';
    if (!markdown.trim()) {
      sendJson(res, 400, { ok: false, error: 'empty-report' });
      return;
    }
    const target = writeReport(home, body.name || 'report.md', markdown);
    info('[dsh-weekly-report] report saved: ' + target);
    sendJson(res, 200, { ok: true, data: { path: target, name: target.split('/').filter(Boolean).pop() } });
  }), 'dsh-weekly-report: route reports');
}
