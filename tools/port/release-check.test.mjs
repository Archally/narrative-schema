// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CHECK_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'release-check.mjs');

/**
 * @param {string} root
 * @param {string} relativePath
 * @param {string} content
 */
function writeFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

/**
 * @param {import('node:test').TestContext} context
 * @param {Record<string, any>} [overrides]
 */
function writeCandidate(context, overrides = {}) {
  const version = overrides.version ?? '1.5.0';
  const lockVersion = overrides.lockVersion ?? version;
  const changelogVersion = overrides.changelogVersion ?? version;
  const schemaVersion = overrides.schemaVersion ?? version;
  const exportsMap = overrides.exportsMap ?? {
    './schema/v1.5/*': './schema/v1.5/*',
  };
  const readmeLine = overrides.readmeLine ?? 'v1.5';
  const exampleVersion = overrides.exampleVersion ?? '1.0.0';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narrative-release-check-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));

  writeFile(root, 'package.json', JSON.stringify({
    name: overrides.packageName ?? '@archally/narrative-schema',
    version,
    exports: exportsMap,
    files: ['schema/', 'tools/', 'README.md'],
    bin: { 'narrative-validate': 'tools/validator/cli.mjs' },
  }, null, 2));
  writeFile(root, 'package-lock.json', JSON.stringify({
    name: '@archally/narrative-schema',
    version: lockVersion,
    lockfileVersion: 3,
    packages: { '': { name: '@archally/narrative-schema', version: lockVersion } },
  }, null, 2));
  writeFile(root, 'CHANGELOG.md', `# Changelog\n\n## [${changelogVersion}] - 2026-11-25\n\n- Initial release.\n`);
  writeFile(root, 'README.md', `# Narrative Schema\n\nSchemas live under \`schema/${readmeLine}/\`.\n`);
  const extraGdsm = overrides.privateGdsm ? '  modeling_guidance:\n    - lesson: "leaked"\n' : '';
  writeFile(
    root,
    'schema/v1.5/narrative.metamodel.schema.yaml',
    `$id: "urn:narrative:metamodel:1.0.0"\nx-gdsm:\n${extraGdsm}  version: "${schemaVersion}"\n`,
  );
  writeFile(root, 'schema/v1.5/narrative.talk.schema.yaml', '$id: "urn:narrative:talk:1.0.0"\ntype: object\n');
  writeFile(root, 'tools/validator/cli.mjs', '#!/usr/bin/env node\n');
  writeFile(root, 'examples/public-deck/narrative.yaml', `version: "${exampleVersion}"\nname: "Public Deck"\n`);
  if (overrides.extraFiles) {
    for (const [relativePath, content] of Object.entries(overrides.extraFiles)) {
      writeFile(root, relativePath, content);
    }
  }
  if (overrides.removeFiles) {
    for (const relativePath of overrides.removeFiles) {
      fs.rmSync(path.join(root, relativePath), { force: true });
    }
  }
  return root;
}

/**
 * @param {string} root
 * @param {string} [expected]
 */
function runCheck(root, expected = '1.5.0') {
  return spawnSync(process.execPath, [CHECK_SCRIPT, '--root', root, '--expect', expected], { encoding: 'utf8' });
}

test('a coherent Narrative 1.5.0 candidate passes', (context) => {
  const result = runCheck(writeCandidate(context));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /0 failed/);
});

test('wrong package name or version fails', (context) => {
  const wrongName = runCheck(writeCandidate(context, { packageName: '@archally/other-schema' }));
  assert.equal(wrongName.status, 1);
  assert.match(wrongName.stdout, /FAIL package name/);

  const wrongVersion = runCheck(writeCandidate(context, {
    version: '1.4.0',
    lockVersion: '1.4.0',
    changelogVersion: '1.4.0',
  }));
  assert.equal(wrongVersion.status, 1);
  assert.match(wrongVersion.stdout, /FAIL package version/);
});

test('mismatched lockfile, changelog, or metamodel x-gdsm.version fails', (context) => {
  const badLock = runCheck(writeCandidate(context, { lockVersion: '1.4.0' }));
  assert.equal(badLock.status, 1);
  assert.match(badLock.stdout, /FAIL lockfile/);

  const badChangelog = runCheck(writeCandidate(context, { changelogVersion: '1.4.0' }));
  assert.equal(badChangelog.status, 1);
  assert.match(badChangelog.stdout, /FAIL changelog/);

  const badSchema = runCheck(writeCandidate(context, { schemaVersion: '1.6.0' }));
  assert.equal(badSchema.status, 1);
  assert.match(badSchema.stdout, /FAIL schema version/);
});

test('leaked private x-gdsm key in deployed schema fails', (context) => {
  const leaked = runCheck(writeCandidate(context, { privateGdsm: true }));
  assert.equal(leaked.status, 1);
  assert.match(leaked.stdout, /FAIL schema projection/);
  assert.match(leaked.stdout, /modeling_guidance/);
});

test('newer schema line, stale export, stale README line, or missing example fails', (context) => {
  const newer = runCheck(writeCandidate(context, { extraFiles: { 'schema/v1.6/narrative.metamodel.schema.yaml': 'x-gdsm:\n  version: "1.6.0"\n' } }));
  assert.equal(newer.status, 1);
  assert.match(newer.stdout, /FAIL no newer release/);

  const badExport = runCheck(writeCandidate(context, { exportsMap: { './schema/v1.4/*': './schema/v1.5/*' } }));
  assert.equal(badExport.status, 1);
  assert.match(badExport.stdout, /FAIL export/);

  const badReadme = runCheck(writeCandidate(context, { readmeLine: 'v1.4' }));
  assert.equal(badReadme.status, 1);
  assert.match(badReadme.stdout, /FAIL readme/);

  const noExample = runCheck(writeCandidate(context, { removeFiles: ['examples/public-deck/narrative.yaml'] }));
  assert.equal(noExample.status, 1);
  assert.match(noExample.stdout, /FAIL example/);
});

test('missing candidate root returns runner error exit 2', () => {
  const result = runCheck(path.join(os.tmpdir(), 'narrative-release-check-does-not-exist'));
  assert.equal(result.status, 2);
});
