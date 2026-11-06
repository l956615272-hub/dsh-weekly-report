/**
 * Workspace registry: <home>/storages/workspace.json
 * Shape: {
 *   tables: { workspaces: { <workspaceId>: { path, title, sessionIds } } },
 *   global: { archivedSessionIds: string[], pinnedSessionIds: string[] }
 * }
 */
import { join } from 'node:path';
import { normalizeSessionId, readJsonIfExists } from './dsh-home.js';

function normalizePath(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const trimmed = value.replace(/\/+$/, '');
  return trimmed.length === 0 ? '/' : trimmed;
}

/** Read the workspace registry into a list of { id, path, title, sessionIds }. */
export function readWorkspaces(home) {
  const json = readJsonIfExists(join(home, 'storages', 'workspace.json'));
  const table = json && json.tables && json.tables.workspaces;
  if (!table || typeof table !== 'object') return [];
  const out = [];
  for (const [id, record] of Object.entries(table)) {
    if (!record || typeof record !== 'object') continue;
    const path = normalizePath(record.path);
    if (path === null) continue;
    out.push({
      id,
      path,
      title: typeof record.title === 'string' && record.title ? record.title : path.split('/').filter(Boolean).pop() || path,
      sessionIds: Array.isArray(record.sessionIds) ? record.sessionIds : [],
      updatedAt: record.updatedAt || null
    });
  }
  return out;
}

/** Map session cwd -> workspace record (path match, then longest-prefix match). */
export function buildWorkspaceIndex(home) {
  const workspaces = readWorkspaces(home);
  const byPath = new Map(workspaces.map((item) => [item.path, item]));
  const bySession = new Map();
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) bySession.set(sessionId, workspace);
  }
  const lookup = (cwd, sessionId) => {
    const normalized = normalizePath(cwd);
    if (normalized && byPath.has(normalized)) return byPath.get(normalized);
    if (sessionId && bySession.has(sessionId)) return bySession.get(sessionId);
    if (normalized) {
      let best = null;
      for (const workspace of workspaces) {
        if (normalized === workspace.path || normalized.startsWith(workspace.path + '/')) {
          if (!best || workspace.path.length > best.path.length) best = workspace;
        }
      }
      if (best) return best;
    }
    return null;
  };
  return { workspaces, lookup };
}

/**
 * Session ids the sidebar hides under "归档". DSH keeps them in the registry's
 * global block (not in tables.workspaces), as `session-<uuid>` strings, so they
 * are normalized to the bare uuid form used by the catalog.
 */
export function readArchivedSessionIds(home) {
  const json = readJsonIfExists(join(home, 'storages', 'workspace.json'));
  const list = json && json.global && json.global.archivedSessionIds;
  const out = new Set();
  if (!Array.isArray(list)) return out;
  for (const value of list) {
    const id = normalizeSessionId(value);
    if (typeof id === 'string' && id) out.add(id);
  }
  return out;
}
