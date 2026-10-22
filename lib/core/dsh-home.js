/**
 * DSH home discovery and small filesystem helpers.
 *
 * A machine can hold several DSH homes (env-selected, classic ~/.dsh, legacy
 * ~/.dsh_desktop/<version>). Session logs live under <home>/sessions.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Every DSH home that actually holds a sessions/ directory. */
export function resolveDshHomes(configured) {
  const homes = [];
  const push = (value) => {
    if (!value || typeof value !== 'string') return;
    const full = resolve(value);
    if (!homes.includes(full)) homes.push(full);
  };
  const explicit = Array.isArray(configured) ? configured.filter((value) => typeof value === 'string' && value.length > 0) : [];
  // An explicit `homes` config wins outright — discovery is only the default.
  if (explicit.length > 0) {
    for (const home of explicit) push(home);
    return homes.filter((home) => existsSync(join(home, 'sessions')));
  }
  push(process.env.DSH_HOME);
  push(join(homedir(), '.dsh'));
  const legacy = join(homedir(), '.dsh_desktop');
  try {
    if (existsSync(legacy)) {
      for (const entry of readdirSync(legacy, { withFileTypes: true })) {
        if (entry.isDirectory()) push(join(legacy, entry.name));
      }
    }
  } catch { /* legacy tree is optional */ }
  return homes.filter((home) => existsSync(join(home, 'sessions')));
}

/** The home this plugin writes its own data into. */
export function primaryDshHome(homes) {
  return process.env.DSH_HOME || (homes && homes[0]) || join(homedir(), '.dsh');
}

/** <home>/dsh-weekly-report — reports, saved samples, caches. */
export function dataDir(home) {
  return join(home, 'dsh-weekly-report');
}

export function readJsonIfExists(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Decode a session directory name such as --Users-d-Foo-- back into a path. */
export function decodeWorkspaceDirName(name) {
  if (typeof name !== 'string' || name.length === 0) return name || '';
  let inner = name;
  if (inner.startsWith('--')) inner = inner.slice(2);
  if (inner.endsWith('--')) inner = inner.slice(0, -2);
  inner = inner.replace(/~([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const segments = inner.split('-').filter(Boolean);
  return segments.length > 0 ? '/' + segments.join('/') : name;
}

/** Normalize a session id for comparison (forks store the bare uuid form). */
export function normalizeSessionId(id) {
  if (typeof id !== 'string') return id;
  return id.startsWith('session-') ? id.slice('session-'.length) : id;
}
