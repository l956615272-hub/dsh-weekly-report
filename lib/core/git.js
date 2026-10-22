/**
 * Read-only git collection for report evidence.
 *
 * One workspace can hold several repositories, so callers first discover them,
 * then collect commits per repository with an explicit author and time filter.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'vendor', 'target', '.next', '.venv', 'venv', '__pycache__']);

function git(repoPath, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', ['-C', repoPath, ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    if (allowFailure) return null;
    throw error;
  }
}

/** Directories under `workspacePath` that contain a .git entry, up to maxDepth. */
export function discoverRepos(workspacePath, { maxDepth = 3 } = {}) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.name === '.git')) found.push(dir);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      walk(join(dir, entry.name), depth + 1);
    }
  };
  if (existsSync(workspacePath)) walk(workspacePath, 0);
  return found;
}

export function currentBranch(repoPath) {
  const value = git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFailure: true });
  return value ? value.trim() : null;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `--since` stops history traversal at the first commit older than the cutoff,
 * so a repository whose HEAD sits outside the window (generate last week's
 * report on Monday) would report nothing at all. `--since-as-filter` filters
 * without pruning; older git falls back to no --since plus an exact JS filter.
 */
let sinceAsFilterSupport = null;
function supportsSinceAsFilter() {
  if (sinceAsFilterSupport !== null) return sinceAsFilterSupport;
  try {
    const output = execFileSync('git', ['--version'], { encoding: 'utf8' });
    const match = /(\d+)\.(\d+)/.exec(output);
    sinceAsFilterSupport = match ? Number(match[1]) > 2 || (Number(match[1]) === 2 && Number(match[2]) >= 37) : false;
  } catch {
    sinceAsFilterSupport = false;
  }
  return sinceAsFilterSupport;
}

const FIELD = '\u0001';
const SEP = '\u0002';

/**
 * Commits by `authors` (name or email, literal match) within [from, to].
 * `to` is nudged forward because git's --until is exclusive at second scope.
 */
export function collectCommits(repoPath, options) {
  const {
    from,
    to,
    authors = [],
    allBranches = false,
    includeMerges = false,
    maxCommits = 500,
    withFiles = true
  } = options;
  const args = [
    'log',
    '--date=iso-strict',
    '--pretty=format:' + FIELD + '%H' + SEP + '%h' + SEP + '%aI' + SEP + '%an' + SEP + '%ae' + SEP + '%s' + SEP + '%P'
  ];
  if (withFiles) args.push('--numstat');
  if (allBranches) args.push('--all');
  if (!includeMerges) args.push('--no-merges');
  const sinceIso = new Date(from).toISOString();
  const untilIso = new Date(to + 1000).toISOString();
  if (supportsSinceAsFilter()) args.push('--since-as-filter=' + sinceIso);
  args.push('--until=' + untilIso);
  for (const author of authors) args.push('--author=' + escapeRegex(author));
  args.push('-n', String(maxCommits));

  const output = git(repoPath, args, { allowFailure: true });
  if (output === null) return { repo: repoPath, name: basename(repoPath), branch: null, error: 'git-log-failed', commits: [] };

  const commits = [];
  let current = null;
  for (const line of output.split('\n')) {
    if (line.startsWith(FIELD)) {
      const [hash, short, date, author, email, subject, parents] = line.slice(1).split(SEP);
      current = {
        hash,
        short,
        date,
        author,
        email,
        subject,
        merge: Boolean(parents && parents.trim().includes(' ')),
        files: [],
        insertions: 0,
        deletions: 0
      };
      commits.push(current);
      continue;
    }
    if (!current || !line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const insertions = parts[0] === '-' ? 0 : Number(parts[0]) || 0;
    const deletions = parts[1] === '-' ? 0 : Number(parts[1]) || 0;
    current.insertions += insertions;
    current.deletions += deletions;
    current.files.push({ path: parts.slice(2).join('\t'), insertions, deletions });
  }
  const inRange = commits.filter((commit) => {
    const ms = Date.parse(commit.date);
    return Number.isFinite(ms) && ms >= from && ms <= to;
  });
  return { repo: repoPath, name: basename(repoPath), branch: currentBranch(repoPath), error: null, commits: inRange };
}

/** Collect every repository under a workspace path. */
export function collectWorkspace(workspacePath, options) {
  const repos = options.repos && options.repos.length > 0 ? options.repos : discoverRepos(workspacePath, options);
  return repos.map((repoPath) => collectCommits(repoPath, options));
}
