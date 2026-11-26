// @ts-check
// Portable unit and CLI tests for the Narrative next-id tool.
// Runs in both the deployed public repository and the monorepo without external fixtures.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {
  loadAllowedPrefixes,
  resolveDefaultMetamodelPath,
  suggestNextId,
} from './index.mjs';

const NEXT_ID_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(NEXT_ID_DIR, 'cli.mjs');
const METAMODEL_PATH = resolveDefaultMetamodelPath(NEXT_ID_DIR);
const SCHEMAS_DIR = path.dirname(METAMODEL_PATH);

const EXPECTED_ACTIVE_PREFIXES = [
  'A',
  'AC',
  'AQ',
  'AW',
  'C',
  'CHK',
  'CHR',
  'CLM',
  'CO',
  'DLV',
  'E',
  'EVT',
  'G',
  'INT',
  'LN',
  'N',
  'OT',
  'SC',
  'SH',
  'SL',
  'TR',
  'VW',
];

/**
 * @param {string[]} args
 */
function runCli(args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: NEXT_ID_DIR,
    encoding: 'utf8',
  });
}

/**
 * Recursively collect schema files under a directory.
 *
 * @param {string} directory
 * @returns {string[]}
 */
function collectSchemaFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectSchemaFiles(full);
    }
    if (entry.name.endsWith('.schema.yaml')) {
      return [full];
    }
    return [];
  }).sort();
}

/**
 * Collect concrete `^<PREFIX>[0-9]{3}$` entity ID patterns declared on `properties.id` across schemas.
 *
 * @param {unknown} node
 * @param {string} currentPath
 * @param {Set<string>} prefixes
 */
function collectConcreteIdPrefixes(node, currentPath, prefixes) {
  if (!node || typeof node !== 'object') {
    return;
  }
  const record = /** @type {Record<string, unknown>} */ (node);
  if (typeof record.pattern === 'string' && currentPath.endsWith('.id')) {
    const match = /^\^([A-Z]{1,5})\[0-9\]\{3\}\$$/.exec(record.pattern);
    if (match) {
      prefixes.add(match[1]);
    }
  }
  for (const [key, value] of Object.entries(record)) {
    const nextPath = currentPath ? `${currentPath}.${key}` : key;
    collectConcreteIdPrefixes(value, nextPath, prefixes);
  }
}

test('next-id source files contain zero workspace or tsx imports', () => {
  for (const name of ['index.mjs', 'cli.mjs']) {
    const text = fs.readFileSync(path.join(NEXT_ID_DIR, name), 'utf8');
    const importLines = text.split('\n').filter((line) => /^\s*import\s/.test(line));
    for (const line of importLines) {
      assert.doesNotMatch(line, /@archally\/|tsx/, `Disallowed import in ${name}: ${line}`);
    }
  }
});

test('allowlist matches the schema-backed Narrative prefixes and excludes reserved MU', () => {
  const allowed = loadAllowedPrefixes(METAMODEL_PATH);
  assert.deepEqual([...allowed.keys()], EXPECTED_ACTIVE_PREFIXES);
  assert.equal(allowed.has('MU'), false, 'reserved prefix MU has schema: null and must be excluded');

  // Every concrete ^<PREFIX>[0-9]{3}$ properties.id pattern in the shipped schemas must be in the allowlist.
  /** @type {Set<string>} */
  const schemaPrefixes = new Set();
  for (const file of collectSchemaFiles(SCHEMAS_DIR)) {
    const doc = YAML.parse(fs.readFileSync(file, 'utf8'));
    collectConcreteIdPrefixes(doc, '', schemaPrefixes);
  }
  for (const prefix of schemaPrefixes) {
    assert.equal(allowed.has(prefix), true, `schema prefix ${prefix} missing from allowlist`);
  }
  // INT uses ^[A-Z]{3}[0-9]{3}$ in narrative.script.schema.yaml and is declared in x-gdsm.schema_graph.
  assert.equal(allowed.get('INT')?.schema, 'delivery/narrative.script.schema.yaml');
  assert.deepEqual([...schemaPrefixes].sort(), EXPECTED_ACTIVE_PREFIXES.filter((prefix) => prefix !== 'INT'));
});

test('suggests max+1 with gaps, 001 when unused, handles duplicates, ignores reference-only IDs, and reports exhaustion', (context) => {
  const allowed = loadAllowedPrefixes(METAMODEL_PATH);

  const model = {
    entities: [
      { id: 'SC001', type: 'scene' },
      { id: 'SC005', type: 'scene' },
      { id: 'CLM002', type: 'claim' },
      { id: 'CLM002', type: 'claim' },
      { id: 'G001', type: 'goal', data: { note: 'mentions E999 and CLM099' } },
      { id: 'A999', type: 'asset' },
    ],
    relations: [
      { id: 'SC001--covers_claim--CLM050', source: 'SC001', target: 'CLM050', type: 'covers_claim' },
    ],
    occurrences: {
      unresolvedReferences: [
        { sourceId: 'SC001', targetId: 'E888', relationType: 'covers_evidence' },
      ],
    },
  };

  // Gaps: SC001, SC005 -> SC006 (highest authored suffix + 1).
  assert.equal(suggestNextId(model, 'SC', allowed), 'SC006');
  // Duplicates: two CLM002 -> CLM003; reference-only CLM050 and CLM099 ignored.
  assert.equal(suggestNextId(model, 'CLM', allowed), 'CLM003');
  // Unused prefix: E has only reference-only E888/E999 -> E001.
  assert.equal(suggestNextId(model, 'E', allowed), 'E001');
  // Completely unused prefix -> 001.
  assert.equal(suggestNextId(model, 'AQ', allowed), 'AQ001');
  // Exhaustion at 999.
  assert.throws(() => suggestNextId(model, 'A', allowed), /exhausted/i);
  // Unknown / reserved prefixes.
  assert.throws(() => suggestNextId(model, 'MU', allowed), /Unknown Narrative prefix/);
  assert.throws(() => suggestNextId(model, 'ZZZ', allowed), /Unknown Narrative prefix/);
  assert.throws(() => suggestNextId(model, 'sc', allowed), /Unknown Narrative prefix/);

  // Malformed models.
  assert.throws(() => suggestNextId(null, 'SC', allowed), /entities array/);
  assert.throws(() => suggestNextId({}, 'SC', allowed), /entities array/);
  assert.throws(() => suggestNextId({ entities: ['SC001'] }, 'SC', allowed), /must be an object/);
  assert.throws(() => suggestNextId({ entities: [{ type: 'scene' }] }, 'SC', allowed), /string id/);

  // CLI round-trip with temp file.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narrative-next-id-'));
  context.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const modelPath = path.join(dir, 'model.json');
  fs.writeFileSync(modelPath, JSON.stringify(model), 'utf8');

  const okGap = runCli([modelPath, 'SC']);
  assert.equal(okGap.status, 0, okGap.stderr);
  assert.equal(okGap.stdout.trim(), 'SC006');

  const okUnused = runCli([modelPath, 'E']);
  assert.equal(okUnused.status, 0, okUnused.stderr);
  assert.equal(okUnused.stdout.trim(), 'E001');

  const exhausted = runCli([modelPath, 'A']);
  assert.equal(exhausted.status, 2);
  assert.match(exhausted.stderr, /exhausted/i);

  const unknown = runCli([modelPath, 'MU']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown Narrative prefix/);

  const badJsonPath = path.join(dir, 'bad.json');
  fs.writeFileSync(badJsonPath, '{not json', 'utf8');
  const badJson = runCli([badJsonPath, 'SC']);
  assert.equal(badJson.status, 2);
  assert.match(badJson.stderr, /Invalid model JSON/);

  const missingFile = runCli([path.join(dir, 'missing.json'), 'SC']);
  assert.equal(missingFile.status, 2);
  assert.match(missingFile.stderr, /not found/i);

  const listRun = runCli(['--list']);
  assert.equal(listRun.status, 0, listRun.stderr);
  assert.equal(listRun.stdout.trim().split('\n').length, EXPECTED_ACTIVE_PREFIXES.length);

  const helpRun = runCli(['--help']);
  assert.equal(helpRun.status, 0);
  assert.match(helpRun.stdout, /Usage: narrative-next-id/);
});
