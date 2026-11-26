#!/usr/bin/env node
// @ts-check
// Verifies that a Narrative public release candidate declares one consistent version across
// package.json, package-lock.json, CHANGELOG.md, schema/<line>/narrative.metamodel.schema.yaml,
// exports/files/bin entries, README.md, and worked examples, and contains zero private x-gdsm keys.
//
// Usage: node tools/port/release-check.mjs [--root <dir>] [--expect <version>]
// Exit codes: 0 every check passed, 1 at least one check failed, 2 runner or usage error.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { DEFAULT_STRIP_X_GDSM_KEYS } from './project-schema.mjs';

const EXPECTED_PACKAGE_NAME = '@archally/narrative-schema';
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/** @param {string[]} argv */
function parseArgs(argv) {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const options = {
    root: path.resolve(scriptDirectory, '..', '..'),
    expect: /** @type {string | null} */ (null),
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--root') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --root');
      }
      options.root = path.resolve(value);
      index += 1;
      continue;
    }
    if (token === '--expect') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --expect');
      }
      options.expect = value;
      index += 1;
      continue;
    }
    if (token === '--help' || token === '-h') {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return options;
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/** @param {string} filePath */
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * @param {string} directory
 * @returns {string[]}
 */
function listFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listFiles(full);
    }
    return [full];
  }).sort();
}

/**
 * @param {unknown} target
 * @returns {string[]}
 */
function exportTargets(target) {
  if (typeof target === 'string') {
    return [target];
  }
  if (target && typeof target === 'object') {
    return Object.values(target).flatMap((value) => exportTargets(value));
  }
  return [];
}

/**
 * @param {string} root
 * @param {string | null} expected
 * @returns {{ name: string, ok: boolean, detail: string }[]}
 */
export function runChecks(root, expected) {
  /** @type {{ name: string, ok: boolean, detail: string }[]} */
  const results = [];
  /** @param {string} name @param {boolean} ok @param {string} detail */
  const record = (name, ok, detail) => results.push({ name, ok, detail });

  const packageJson = readJson(path.join(root, 'package.json'));
  const packageName = String(packageJson.name ?? '');
  record(
    'package name',
    packageName === EXPECTED_PACKAGE_NAME,
    `package.json declares ${packageName || 'absent'}, expected ${EXPECTED_PACKAGE_NAME}`,
  );

  const version = String(packageJson.version ?? '');
  const versionMatch = version.match(VERSION_PATTERN);
  if (!versionMatch) {
    record('package version', false, `package.json version '${version}' is not MAJOR.MINOR.PATCH`);
    return results;
  }
  const deployedLine = `v${versionMatch[1]}.${versionMatch[2]}`;
  const schemaDirectory = path.join(root, 'schema', deployedLine);

  if (expected) {
    record('package version', version === expected, `package.json declares ${version}, expected ${expected}`);
  } else {
    record('package version', true, `package.json declares ${version}`);
  }

  const lockPath = path.join(root, 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    const lock = readJson(lockPath);
    const lockRoot = lock.version;
    const lockPackage = lock.packages?.['']?.version;
    record(
      'lockfile',
      lockRoot === version && lockPackage === version,
      `package-lock.json declares ${lockRoot} and packages[""] ${lockPackage}, package.json ${version}`,
    );
  } else {
    record('lockfile', false, 'package-lock.json is missing');
  }

  const changelogPath = path.join(root, 'CHANGELOG.md');
  const releaseHeadings = fs.existsSync(changelogPath)
    ? [...fs.readFileSync(changelogPath, 'utf8').matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((match) => match[1])
    : [];
  record(
    'changelog',
    releaseHeadings[0] === version,
    `top CHANGELOG release is ${releaseHeadings[0] ?? 'absent'}, package.json ${version}`,
  );

  const metamodelPath = path.join(schemaDirectory, 'narrative.metamodel.schema.yaml');
  if (fs.existsSync(metamodelPath)) {
    const metamodel = YAML.parse(fs.readFileSync(metamodelPath, 'utf8'));
    const declaredSchemaVersion = String(metamodel?.['x-gdsm']?.version ?? '');
    record(
      'schema version',
      declaredSchemaVersion === version,
      `schema/${deployedLine}/narrative.metamodel.schema.yaml declares x-gdsm.version ${declaredSchemaVersion || 'absent'}, package.json ${version}`,
    );
  } else {
    record('schema version', false, `schema/${deployedLine}/narrative.metamodel.schema.yaml is missing`);
  }

  const schemaFiles = listFiles(schemaDirectory).filter((filePath) => filePath.endsWith('.schema.yaml'));
  /** @type {string[]} */
  const privateLeaks = [];
  for (const filePath of schemaFiles) {
    const parsed = YAML.parse(fs.readFileSync(filePath, 'utf8'));
    const xGdsm = parsed?.['x-gdsm'];
    if (xGdsm && typeof xGdsm === 'object') {
      for (const strippedKey of DEFAULT_STRIP_X_GDSM_KEYS) {
        if (Object.hasOwn(xGdsm, strippedKey)) {
          privateLeaks.push(`${path.relative(root, filePath)}: x-gdsm.${strippedKey}`);
        }
      }
    }
  }
  record(
    'schema projection',
    schemaFiles.length > 0 && privateLeaks.length === 0,
    privateLeaks.length === 0
      ? `${schemaFiles.length} schema file(s) clean of private x-gdsm keys`
      : `private x-gdsm keys present: ${privateLeaks.join(', ')}`,
  );

  const schemaLines = fs.existsSync(path.join(root, 'schema'))
    ? fs.readdirSync(path.join(root, 'schema'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^v\d+\.\d+$/.test(entry.name))
      .map((entry) => entry.name)
    : [];
  const newerLines = schemaLines.filter(
    (line) => compareVersions(`${line.slice(1)}.0`, `${versionMatch[1]}.${versionMatch[2]}.0`) > 0,
  );
  const newerReleases = releaseHeadings.filter((value) => compareVersions(value, version) > 0);
  const newerContent = [
    ...newerLines.map((line) => `schema/${line}`),
    ...newerReleases.map((value) => `CHANGELOG ${value}`),
  ];
  record(
    'no newer release',
    newerContent.length === 0,
    newerContent.length === 0 ? `nothing newer than ${version}` : `newer than ${version}: ${newerContent.join(', ')}`,
  );

  const exportsMap = packageJson.exports ?? {};
  for (const [exportKey, target] of Object.entries(exportsMap)) {
    for (const exportTarget of exportTargets(target)) {
      const relativeTarget = exportTarget.replace(/^\.\//, '');
      if (relativeTarget.includes('*')) {
        const prefix = relativeTarget.slice(0, relativeTarget.indexOf('*'));
        const shippedFiles = listFiles(path.join(root, prefix));
        record('export', shippedFiles.length > 0, `${exportKey} -> ${exportTarget} resolves to ${shippedFiles.length} file(s)`);
        continue;
      }
      record('export', fs.existsSync(path.join(root, relativeTarget)), `${exportKey} -> ${exportTarget}`);
    }
    const keyLine = exportKey.match(/^\.\/schema\/(v\d+\.\d+)\//);
    if (keyLine) {
      record('export', keyLine[1] === deployedLine, `${exportKey} names ${keyLine[1]}, the release deploys ${deployedLine}`);
    }
  }

  for (const entry of packageJson.files ?? []) {
    record('files', fs.existsSync(path.join(root, entry)), `files entry ${entry}`);
  }
  const binEntries = typeof packageJson.bin === 'string'
    ? { [packageName]: packageJson.bin }
    : (packageJson.bin ?? {});
  for (const [binName, binTarget] of Object.entries(binEntries)) {
    record('bin', fs.existsSync(path.join(root, String(binTarget))), `bin ${binName} -> ${binTarget}`);
  }

  const readmePath = path.join(root, 'README.md');
  if (fs.existsSync(readmePath)) {
    const readme = fs.readFileSync(readmePath, 'utf8');
    const readmeLines = [...readme.matchAll(/schema\/(v\d+\.\d+)\b/g)].map((match) => match[1]);
    const staleReadmeLines = readmeLines.filter((line) => line !== deployedLine);
    record(
      'readme',
      staleReadmeLines.length === 0,
      `README names schema line(s) ${[...new Set(readmeLines)].join(', ') || 'none'}, the release deploys ${deployedLine}`,
    );
  } else {
    record('readme', false, 'README.md is missing');
  }

  const exampleRoots = listFiles(path.join(root, 'examples'))
    .filter((filePath) => path.basename(filePath) === 'narrative.yaml');
  if (exampleRoots.length === 0) {
    record('example', false, 'no examples/*/narrative.yaml found');
  }
  for (const exampleRoot of exampleRoots) {
    const example = YAML.parse(fs.readFileSync(exampleRoot, 'utf8'));
    const declared = String(example?.version ?? '');
    record(
      'example',
      VERSION_PATTERN.test(declared),
      `${path.relative(root, exampleRoot)} declares version ${declared || 'absent'}`,
    );
  }

  return results;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: release-check [--root <dir>] [--expect <version>]');
    return 0;
  }
  if (!fs.existsSync(path.join(options.root, 'package.json'))) {
    throw new Error(`No package.json under ${options.root}`);
  }
  const results = runChecks(options.root, options.expect);
  for (const result of results) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}: ${result.detail}`);
  }
  const failed = results.filter((result) => !result.ok).length;
  console.log(`${results.length} checks, ${failed} failed`);
  return failed > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`release-check failed to run: ${message}`);
    process.exitCode = 2;
  }
}
