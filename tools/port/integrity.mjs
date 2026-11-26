// @ts-check
// Shared LF-normalized SHA-256 integrity primitives for Narrative publication and public CI.
// Depends only on Node built-ins so the public repository verifies itself with zero monorepo imports.

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const ROOT_IGNORED_ENTRIES = Object.freeze(new Set(['.git', 'node_modules']));
const WALK_IGNORED_ENTRIES = Object.freeze(new Set(['node_modules', 'dist', 'PORTED.sha256']));

/**
 * SHA-256 hex digest over LF-normalized UTF-8 text.
 * @param {string} text
 * @returns {string}
 */
export function hashContent(text) {
  return createHash('sha256')
    .update(text.replace(/\r\n/g, '\n'), 'utf8')
    .digest('hex');
}

/**
 * SHA-256 hex digest over a UTF-8 file's LF-normalized content.
 * @param {string} filePath
 * @returns {string}
 */
export function hashFile(filePath) {
  return hashContent(readFileSync(filePath, 'utf8'));
}

/**
 * True when a filesystem entry exists (including dangling symlinks).
 * @param {string} fullPath
 * @returns {boolean}
 */
export function entryExists(fullPath) {
  try {
    lstatSync(fullPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve `targetPath` within `root`, rejecting absolute paths, parent traversal,
 * and symbolic links on any component inside `root`.
 *
 * @param {string} root
 * @param {string} targetPath
 * @returns {string}
 */
export function safePath(root, targetPath) {
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    throw new Error(`Unsafe integrity path: ${String(targetPath)}`);
  }
  if (isAbsolute(targetPath)) {
    throw new Error(`Unsafe integrity path: ${targetPath}`);
  }
  const resolvedRoot = resolve(root);
  const result = resolve(resolvedRoot, targetPath);
  const local = relative(resolvedRoot, result);
  if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    throw new Error(`Unsafe integrity path: ${targetPath}`);
  }
  if (local.length === 0) {
    return result;
  }
  let current = resolvedRoot;
  for (const part of local.split(/[\\/]/)) {
    current = join(current, part);
    if (entryExists(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Symbolic link is not an integrity unit: ${targetPath}`);
    }
  }
  return result;
}

/**
 * Recursively collect POSIX relative file paths under `root/subPath`.
 * Rejects symlinks and excludes `node_modules`, `dist`, and `PORTED.sha256`.
 *
 * @param {string} root
 * @param {string} [subPath]
 * @param {{ filter?: (relativeWithinUnit: string) => boolean }} [options]
 * @returns {string[]}
 */
export function filesUnder(root, subPath = '', options = {}) {
  const unitRoot = safePath(root, subPath || '.');
  if (!existsSync(unitRoot)) {
    return [];
  }
  const filter = options.filter;
  /** @type {string[]} */
  const files = [];

  /** @param {string} currentRel */
  function walk(currentRel) {
    const directory = safePath(root, currentRel || '.');
    for (const name of readdirSync(directory).sort()) {
      if (WALK_IGNORED_ENTRIES.has(name)) {
        continue;
      }
      const local = currentRel ? `${currentRel}/${name}` : name;
      const full = safePath(root, local);
      const stats = lstatSync(full);
      if (stats.isDirectory()) {
        walk(local);
        continue;
      }
      if (!stats.isFile()) {
        throw new Error(`Unsupported filesystem entry in integrity unit: ${local}`);
      }
      const withinUnit = subPath ? relative(unitRoot, full).replaceAll('\\', '/') : local;
      if (filter && !filter(withinUnit)) {
        continue;
      }
      files.push(local);
    }
  }

  walk(subPath);
  return files;
}

/**
 * Parse a PORTED.sha256 integrity manifest.
 * @param {string} text
 * @returns {{
 *   jobs: { kind: 'job' | 'file', name: string, path: string }[],
 *   absent: string[],
 *   covered: string[],
 *   hashes: Map<string, string>,
 * }}
 */
export function readIntegrity(text) {
  /** @type {{ kind: 'job' | 'file', name: string, path: string }[]} */
  const jobs = [];
  /** @type {string[]} */
  const absent = [];
  /** @type {string[]} */
  const covered = [];
  /** @type {Map<string, string>} */
  const hashes = new Map();

  for (const line of text.split(/\r?\n/)) {
    const jobMatch = line.match(/^# (job|file) ([\w-]+) (\S+)$/);
    if (jobMatch) {
      jobs.push({
        kind: /** @type {'job' | 'file'} */ (jobMatch[1]),
        name: jobMatch[2],
        path: jobMatch[3],
      });
      continue;
    }
    const directiveMatch = line.match(/^# (absent|covered) (\S+)$/);
    if (directiveMatch) {
      if (directiveMatch[1] === 'absent') {
        absent.push(directiveMatch[2]);
      } else {
        covered.push(directiveMatch[2]);
      }
      continue;
    }
    if (!line.trim() || line.startsWith('#')) {
      continue;
    }
    const hashMatch = line.match(/^([a-f0-9]{64})  (\S+)$/);
    if (!hashMatch || hashes.has(hashMatch[2])) {
      throw new Error('Invalid or duplicate integrity entry');
    }
    hashes.set(hashMatch[2], hashMatch[1]);
  }
  if (jobs.length === 0 || hashes.size === 0) {
    throw new Error('Integrity manifest has no jobs or hashes');
  }
  return { jobs, absent, covered, hashes };
}

/**
 * Collect LF-normalized SHA-256 hashes for declared jobs under `root`.
 *
 * @param {string} root
 * @param {Array<{
 *   kind: 'job' | 'file',
 *   name: string,
 *   path: string,
 *   filter?: (relativeWithinUnit: string) => boolean,
 *   transform?: (content: string, relativeWithinUnit: string) => string,
 * }>} jobs
 * @returns {Map<string, string>}
 */
export function collectHashes(root, jobs) {
  /** @type {Map<string, string>} */
  const hashes = new Map();
  for (const job of jobs) {
    const unitFullPath = safePath(root, job.path);
    if (job.kind === 'file') {
      if (!existsSync(unitFullPath)) {
        continue;
      }
      if (!lstatSync(unitFullPath).isFile()) {
        throw new Error(`Expected file for integrity unit ${job.name}: ${job.path}`);
      }
      const baseName = job.path.split('/').at(-1) ?? job.path;
      const raw = readFileSync(unitFullPath, 'utf8');
      const content = job.transform ? job.transform(raw, baseName) : raw;
      hashes.set(`${job.name}/${baseName}`, hashContent(content));
      continue;
    }
    const files = filesUnder(root, job.path, { filter: job.filter });
    for (const file of files) {
      const fullPath = join(root, file);
      const withinUnit = relative(unitFullPath, fullPath).replaceAll('\\', '/');
      const raw = readFileSync(fullPath, 'utf8');
      const content = job.transform ? job.transform(raw, withinUnit) : raw;
      hashes.set(`${job.name}/${withinUnit}`, hashContent(content));
    }
  }
  return hashes;
}

/**
 * Compare expected and actual hash maps.
 * @param {Map<string, string>} expected
 * @param {Map<string, string>} actual
 * @param {string} [label]
 * @returns {string[]}
 */
export function compareHashes(expected, actual, label = 'files') {
  /** @type {string[]} */
  const problems = [];
  for (const [file, hash] of [...actual].sort(([a], [b]) => a.localeCompare(b))) {
    if (!expected.has(file)) {
      problems.push(`${label}: unexpected ${file}`);
    } else if (expected.get(file) !== hash) {
      problems.push(`${label}: modified ${file}`);
    }
  }
  for (const file of [...expected.keys()].sort((a, b) => a.localeCompare(b))) {
    if (!actual.has(file)) {
      problems.push(`${label}: missing ${file}`);
    }
  }
  return problems;
}

/**
 * Verify a target directory against a parsed integrity manifest, enforcing:
 * - LF-normalized SHA-256 hashes for every declared unit
 * - Presence of every declared unit
 * - Absence of every private (`absent`) path
 * - Zero undeclared nested paths under `covered` roots or declared ancestors
 * - Zero unexpected root-level files or directories (outside `.git` and `node_modules`)
 *
 * @param {string} root
 * @param {{
 *   jobs: Array<{ kind: 'job' | 'file', name: string, path: string }>,
 *   absent: string[],
 *   covered: string[],
 *   hashes: Map<string, string>,
 * }} integrity
 * @returns {{ ok: boolean, checked: number, problems: string[] }}
 */
export function verifyIntegrity(root, integrity) {
  const actual = collectHashes(root, integrity.jobs);
  const problems = compareHashes(integrity.hashes, actual);
  for (const job of integrity.jobs) {
    const resolved = safePath(root, job.path);
    if (!existsSync(resolved)) {
      problems.push(`Missing unit: ${job.path}`);
    }
  }
  const absentSet = new Set(integrity.absent);
  for (const absentPath of integrity.absent) {
    const resolved = safePath(root, absentPath);
    if (entryExists(resolved)) {
      problems.push(`Private path present: ${absentPath}`);
    }
  }
  const coveredSet = new Set(integrity.covered);
  for (const coveredRoot of integrity.covered) {
    const directory = safePath(root, coveredRoot);
    if (!existsSync(directory)) {
      problems.push(`Missing covered root: ${coveredRoot}`);
      continue;
    }
    findUndeclared(root, coveredRoot, integrity.jobs, absentSet, problems);
  }
  findUndeclaredAtRoot(root, integrity.jobs, coveredSet, absentSet, problems);
  return { ok: problems.length === 0, checked: actual.size, problems };
}

/**
 * Walk a covered root or ancestor directory and report any undeclared child.
 * @param {string} root
 * @param {string} dirPath
 * @param {Array<{ kind: 'job' | 'file', name: string, path: string }>} jobs
 * @param {Set<string>} absentSet
 * @param {string[]} problems
 */
function findUndeclared(root, dirPath, jobs, absentSet, problems) {
  const directory = safePath(root, dirPath);
  for (const child of readdirSync(directory).sort()) {
    const local = `${dirPath}/${child}`;
    const inside = jobs.some((job) => job.path === local || local.startsWith(`${job.path}/`));
    if (inside) {
      continue;
    }
    const full = safePath(root, local);
    const ancestor = jobs.some((job) => job.path.startsWith(`${local}/`));
    const isDirectory = lstatSync(full).isDirectory();
    if (ancestor && isDirectory) {
      findUndeclared(root, local, jobs, absentSet, problems);
      continue;
    }
    if (!absentSet.has(local)) {
      problems.push(`Undeclared path: ${local}`);
    }
  }
}

/**
 * Check immediate root-level entries of the target directory so unexpected top-level
 * files or folders cannot escape covered_public_roots checks (TR02).
 *
 * @param {string} root
 * @param {Array<{ kind: 'job' | 'file', name: string, path: string }>} jobs
 * @param {Set<string>} coveredSet
 * @param {Set<string>} absentSet
 * @param {string[]} problems
 */
function findUndeclaredAtRoot(root, jobs, coveredSet, absentSet, problems) {
  const resolvedRoot = resolve(root);
  if (!existsSync(resolvedRoot)) {
    return;
  }
  for (const child of readdirSync(resolvedRoot).sort()) {
    if (ROOT_IGNORED_ENTRIES.has(child)) {
      continue;
    }
    if (coveredSet.has(child)) {
      continue;
    }
    const directJob = jobs.some((job) => job.path === child);
    if (directJob) {
      continue;
    }
    const full = safePath(resolvedRoot, child);
    const ancestor = jobs.some((job) => job.path.startsWith(`${child}/`));
    const isDirectory = lstatSync(full).isDirectory();
    if (ancestor && isDirectory) {
      findUndeclared(resolvedRoot, child, jobs, absentSet, problems);
      continue;
    }
    if (!absentSet.has(child)) {
      problems.push(`Undeclared root path: ${child}`);
    }
  }
}
