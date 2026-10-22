/**
 * Session catalog: enumerate DSH session logs, filter them by the time of their
 * *last conversation*, and slice each session down to the turns that actually
 * happened inside the requested window.
 *
 * Facts this module relies on (verified against real logs):
 *   - log path: <home>/sessions/<encoded cwd>/session-<id>/session.v*.jsonl.zstd
 *   - multi-frame zstd; the first line is { type:"session", id, createdAt, cwd, ... }
 *   - every event line carries { type, seq, time, data } with time = epoch ms
 *   - header.origin === 'subagent' marks a subagent session
 *   - header.parentSession + delegationDepth === 0 marks a fork/resume copy
 */
import { closeSync, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { decodeFile, decodeFrameAt, frameSizeAt, magicOffsetsDescending } from './zstd.js';
import { decodeWorkspaceDirName, normalizeSessionId, readJsonIfExists } from './dsh-home.js';
import { buildWorkspaceIndex } from './workspaces.js';

const SESSION_FILE_RE = /^session.*\.jsonl\.zstd$/;
const HEADER_PROBE_BYTES = 64 * 1024;
const TAIL_PROBE_BYTES = 512 * 1024;
const WINDOW_CACHE_MAX = 64;

/**
 * Opening 570 logs costs real disk I/O, so decoded metadata is kept keyed by
 * size+mtime and recent window extractions are reused. Without this every
 * request re-read every header and tail on the machine.
 */
const metaCache = new Map();
const windowCache = new Map();

function cachedMeta(file) {
  const cached = metaCache.get(file.path);
  if (cached && cached.size === file.size && cached.mtimeMs === file.mtimeMs) return cached;
  const header = readHeader(file.path);
  const lastActivity = lastEventTime(file.path) ?? (header && header.createdAt) ?? 0;
  const meta = { size: file.size, mtimeMs: file.mtimeMs, header, lastActivity };
  metaCache.set(file.path, meta);
  return meta;
}

function cachedWindowScan(file, from, to) {
  const key = file.path + '|' + file.size + '|' + file.mtimeMs + '|' + from + '|' + to;
  const cached = windowCache.get(key);
  if (cached) return cached;
  const scanned = readSessionWindow(file.path, { from, to });
  windowCache.set(key, scanned);
  while (windowCache.size > WINDOW_CACHE_MAX) {
    const oldest = windowCache.keys().next().value;
    windowCache.delete(oldest);
  }
  return scanned;
}

function readAt(fd, start, length) {
  const buf = Buffer.alloc(length);
  const read = readSync(fd, buf, 0, length, start);
  return buf.subarray(0, read);
}

/** Enumerate every session log file under the given DSH homes. */
export function listSessionFiles(homes) {
  const out = [];
  const seen = new Set();
  for (const home of homes) {
    const root = join(home, 'sessions');
    let workspaceDirs;
    try {
      workspaceDirs = readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const workspaceDir of workspaceDirs) {
      if (!workspaceDir.isDirectory()) continue;
      const workspacePath = join(root, workspaceDir.name);
      let sessionDirs;
      try {
        sessionDirs = readdirSync(workspacePath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const sessionDir of sessionDirs) {
        if (!sessionDir.isDirectory()) continue;
        const dir = join(workspacePath, sessionDir.name);
        let entries;
        try {
          entries = readdirSync(dir);
        } catch {
          continue;
        }
        for (const file of entries) {
          if (!SESSION_FILE_RE.test(file)) continue;
          const path = join(dir, file);
          let real = path;
          try {
            real = realpathSync(path);
          } catch { /* keep the literal path */ }
          if (seen.has(real)) continue;
          seen.add(real);
          let stat;
          try {
            stat = statSync(path);
          } catch {
            continue;
          }
          out.push({
            path,
            home,
            workspaceDirName: workspaceDir.name,
            workspacePath: decodeWorkspaceDirName(workspaceDir.name),
            sessionDirName: sessionDir.name,
            file,
            size: stat.size,
            mtimeMs: stat.mtimeMs
          });
        }
      }
    }
  }
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

/** Decode only the first frame — the session header — probing as little as possible. */
export function readHeader(filePath) {
  let fd;
  try {
    fd = openSync(filePath, 'r');
    const size = statSync(filePath).size;
    let probe = Math.min(size, HEADER_PROBE_BYTES);
    for (;;) {
      const buf = readAt(fd, 0, probe);
      const frameSize = frameSizeAt(buf, 0);
      if (frameSize != null && frameSize > probe && probe < size) {
        probe = Math.min(size, Math.max(frameSize, probe * 4));
        continue;
      }
      const text = decodeFrameAt(buf, 0);
      if (text === null) return null;
      const newline = text.indexOf('\n');
      const line = (newline < 0 ? text : text.slice(0, newline)).trim();
      if (!line) return null;
      try {
        const parsed = JSON.parse(line);
        return parsed && parsed.type === 'session' ? parsed : null;
      } catch {
        return null;
      }
    }
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Decode the last frame(s) only, to read the newest events cheaply. */
export function readTailText(filePath, maxProbeBytes = 4 * 1024 * 1024) {
  let fd;
  try {
    fd = openSync(filePath, 'r');
    const size = statSync(filePath).size;
    let probe = Math.min(size, TAIL_PROBE_BYTES);
    for (;;) {
      const buf = readAt(fd, size - probe, probe);
      for (const offset of magicOffsetsDescending(buf)) {
        const text = decodeFrameAt(buf, offset);
        if (text !== null) return text;
      }
      if (probe >= size || probe >= maxProbeBytes) return decodeFile(filePath);
      probe = Math.min(size, probe * 4);
    }
  } catch {
    return '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Time (epoch ms) of the newest event in a session log. */
export function lastEventTime(filePath) {
  const text = readTailText(filePath);
  let newest = null;
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) continue;
    const match = /"time":(\d+)/.exec(line);
    if (!match) continue;
    const value = Number(match[1]);
    if (newest === null || value > newest) newest = value;
    if (newest !== null && i < lines.length - 8) break;
  }
  return newest;
}

/** Classify a session header: root conversation, fork/resume copy, or subagent. */
export function classifySession(header) {
  if (!header) return { kind: 'unknown', rootHint: null };
  if (header.origin === 'subagent' || (typeof header.delegationDepth === 'number' && header.delegationDepth > 0)) {
    return { kind: 'subagent', rootHint: header.parentSession ? normalizeSessionId(header.parentSession) : null };
  }
  if (header.parentSession) return { kind: 'fork', rootHint: normalizeSessionId(header.parentSession) };
  return { kind: 'root', rootHint: null };
}

const EVENT_TYPE_RE = /^\{"type":"([^"]+)"/;
const EVENT_TIME_RE = /"time":(\d+)/;

function eventType(line) {
  const match = EVENT_TYPE_RE.exec(line);
  return match ? match[1] : null;
}

function clip(text, limit = 4000) {
  if (typeof text !== 'string') return '';
  return text.length > limit ? text.slice(0, limit) + '\n…（已截断 ' + (text.length - limit) + ' 字）' : text;
}

/**
 * Fully decode one session log and return the header, the last activity time,
 * and the turns whose own time falls inside [from, to].
 */
export function readSessionWindow(filePath, { from = 0, to = Number.MAX_SAFE_INTEGER } = {}) {
  const text = decodeFile(filePath);
  let header = null;
  let lastActivity = 0;
  let eventsInWindow = 0;
  let windowFirstMs = null;
  let windowLastMs = null;
  const turns = [];
  let current = null;

  const lines = text.split('\n');
  for (const line of lines) {
    if (!line) continue;
    const timeMatch = EVENT_TIME_RE.exec(line);
    const time = timeMatch ? Number(timeMatch[1]) : null;
    if (time !== null && time > lastActivity) lastActivity = time;
    const type = eventType(line);
    if (type === null) continue;
    if (type === 'session') {
      if (header === null) {
        try {
          header = JSON.parse(line);
        } catch { /* header stays null */ }
      }
      continue;
    }
    if (time !== null && time >= from && time <= to) {
      eventsInWindow += 1;
      if (windowFirstMs === null || time < windowFirstMs) windowFirstMs = time;
      if (windowLastMs === null || time > windowLastMs) windowLastMs = time;
    }
    if (type === 'turn/start') {
      let turnNumber = null;
      try {
        const event = JSON.parse(line);
        turnNumber = event && event.data ? event.data.turn : null;
      } catch { /* keep null */ }
      current = { turn: turnNumber, startMs: time, userMs: null, users: [], assistants: [], tools: [], endMs: time };
      turns.push(current);
      continue;
    }
    if (type === 'turn/end') {
      if (current) current.endMs = time;
      continue;
    }
    if (type === 'user/message') {
      let event = null;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const data = (event && event.data) || {};
      const source = data.source || {};
      const texts = [];
      for (const part of Array.isArray(data.content) ? data.content : []) {
        if (part && part.type === 'text' && typeof part.text === 'string') texts.push(part.text);
      }
      if (!current) {
        current = { turn: null, startMs: time, userMs: null, users: [], assistants: [], tools: [], endMs: time };
        turns.push(current);
      }
      const isRealUser = source.kind === 'user' || source.kind === undefined;
      if (isRealUser && current.userMs === null) current.userMs = time;
      current.users.push({
        id: typeof data.id === 'string' ? data.id : null,
        ms: time,
        source: source.kind || null,
        real: isRealUser,
        text: clip(texts.join('\n\n'))
      });
      continue;
    }
    if (type === 'assistant/message') {
      let event = null;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const data = (event && event.data) || {};
      const message = data.message || {};
      const texts = [];
      const toolNames = [];
      for (const part of Array.isArray(message.content) ? message.content : []) {
        if (!part) continue;
        if (part.type === 'text' && typeof part.text === 'string') texts.push(part.text);
        if (part.type === 'tool-call' && typeof part.name === 'string') toolNames.push(part.name);
      }
      if (!current) {
        current = { turn: null, startMs: time, userMs: null, users: [], assistants: [], tools: [], endMs: time };
        turns.push(current);
      }
      current.assistants.push({
        id: typeof message.id === 'string' ? message.id : null,
        ms: time,
        text: clip(texts.join('\n\n'))
      });
      for (const name of toolNames) current.tools.push(name);
      current.endMs = time;
      continue;
    }
  }

  const windowed = [];
  for (const turn of turns) {
    const anchor = turn.userMs === null ? turn.startMs : turn.userMs;
    if (anchor === null || anchor < from || anchor > to) continue;
    windowed.push(turn);
  }

  const headerId = header && typeof header.id === 'string' ? header.id : null;
  return {
    path: filePath,
    header,
    sessionId: headerId,
    cwd: header && typeof header.cwd === 'string' ? header.cwd : null,
    createdAt: header && typeof header.createdAt === 'number' ? header.createdAt : null,
    lastActivity,
    window: {
      from,
      to,
      events: eventsInWindow,
      firstMs: windowFirstMs,
      lastMs: windowLastMs,
      turns: windowed
    }
  };
}

/** The folded session title recorded in the projection cache, when present. */
export function readProjectedTitle(home, sessionId) {
  const id = normalizeSessionId(sessionId);
  if (!id) return null;
  const json = readJsonIfExists(join(home, 'storages', 'session_projcache', 'sessions', id + '.json'));
  const value = json && json.record && json.record.rows && json.record.rows.title && json.record.rows.title.val;
  return typeof value === 'string' && value ? value : null;
}

/** Session id of a turn's user prompt, used to deduplicate forked copies. */
function turnKey(turn, sessionId, index) {
  const first = turn.users.find((item) => item.real && item.id);
  if (first) return first.id;
  const any = turn.users.find((item) => item.id);
  if (any) return any.id;
  return sessionId + '#' + (turn.turn === null ? 'x' + index : turn.turn);
}

/**
 * Build the report catalog: sessions whose *last conversation* falls inside the
 * window, grouped by workspace, with fork/resume copies merged into their root.
 */
export function buildCatalog(options) {
  const {
    homes,
    from,
    to,
    home = homes[0],
    includeSubagents = false,
    includeForks = true,
    withTitles = true,
    withTurns = true
  } = options;

  const files = listSessionFiles(homes);
  const records = new Map();
  for (const file of files) {
    const meta = cachedMeta(file);
    const header = meta.header;
    const sessionId = header && typeof header.id === 'string' ? header.id : null;
    if (!header || !sessionId) continue;
    records.set(normalizeSessionId(sessionId), {
      file,
      header,
      sessionId,
      lastActivity: meta.lastActivity,
      classification: classifySession(header)
    });
  }

  /** Walk fork links up to the oldest non-fork ancestor. */
  const rootOf = (record) => {
    let current = record;
    const guard = new Set([normalizeSessionId(record.sessionId)]);
    for (;;) {
      if (current.classification.kind !== 'fork') return normalizeSessionId(current.sessionId);
      const parentId = current.classification.rootHint;
      const parent = parentId ? records.get(parentId) : null;
      if (!parent || !includeForks || guard.has(parentId)) return normalizeSessionId(current.sessionId);
      guard.add(parentId);
      current = parent;
    }
  };

  const inWindow = (ms) => typeof ms === 'number' && ms >= from && ms <= to;
  const groups = new Map();
  for (const record of records.values()) {
    if (record.classification.kind === 'subagent' && !includeSubagents) continue;
    if (!inWindow(record.lastActivity)) continue;
    const rootId = rootOf(record);
    let group = groups.get(rootId);
    if (!group) {
      group = { rootId, members: [] };
      groups.set(rootId, group);
    }
    group.members.push(record);
  }

  // Titles and the workspace registry belong to the home that owns the log.
  const indexes = new Map();
  const indexFor = (targetHome) => {
    if (!indexes.has(targetHome)) indexes.set(targetHome, buildWorkspaceIndex(targetHome));
    return indexes.get(targetHome);
  };
  const entries = [];
  for (const group of groups.values()) {
    const primary = records.get(group.rootId) || group.members[0];
    const mergedTurns = [];
    const seenTurns = new Set();
    let userMessages = 0;
    let firstMs = null;
    let lastMs = null;
    for (const member of group.members) {
      const scanned = cachedWindowScan(member.file, from, to);
      scanned.window.turns.forEach((turn, position) => {
        const key = turnKey(turn, normalizeSessionId(member.sessionId), position);
        if (seenTurns.has(key)) return;
        seenTurns.add(key);
        const realUsers = turn.users.filter((item) => item.real);
        userMessages += realUsers.length;
        const anchor = turn.userMs === null ? turn.startMs : turn.userMs;
        if (anchor !== null) {
          if (firstMs === null || anchor < firstMs) firstMs = anchor;
          if (lastMs === null || anchor > lastMs) lastMs = anchor;
        }
        mergedTurns.push({ ...turn, sessionId: member.sessionId, members: [normalizeSessionId(member.sessionId)] });
      });
    }
    // Without a folded projection title, the first in-window user prompt reads
    // far better in the list than a raw session id.
    let fallbackTitle = null;
    for (const turn of mergedTurns) {
      const user = turn.users.find((item) => item.real && item.text);
      if (user) {
        fallbackTitle = user.text.replace(/\s+/g, ' ').trim().slice(0, 60);
        break;
      }
    }
    const cwd = (primary.header && primary.header.cwd) || primary.file.workspacePath;
    const sessionHome = primary.file.home || home;
    const workspace = indexFor(sessionHome).lookup(cwd, group.rootId);
    entries.push({
      sessionId: primary.sessionId,
      rootId: group.rootId,
      title: (withTitles ? readProjectedTitle(sessionHome, group.rootId) : null) || fallbackTitle,
      cwd,
      workspaceId: workspace ? workspace.id : null,
      workspaceTitle: workspace ? workspace.title : basename(cwd || primary.file.workspaceDirName),
      createdAt: primary.createdAt,
      lastActivity: Math.max(...group.members.map((member) => member.lastActivity)),
      windowMessages: userMessages,
      windowFirstMs: firstMs,
      windowLastMs: lastMs,
      mergedFrom: group.members.filter((member) => normalizeSessionId(member.sessionId) !== group.rootId).map((member) => member.sessionId),
      logPath: primary.file.path,
      turns: withTurns ? mergedTurns : []
    });
  }

  entries.sort((a, b) => b.lastActivity - a.lastActivity);
  return {
    generatedAt: Date.now(),
    from,
    to,
    homes,
    scanned: files.length,
    total: entries.length,
    entries
  };
}

/** Group catalog entries by workspace for display. */
export function groupByWorkspace(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.workspaceId || entry.workspaceTitle || '(unknown)';
    let group = groups.get(key);
    if (!group) {
      group = { workspaceId: entry.workspaceId, title: entry.workspaceTitle, entries: [] };
      groups.set(key, group);
    }
    group.entries.push(entry);
  }
  return [...groups.values()];
}
