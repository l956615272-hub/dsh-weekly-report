/**
 * Report storage: `$DSH_HOME/dsh-weekly-report/reports/`.
 *
 * The host writes these files, so no session sandbox applies. Names are
 * sanitized to a single leaf and never overwrite an existing report.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './dsh-home.js';

function pad(value) {
  return String(value).padStart(2, '0');
}

function day(ms) {
  const date = new Date(ms);
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

/** ISO-8601 week label (YYYY-Www), computed on local dates. */
export function isoWeekLabel(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  const thursday = new Date(date);
  thursday.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return thursday.getFullYear() + '-W' + pad(week);
}

export function reportFileName({ type = 'custom', from, to, name }) {
  if (name) return name;
  if (type === 'daily') return day(from) + '.md';
  if (type === 'weekly') return isoWeekLabel(from) + '.md';
  if (type === 'monthly') return day(from).slice(0, 7) + '.md';
  return day(from) + '_' + day(to) + '.md';
}

export function reportsDir(home) {
  return join(dataDir(home), 'reports');
}

/** Keep the name a single safe leaf; never let it escape the reports folder. */
export function sanitizeFileName(name) {
  // Keep only the last path segment, then strip control characters and any
  // leading dots so the result can never climb out of the reports folder.
  const leaf = String(name || '')
    .split(/[\\/]/)
    .filter((part) => part.length > 0 && part !== '.' && part !== '..')
    .pop();
  const safe = String(leaf || '').replace(/[\u0000-\u001f]/g, '-').replace(/^\.+/, '').trim();
  const base = safe.length > 0 ? safe : 'report.md';
  return base.endsWith('.md') ? base : base + '.md';
}

/** First free path for `name` inside `dir`: x.md, x-2.md, x-3.md, … */
function resolvePathIn(dir, name) {
  const safe = sanitizeFileName(name);
  const stem = safe.replace(/\.md$/i, '');
  let candidate = join(dir, safe);
  let counter = 2;
  while (existsSync(candidate)) {
    candidate = join(dir, stem + '-' + counter + '.md');
    counter += 1;
  }
  return candidate;
}

export function resolveReportPath(home, name) {
  return resolvePathIn(reportsDir(home), name);
}

/** Write one markdown file atomically (temp + rename) and return its path. */
function writeInto(dir, name, markdown) {
  mkdirSync(dir, { recursive: true });
  const target = resolvePathIn(dir, name);
  const temp = target + '.tmp-' + process.pid;
  writeFileSync(temp, markdown, 'utf8');
  renameSync(temp, target);
  return target;
}

function listDir(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith('.md'))
    .map((name) => {
      const path = join(dir, name);
      const stat = statSync(path);
      return { name, path, size: stat.size, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function readFrom(dir, name) {
  const safe = sanitizeFileName(name);
  const path = join(dir, safe);
  if (!existsSync(path)) return null;
  return { name: safe, path, markdown: readFileSync(path, 'utf8') };
}

/** Write one report atomically and return its absolute path. */
export function writeReport(home, name, markdown) {
  return writeInto(reportsDir(home), name, markdown);
}

/** Saved reports, newest first. */
export function listReports(home) {
  return listDir(reportsDir(home));
}

export function readReport(home, name) {
  return readFrom(reportsDir(home), name);
}

/** Saved report samples: <home>/dsh-weekly-report/samples/*.md */
export function samplesDir(home) {
  return join(dataDir(home), 'samples');
}

export function writeSample(home, name, markdown) {
  return writeInto(samplesDir(home), name, markdown);
}

export function listSamples(home) {
  return listDir(samplesDir(home));
}

export function readSample(home, name) {
  return readFrom(samplesDir(home), name);
}
